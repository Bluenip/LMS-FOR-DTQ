import { errorResponse, HttpError, sessionUserId } from '@/lib/server/auth';
import { slidesArchive } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** GET /api/assignments/:id/slides?students=a,b — ZIP of the submitted slide files (all when omitted). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await sessionUserId();
    if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const students = new URL(request.url).searchParams.get('students');
    const only = students
      ? students
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 1000)
      : null;
    return await slidesArchive(userId, (await params).id, only);
  } catch (error) {
    return errorResponse(error);
  }
}
