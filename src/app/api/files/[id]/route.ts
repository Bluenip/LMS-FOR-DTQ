import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { accessFile } from '@/lib/server/actions';
import { classOf, withClassScope } from '@/lib/server/repository';
import { downloadUrl } from '@/lib/server/storage';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await sessionUserId();
    const file = await withClassScope(
      userId,
      async (tx) => ({ classIds: await classOf(tx, 'file', id) }),
      (db) => accessFile(db, requireUser(db, userId), id),
    );
    return Response.redirect(await downloadUrl(file), 302);
  } catch (e) {
    return errorResponse(e);
  }
}
