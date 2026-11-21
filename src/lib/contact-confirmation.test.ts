// Run with `npm test` (node:test through tsx; no extra dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyHasFilledHoneypot,
  MAX_FORWARDS_PER_DAY,
  buildConfirmationText,
  buildInquiryText,
  CONFIRMATION_SUBJECT,
  emailKey,
  greetingFor,
  INQUIRY_SUBJECT,
  type ContactInquiry,
} from "@/lib/contact-confirmation";
import { handleContactSubmission, type ContactDeps } from "@/lib/contact-flow";
import { contactInquirySchema } from "@/lib/schemas";

const inquiry: ContactInquiry = {
  firstName: "Maria",
  lastName: "Lopez",
  email: "Maria.Lopez@Example.com",
  phone: "305 555 0100",
  preferredDate: "2026-12-20",
  partySize: "8",
  charterType: "half-day",
  occasion: "Birthday",
  addOns: [],
  message: "Hello",
};

test("greeting uses a first name made of letters, apostrophes and hyphens", () => {
  assert.equal(greetingFor("Maria"), "Hello Maria,");
  assert.equal(greetingFor("  Jean-Luc "), "Hello Jean-Luc,");
  assert.equal(greetingFor("O'Neil"), "Hello O'Neil,");
  assert.equal(greetingFor("O’Neil"), "Hello O’Neil,");
  assert.equal(greetingFor("Zoë"), "Hello Zoë,");
});

test("greeting falls back to Hello, for anything else", () => {
  for (const bad of [
    "",
    "   ",
    "Mary Ann",
    "R2D2",
    "Bob\nBcc: x@y.z",
    "<b>Bob</b>",
    "-Bob",
    "'Bob",
    "Bob!",
    "A".repeat(41),
  ]) {
    assert.equal(greetingFor(bad), "Hello,", JSON.stringify(bad));
  }
});

test("confirmation text is plain, fixed, and free of banned characters", () => {
  const text = buildConfirmationText("Maria");
  assert.ok(text.startsWith("Hello Maria,\n"));
  assert.ok(!text.includes("<"), "no markup");
  const dash = new RegExp(String.fromCharCode(91, 0x2014, 0x2013, 93));
  assert.ok(!dash.test(text), "no em or en dashes");
  assert.ok(!dash.test(CONFIRMATION_SUBJECT));
  // No promise about timing or outcome.
  assert.ok(
    !/\b(soon|shortly|within|hours?|days?|will (reply|respond|contact|call|be in touch)|guarantee)\b/i.test(
      text
    ),
    text
  );
  // Everything after the greeting is identical for every visitor.
  assert.equal(
    buildConfirmationText("Maria").split("\n").slice(1).join("\n"),
    buildConfirmationText("x y z").split("\n").slice(1).join("\n")
  );
});

test("inquiry text lists the submitted details", () => {
  const text = buildInquiryText(inquiry);
  assert.match(text, /Name: Maria Lopez/);
  assert.match(text, /Email: Maria\.Lopez@Example\.com/);
  assert.match(text, /Occasion: Birthday/);
});

test("emailKey ignores case and surrounding spaces and is not the address", () => {
  assert.equal(emailKey(" Maria.Lopez@Example.com "), emailKey("maria.lopez@example.com"));
  assert.notEqual(emailKey("a@example.com"), emailKey("b@example.com"));
  assert.ok(!emailKey("a@example.com").includes("example"));
  assert.match(emailKey("a@example.com"), /^[0-9a-f]{64}$/);
});

test("server schema accepts the form payload and rejects a bad email", () => {
  assert.ok(contactInquirySchema.safeParse(inquiry).success);
  assert.ok(!contactInquirySchema.safeParse({ ...inquiry, email: "nope" }).success);
  assert.ok(!contactInquirySchema.safeParse({ ...inquiry, phone: "abc" }).success);
});

interface Call {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

function makeDeps(over: Partial<ContactDeps> & { sendOk?: boolean[] } = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const results = over.sendOk ?? [true, true];
  let i = 0;
  const deps: ContactDeps = {
    teamAddress: "team@example.com",
    sendPlain: async (to, subject, text, replyTo) => {
      calls.push({ to, subject, text, replyTo });
      events.push(`send:${to}`);
      return results[i++] ?? true;
    },
    claimForward: async () => {
      events.push("claimForward");
      return true;
    },
    releaseForward: async () => {
      events.push("releaseForward");
    },
    claim: async (key) => {
      events.push(`claim:${key.slice(0, 6)}`);
      return true;
    },
    release: async () => {
      events.push("release");
    },
    ...over,
  };
  return { deps, calls, events };
}

test("success: forwards to the team, claims the slot, then confirms once", async () => {
  const { deps, calls, events } = makeDeps();
  assert.equal(await handleContactSubmission(inquiry, deps), "confirmed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, "team@example.com");
  assert.equal(calls[0].subject, INQUIRY_SUBJECT);
  assert.equal(calls[0].replyTo, inquiry.email);
  assert.equal(calls[1].to, inquiry.email);
  assert.equal(calls[1].subject, CONFIRMATION_SUBJECT);
  assert.equal(calls[1].text, buildConfirmationText("Maria"));
  assert.equal(calls[1].replyTo, undefined);
  assert.deepEqual(
    events.map((e) => e.split(":")[0]),
    ["claimForward", "send", "claim", "send"]
  );
});

test("no team address or a failed forward: no confirmation is sent", async () => {
  const none = makeDeps({ teamAddress: undefined });
  assert.equal(await handleContactSubmission(inquiry, none.deps), "not-forwarded");
  assert.equal(none.calls.length, 0);

  const failed = makeDeps({ sendOk: [false] });
  assert.equal(await handleContactSubmission(inquiry, failed.deps), "not-forwarded");
  assert.equal(failed.calls.length, 1);
  assert.ok(!failed.events.includes("claim:" + emailKey(inquiry.email).slice(0, 6)));
  assert.ok(failed.events.includes("releaseForward"), "forward slot given back");
});

test("a second submission inside 24 hours sends no second confirmation", async () => {
  const seen = new Set<string>();
  const claim = async (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const first = makeDeps({ claim });
  const second = makeDeps({ claim });
  assert.equal(await handleContactSubmission(inquiry, first.deps), "confirmed");
  assert.equal(
    await handleContactSubmission({ ...inquiry, email: "MARIA.LOPEZ@example.com " }, second.deps),
    "rate-limited"
  );
  assert.equal(second.calls.length, 1, "only the team forward, no confirmation");
});

test("a failed confirmation send releases the slot and never throws", async () => {
  const { deps, events } = makeDeps({ sendOk: [true, false] });
  assert.equal(await handleContactSubmission(inquiry, deps), "send-failed");
  assert.ok(events.includes("release"));
});

test("a filled honeypot forwards nothing, sends nothing and touches no limiter", async () => {
  for (const fax of ["x", " https://spam.example ", "0"]) {
    const { deps, calls, events } = makeDeps();
    assert.equal(await handleContactSubmission({ ...inquiry, fax }, deps), "honeypot");
    assert.equal(calls.length, 0);
    assert.deepEqual(events, []);
  }
  // A blank honeypot is an ordinary submission.
  for (const fax of [undefined, "", "   "]) {
    const { deps } = makeDeps();
    assert.equal(await handleContactSubmission({ ...inquiry, fax }, deps), "confirmed");
  }
});

test("honeypot is read from the raw body, before validation", () => {
  assert.equal(bodyHasFilledHoneypot({ fax: "x" }), true);
  assert.equal(bodyHasFilledHoneypot({ fax: "  " }), false);
  assert.equal(bodyHasFilledHoneypot({ fax: 5 }), false);
  assert.equal(bodyHasFilledHoneypot({}), false);
  assert.equal(bodyHasFilledHoneypot(null), false);
  assert.equal(bodyHasFilledHoneypot("fax"), false);
  assert.ok(contactInquirySchema.safeParse({ ...inquiry, fax: "" }).success);
});

// In-memory stand-in with the same rule as claimForward: 3 per address.
function forwardLimiter(max = MAX_FORWARDS_PER_DAY) {
  const counts = new Map<string, number>();
  return {
    counts,
    claimForward: async (key: string) => {
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
    releaseForward: async (key: string) => {
      counts.set(key, Math.max((counts.get(key) ?? 0) - 1, 0));
    },
  };
}

test("the fourth inquiry from one address in 24 hours is not forwarded or confirmed", async () => {
  assert.equal(MAX_FORWARDS_PER_DAY, 3);
  const limiter = forwardLimiter();
  const outcomes: string[] = [];
  let sent = 0;
  for (let i = 0; i < 5; i++) {
    const { deps, calls } = makeDeps({ ...limiter });
    // Same address in different case and spacing counts as one address.
    const email = i % 2 ? " MARIA.LOPEZ@example.com" : "maria.lopez@example.com";
    outcomes.push(await handleContactSubmission({ ...inquiry, email }, deps));
    sent += calls.length;
  }
  assert.deepEqual(outcomes.slice(3), ["forward-limited", "forward-limited"]);
  assert.equal(limiter.counts.get(emailKey(inquiry.email)), 3);
  // Inquiries 1-3 forward. The confirmation claim is always granted in this
  // test, so that is 3 forwards plus 3 confirmations; 4 and 5 send nothing.
  assert.equal(sent, 6);
});

test("the limit is per address, not global", async () => {
  const limiter = forwardLimiter(1);
  const a = makeDeps({ ...limiter });
  const b = makeDeps({ ...limiter });
  assert.equal(await handleContactSubmission(inquiry, a.deps), "confirmed");
  assert.equal(
    await handleContactSubmission({ ...inquiry, email: "other@example.com" }, b.deps),
    "confirmed"
  );
});

test("a failed forward gives the forward slot back", async () => {
  const limiter = forwardLimiter();
  const failed = makeDeps({ ...limiter, sendOk: [false] });
  assert.equal(await handleContactSubmission(inquiry, failed.deps), "not-forwarded");
  assert.equal(limiter.counts.get(emailKey(inquiry.email)), 0);
});

test("a limiter failure does not lose the inquiry: it is still forwarded", async () => {
  const { deps, calls } = makeDeps({
    claimForward: async () => {
      throw new Error('relation "ContactForwardLimit" does not exist');
    },
  });
  assert.equal(await handleContactSubmission(inquiry, deps), "confirmed");
  assert.equal(calls[0].to, "team@example.com");
});

test("any thrown error is swallowed", async () => {
  const boom = makeDeps({
    claim: async () => {
      throw new Error("relation does not exist");
    },
  });
  assert.equal(await handleContactSubmission(inquiry, boom.deps), "error");
  assert.equal(boom.calls.length, 1, "no confirmation after a failed claim");

  const sendBoom = makeDeps({
    sendPlain: async () => {
      throw new Error("network");
    },
  });
  assert.equal(await handleContactSubmission(inquiry, sendBoom.deps), "error");
});
