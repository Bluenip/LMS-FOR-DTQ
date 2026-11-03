import { completeUpload, driveRoute } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  driveRoute(request, true, async ({ userId, input }) =>
    completeUpload(userId, (await params).id, input),
  );
