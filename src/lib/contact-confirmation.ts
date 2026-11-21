import { createHash } from "node:crypto";
import { BRAND, CHARTER_TYPES, ADD_ONS } from "@/lib/constants";

// Pure helpers for the contact-form confirmation email. No server-only import
// and no I/O, so node:test can load this file directly.

export interface ContactInquiry {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredDate: string;
  partySize: string;
  charterType: string;
  occasion?: string;
  addOns?: string[];
  message?: string;
  /** Honeypot. Hidden from people; any non-blank value marks the post as a bot. */
  fax?: string;
}

/** Maximum inquiries forwarded to the team per address in one 24-hour window. */
export const MAX_FORWARDS_PER_DAY = 3;

export function isHoneypotFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Reads the honeypot from a raw request body before any validation runs. */
export function bodyHasFilledHoneypot(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    isHoneypotFilled((body as { fax?: unknown }).fax)
  );
}

// A first name is used in the greeting only when the whole value is letters,
// apostrophes and hyphens. Anything else (digits, spaces, symbols, line
// breaks, markup) falls back to the generic greeting.
const SAFE_FIRST_NAME = /^\p{L}[\p{L}\p{M}'’-]{0,39}$/u;

export function greetingFor(firstName: string): string {
  const name = firstName.trim();
  return SAFE_FIRST_NAME.test(name) ? `Hello ${name},` : "Hello,";
}

export const CONFIRMATION_SUBJECT = `Your charter request to ${BRAND.name}`;

export function buildConfirmationText(firstName: string): string {
  return [
    greetingFor(firstName),
    "",
    `Thank you for contacting ${BRAND.name}. This message confirms that we received the charter request you submitted on our website.`,
    "",
    `If you want to add or change anything, call or text ${BRAND.phone}, or write to ${BRAND.email}.`,
    "",
    BRAND.name,
    BRAND.location,
  ].join("\n");
}

// The text the team receives. Fixed subject, so visitor input never reaches a
// header.
export const INQUIRY_SUBJECT = "New charter request from the website";

export function buildInquiryText(data: ContactInquiry): string {
  const charter =
    CHARTER_TYPES.find((c) => c.id === data.charterType)?.label ??
    data.charterType;
  const addOns = (data.addOns ?? [])
    .map((id) => ADD_ONS.find((a) => a.id === id)?.name ?? id)
    .join(", ");
  return [
    `Charter inquiry for ${BRAND.name}`,
    `Name: ${data.firstName} ${data.lastName}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone}`,
    `Preferred date: ${data.preferredDate}`,
    `Party size: ${data.partySize}`,
    `Charter type: ${charter}`,
    data.occasion ? `Occasion: ${data.occasion}` : "",
    addOns ? `Add-ons: ${addOns}` : "",
    data.message ? `Details: ${data.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Rate-limit key. The address itself is never stored, only this digest.
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
