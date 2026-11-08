import { attachToLesson, driveRoute } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Attaches a completed upload to a lesson (so the lesson can be saved before the upload ends). */
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  driveRoute(request, true, async ({ userId, input }) =>
    attachToLesson(userId, (await params).id, input),
  );
