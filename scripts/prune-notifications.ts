import { withDatabase } from '../src/lib/server/repository';
import { PrismaClient } from '@prisma/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 90;
  if (!Number.isInteger(days) || days < 30) throw new Error('Retention must be at least 30 days.');
  const cutoff = Date.now() - days * 86400000;
  let count: number;
  if (process.env.DATABASE_URL) {
    const prisma = new PrismaClient();
    try {
      // All application timestamps are ISO 8601 UTC strings, so their lexical
      // order matches chronological order. Invalidate affected state atomically.
      const cutoffIso = new Date(cutoff).toISOString();
      if (apply) {
        const result = await prisma.$queryRaw<{ count: bigint }[]>`
          WITH deleted AS (
            DELETE FROM "Notification" WHERE "read" = true AND "createdAt" < ${cutoffIso}
            RETURNING "userId"
          ), versions AS (
            INSERT INTO "ChangeVersion" ("scope", "version")
            SELECT DISTINCT 'user:' || "userId", 1 FROM deleted
            ON CONFLICT ("scope") DO UPDATE SET "version" = "ChangeVersion"."version" + 1
          )
          SELECT count(*) AS count FROM deleted`;
        count = Number(result[0].count);
      } else {
        count = await prisma.notification.count({
          where: { read: true, createdAt: { lt: cutoffIso } },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  } else
    count = await withDatabase((db) => {
      const removable = (n: (typeof db.notifications)[number]) =>
        n.read && Date.parse(n.createdAt) < cutoff;
      const count = db.notifications.filter(removable).length;
      if (apply) db.notifications = db.notifications.filter((n) => !removable(n));
      return count;
    }, apply);
  console.log(
    JSON.stringify({ candidates: count, deleted: apply ? count : 0, retentionDays: days }),
  );
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
