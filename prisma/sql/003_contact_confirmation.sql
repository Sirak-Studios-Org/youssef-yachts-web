-- Rate limits for the contact form. Idempotent. Run with:
--   prisma db execute --file prisma/sql/003_contact_confirmation.sql
-- Both tables are keyed by a SHA-256 digest of the lowercased address.
-- The confirmation is not sent until ContactConfirmation exists. Forwarding to
-- the team still works without ContactForwardLimit, but is then not limited.

-- One confirmation email per address per 24 hours.
CREATE TABLE IF NOT EXISTS "ContactConfirmation" (
  "emailKey" text PRIMARY KEY,
  "sentAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- At most 3 forwarded inquiries per address per 24 hours.
CREATE TABLE IF NOT EXISTS "ContactForwardLimit" (
  "emailKey"     text PRIMARY KEY,
  "windowStart"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "forwardCount" integer NOT NULL DEFAULT 1
);
