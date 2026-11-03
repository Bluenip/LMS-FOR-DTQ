import { classTeacherOptions } from '@/lib/server/actions';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { withDatabase } from '@/lib/server/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ classId: string }> }) {
  try {
    const { classId } = await params;
    const userId = await sessionUserId();
    const teachers = await withDatabase((db) =>
      classTeacherOptions(db, requireUser(db, userId), classId),
    );
    return Response.json({ teachers }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
