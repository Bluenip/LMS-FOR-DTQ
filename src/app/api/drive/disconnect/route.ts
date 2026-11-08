import { disconnect, driveRoute } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const POST = (request: Request) =>
  driveRoute(request, true, ({ userId }) => disconnect(userId));
