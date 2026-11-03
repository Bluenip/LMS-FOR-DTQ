import { driveRoute, initUpload } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const POST = (request: Request) =>
  driveRoute(request, true, ({ userId, input, origin }) => initUpload(userId, origin, input));
