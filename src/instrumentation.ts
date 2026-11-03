/**
 * Runs once when the server starts. Schedules the Google Drive clean-up so files left behind by
 * deleted lessons/assignments/classes (and abandoned uploads) do not pile up. Set
 * DRIVE_PRUNE_INTERVAL_MINUTES=0 to disable, or run `npm run drive:prune` from cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.GOOGLE_CLIENT_ID) return;
  const minutes = Number(process.env.DRIVE_PRUNE_INTERVAL_MINUTES ?? 60);
  if (!(minutes > 0)) return;
  const run = async () => {
    try {
      const { pruneDrive } = await import('./lib/server/drive-service');
      await pruneDrive();
    } catch (error) {
      console.error('Scheduled Drive clean-up failed', error instanceof Error ? error.message : '');
    }
  };
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, minutes * 60 * 1000).unref();
}
