export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { contactInquirySchema } from "@/lib/schemas";
import { badRequest } from "@/lib/api";
import { sendPlainEmail } from "@/lib/email";
import { handleContactSubmission } from "@/lib/contact-flow";
import {
  claimConfirmation,
  releaseConfirmation,
} from "@/lib/contact-confirmation-store";

// Public: receives the contact form. Forwards the request to the team inbox
// (EMAIL_ADMIN) and, once that has gone, sends the visitor one fixed
// confirmation from EMAIL_FROM. Always answers 200 for a valid submission; a
// failed email never changes what the visitor sees.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = contactInquirySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid request", parsed.error.flatten());
  }

  await handleContactSubmission(parsed.data, {
    sendPlain: sendPlainEmail,
    teamAddress: process.env.EMAIL_ADMIN,
    claim: claimConfirmation,
    release: releaseConfirmation,
  });

  return NextResponse.json({ ok: true });
}
