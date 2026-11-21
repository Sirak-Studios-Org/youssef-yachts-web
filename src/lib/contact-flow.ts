import {
  buildConfirmationText,
  buildInquiryText,
  CONFIRMATION_SUBJECT,
  emailKey,
  INQUIRY_SUBJECT,
  isHoneypotFilled,
  type ContactInquiry,
} from "@/lib/contact-confirmation";

// Orchestration for a contact-form submission, with its I/O injected so the
// ordering rules can be tested without a database or an email provider.
export interface ContactDeps {
  /** Send a plain-text email; resolves true only when the provider accepted it. */
  sendPlain: (
    to: string,
    subject: string,
    text: string,
    replyTo?: string
  ) => Promise<boolean>;
  /** Team inbox (EMAIL_ADMIN), or undefined when none is configured. */
  teamAddress: string | undefined;
  /** Atomically claim one of this address's 3 forwards per 24 hours; true when granted. */
  claimForward: (key: string) => Promise<boolean>;
  /** Give the forward slot back after a failed forward. */
  releaseForward: (key: string) => Promise<void>;
  /** Atomically claim the 24-hour confirmation slot for this key; true when this call won it. */
  claim: (key: string) => Promise<boolean>;
  /** Give the confirmation slot back after a failed send. */
  release: (key: string) => Promise<void>;
}

export type ContactOutcome =
  | "honeypot"
  | "forward-limited"
  | "not-forwarded"
  | "rate-limited"
  | "send-failed"
  | "confirmed"
  | "error";

/**
 * 0. A filled honeypot ends everything: nothing is forwarded or sent.
 * 1. Claim one of the address's 3 forwards per 24 hours; beyond that nothing
 *    is forwarded or sent. If the limiter itself fails (for example the table
 *    does not exist yet), the forward still goes so a real inquiry is not lost.
 * 2. Forward the submission to the team. Nothing else happens unless it went.
 * 3. Claim the one-confirmation-per-address-per-24-hours slot.
 * 4. Send the fixed confirmation; give the slot back if the send fails.
 * Never throws: the visitor's experience does not depend on any of this.
 */
export async function handleContactSubmission(
  data: ContactInquiry,
  deps: ContactDeps
): Promise<ContactOutcome> {
  try {
    if (isHoneypotFilled(data.fax)) return "honeypot";
    if (!deps.teamAddress) return "not-forwarded";

    const key = emailKey(data.email);

    let forwardClaimed = false;
    try {
      if (!(await deps.claimForward(key))) return "forward-limited";
      forwardClaimed = true;
    } catch (e) {
      console.error("Contact forward limiter failed, forwarding anyway:", e);
    }

    const forwarded = await deps.sendPlain(
      deps.teamAddress,
      INQUIRY_SUBJECT,
      buildInquiryText(data),
      data.email
    );
    if (!forwarded) {
      if (forwardClaimed) await deps.releaseForward(key).catch(() => {});
      return "not-forwarded";
    }

    if (!(await deps.claim(key))) return "rate-limited";

    const sent = await deps.sendPlain(
      data.email,
      CONFIRMATION_SUBJECT,
      buildConfirmationText(data.firstName)
    );
    if (!sent) {
      await deps.release(key).catch(() => {});
      return "send-failed";
    }
    return "confirmed";
  } catch (e) {
    console.error("Contact submission handling failed:", e);
    return "error";
  }
}
