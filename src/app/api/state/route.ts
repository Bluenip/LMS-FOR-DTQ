import { withScopedState } from '@/lib/server/repository';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { stateFor } from '@/lib/server/actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await sessionUserId();
    return Response.json(
      await withScopedState(id, (db) => stateFor(db, requireUser(db, id, true))),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
