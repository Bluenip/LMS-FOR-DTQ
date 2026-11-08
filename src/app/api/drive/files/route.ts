import { driveRoute, listFiles, listRemoteFiles } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) =>
  driveRoute(request, false, ({ userId }) => {
    const params = new URL(request.url).searchParams;
    // source=drive lists the physical Drive folder (administrators only); default lists LMS records.
    return params.get('source') === 'drive'
      ? listRemoteFiles(userId, params)
      : listFiles(userId, params);
  });
