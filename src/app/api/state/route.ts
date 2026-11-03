import { withDatabase } from '@/lib/server/repository';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { stateFor } from '@/lib/server/actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await sessionUserId();
    return Response.json(await withDatabase((db) => stateFor(db, requireUser(db, id))), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
