import { connectionStatus, driveRoute } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) =>
  driveRoute(request, false, ({ userId }) => connectionStatus(userId));
