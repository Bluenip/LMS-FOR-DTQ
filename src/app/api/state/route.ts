import { withScopedState } from '@/lib/server/repository';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { stateFor } from '@/lib/server/actions';
import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const id = await sessionUserId();
    const state = await withScopedState(id, (db) => stateFor(db, requireUser(db, id, true)));
    const body = JSON.stringify(state);
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    const headers = { 'Cache-Control': 'private, no-store', ETag: etag };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (e) {
    return errorResponse(e);
  }
}
