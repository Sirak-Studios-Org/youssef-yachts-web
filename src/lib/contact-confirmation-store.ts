import "server-only";
import { prisma } from "@/lib/prisma";
import { MAX_FORWARDS_PER_DAY } from "@/lib/contact-confirmation";

// Two small tables keyed by a SHA-256 digest of the lowercased address (the
// address itself is never stored). Both are created by
// prisma/sql/003_contact_confirmation.sql.
//   ContactConfirmation: one confirmation email per address per 24 hours.
//   ContactForwardLimit: at most 3 forwarded inquiries per address per 24 hours.
// If a table is missing the query throws; contact-flow.ts treats a failed
// confirmation claim as "do not send" and a failed forward claim as "forward
// anyway", and the visitor sees nothing different either way.

/**
 * Atomically claim the 24-hour confirmation slot. The insert wins when no row
 * exists; the update wins only when the existing row is older than 24 hours.
 * Two requests for one address at the same moment cannot both succeed.
 */
export async function claimConfirmation(key: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ emailKey: string }[]>`
    INSERT INTO "ContactConfirmation" ("emailKey", "sentAt")
    VALUES (${key}, now())
    ON CONFLICT ("emailKey") DO UPDATE SET "sentAt" = now()
    WHERE "ContactConfirmation"."sentAt" < now() - interval '24 hours'
    RETURNING "emailKey"`;
  return rows.length === 1;
}

export async function releaseConfirmation(key: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "ContactConfirmation" WHERE "emailKey" = ${key}`;
}

/**
 * Atomically claim one forward. A window opens at the first forward and lasts
 * 24 hours; inside it the count may reach MAX_FORWARDS_PER_DAY and no further.
 * An expired window restarts at 1. Concurrent requests cannot exceed the cap.
 */
export async function claimForward(key: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ forwardCount: number }[]>`
    INSERT INTO "ContactForwardLimit" ("emailKey", "windowStart", "forwardCount")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("emailKey") DO UPDATE SET
      "windowStart" = CASE
        WHEN "ContactForwardLimit"."windowStart" < now() - interval '24 hours'
        THEN now() ELSE "ContactForwardLimit"."windowStart" END,
      "forwardCount" = CASE
        WHEN "ContactForwardLimit"."windowStart" < now() - interval '24 hours'
        THEN 1 ELSE "ContactForwardLimit"."forwardCount" + 1 END
    WHERE "ContactForwardLimit"."windowStart" < now() - interval '24 hours'
       OR "ContactForwardLimit"."forwardCount" < ${MAX_FORWARDS_PER_DAY}::int
    RETURNING "forwardCount"`;
  return rows.length === 1;
}

export async function releaseForward(key: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ContactForwardLimit"
    SET "forwardCount" = GREATEST("forwardCount" - 1, 0)
    WHERE "emailKey" = ${key}`;
}
