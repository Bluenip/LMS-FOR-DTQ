import { cancelUpload, driveRoute, getUpload } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, { params }: Context) =>
  driveRoute(request, false, async ({ userId }) => getUpload(userId, (await params).id));
export const DELETE = async (request: Request, { params }: Context) =>
  driveRoute(request, true, async ({ userId }) => cancelUpload(userId, (await params).id));
