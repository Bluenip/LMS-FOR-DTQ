import { driveRoute, runMaintenance } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
/** Administrator-triggered cleanup of orphaned Drive files (also runs hourly in the background). */
export const POST = (request: Request) =>
  driveRoute(request, true, ({ userId }) => runMaintenance(userId));
