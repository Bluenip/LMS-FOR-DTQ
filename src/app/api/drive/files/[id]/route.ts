import { deleteFile, driveRoute, getFile, updateFile } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, { params }: Context) =>
  driveRoute(request, false, async ({ userId }) =>
    getFile(userId, (await params).id, new URL(request.url).searchParams.get('live') === '1'),
  );
export const PATCH = async (request: Request, { params }: Context) =>
  driveRoute(request, true, async ({ userId, input }) =>
    updateFile(userId, (await params).id, input),
  );
export const DELETE = async (request: Request, { params }: Context) =>
  driveRoute(request, true, async ({ userId }) => deleteFile(userId, (await params).id));
