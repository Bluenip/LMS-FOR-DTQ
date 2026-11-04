import { withDatabase } from '../src/lib/server/repository';

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 90;
  if (!Number.isInteger(days) || days < 30) throw new Error('Retention must be at least 30 days.');
  const cutoff = Date.now() - days * 86400000;
  const count = await withDatabase((db) => {
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
