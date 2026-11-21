import {
  buildConfirmationText,
  buildInquiryText,
  CONFIRMATION_SUBJECT,
  emailKey,
  INQUIRY_SUBJECT,
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
  /** Atomically claim the 24-hour slot for this key; true when this call won it. */
  claim: (key: string) => Promise<boolean>;
  /** Give the slot back after a failed send. */
  release: (key: string) => Promise<void>;
}

export type ContactOutcome =
  | "not-forwarded"
  | "rate-limited"
  | "send-failed"
  | "confirmed"
  | "error";

/**
 * 1. Forward the submission to the team. Nothing else happens unless it went.
 * 2. Claim the one-per-address-per-24-hours slot.
 * 3. Send the fixed confirmation; give the slot back if the send fails.
 * Never throws: the visitor's experience does not depend on any of this.
 */
export async function handleContactSubmission(
  data: ContactInquiry,
  deps: ContactDeps
): Promise<ContactOutcome> {
  try {
    if (!deps.teamAddress) return "not-forwarded";
    const forwarded = await deps.sendPlain(
      deps.teamAddress,
      INQUIRY_SUBJECT,
      buildInquiryText(data),
      data.email
    );
    if (!forwarded) return "not-forwarded";

    const key = emailKey(data.email);
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
