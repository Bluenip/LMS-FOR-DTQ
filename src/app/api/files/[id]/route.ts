import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { accessFile } from '@/lib/server/actions';
import { withDatabase } from '@/lib/server/repository';
import { downloadUrl } from '@/lib/server/storage';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await sessionUserId();
    const file = await withDatabase((db) => {
      const user = requireUser(db, userId);
      return accessFile(db, user, id);
    });
    return Response.redirect(await downloadUrl(file), 302);
  } catch (e) {
    return errorResponse(e);
  }
}
