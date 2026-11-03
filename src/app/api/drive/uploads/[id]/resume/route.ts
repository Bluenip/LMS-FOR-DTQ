import { driveRoute, resumeUpload } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  driveRoute(request, true, async ({ userId }) => resumeUpload(userId, (await params).id));
