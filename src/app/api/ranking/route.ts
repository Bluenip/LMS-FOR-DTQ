import { errorResponse, HttpError, requireUser, sessionUserId } from '@/lib/server/auth';
import { rankingFor } from '@/lib/server/ranking';
import { withClassScope } from '@/lib/server/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Practice ranking of a class: teachers of the class and administrators only. */
export async function GET(request: Request) {
  try {
    const id = await sessionUserId();
    if (!id) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const classId = new URL(request.url).searchParams.get('classId') || '';
    if (!classId) throw new HttpError(400, 'Thiếu mã lớp.');
    const ranking = await withClassScope(
      id,
      async () => ({ classIds: [classId] }),
      (db) => rankingFor(db, requireUser(db, id), classId),
    );
    return Response.json(ranking, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
