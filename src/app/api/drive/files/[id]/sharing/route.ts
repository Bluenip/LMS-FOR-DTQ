import { driveRoute, setSharing } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  driveRoute(request, true, async ({ userId, input }) =>
    setSharing(userId, (await params).id, input),
  );
