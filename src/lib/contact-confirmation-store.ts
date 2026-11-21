import "server-only";
import { prisma } from "@/lib/prisma";

// One row per address (stored as a SHA-256 digest) that has been sent a
// contact-form confirmation. Table created by prisma/sql/003_contact_confirmation.sql.
// If the table is missing the query throws, the caller treats that as "do not
// send", and the visitor sees nothing different.

/**
 * Atomically claim the 24-hour slot. The insert wins when no row exists; the
 * update wins only when the existing row is older than 24 hours. Two requests
 * for one address at the same moment cannot both succeed.
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
