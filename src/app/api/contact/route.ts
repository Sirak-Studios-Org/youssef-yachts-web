export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { contactInquirySchema } from "@/lib/schemas";
import { badRequest } from "@/lib/api";
import { sendPlainEmail } from "@/lib/email";
import { handleContactSubmission } from "@/lib/contact-flow";
import { bodyHasFilledHoneypot } from "@/lib/contact-confirmation";
import {
  claimConfirmation,
  claimForward,
  releaseConfirmation,
  releaseForward,
} from "@/lib/contact-confirmation-store";

// Public: receives the contact form. Forwards the request to the team inbox
// (EMAIL_ADMIN) and, once that has gone, sends the visitor one fixed
// confirmation from EMAIL_FROM. Always answers 200 for a valid submission; a
// failed email never changes what the visitor sees. A filled honeypot field,
// or an address over its 3 forwards per 24 hours, gets the same 200 and
// nothing is forwarded or sent.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  // Checked before validation so a bot learns nothing from a 400.
  if (bodyHasFilledHoneypot(body)) {
    return NextResponse.json({ ok: true });
  }

  const parsed = contactInquirySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid request", parsed.error.flatten());
  }

  await handleContactSubmission(parsed.data, {
    sendPlain: sendPlainEmail,
    teamAddress: process.env.EMAIL_ADMIN,
    claimForward,
    releaseForward,
    claim: claimConfirmation,
    release: releaseConfirmation,
  });

  return NextResponse.json({ ok: true });
}
