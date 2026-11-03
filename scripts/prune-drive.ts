import { pruneDrive } from '../src/lib/server/drive-service';

/** Usage: npm run drive:prune [graceHours]  (default 24). Safe to run repeatedly or from cron. */
async function main() {
  const grace = Number(process.argv[2] ?? 24);
  if (!Number.isFinite(grace) || grace < 0) throw new Error('graceHours must be a number >= 0');
  const result = await pruneDrive(grace);
  console.log(JSON.stringify(result));
  if (result.skippedNoConnection)
    console.log(
      'Google Drive is not connected: only records without a Drive file were considered.',
    );
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error((error as Error).message);
    process.exit(1);
  },
);
