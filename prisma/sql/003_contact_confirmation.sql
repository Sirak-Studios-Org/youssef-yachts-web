-- Rate limit for the contact-form confirmation email: one per address per 24
-- hours. Idempotent. Run with:
--   prisma db execute --file prisma/sql/003_contact_confirmation.sql
-- The confirmation is not sent until this table exists.
CREATE TABLE IF NOT EXISTS "ContactConfirmation" (
  "emailKey" text PRIMARY KEY,
  "sentAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
