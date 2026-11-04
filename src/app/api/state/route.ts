import { stateFingerprint, withScopedState } from '@/lib/server/repository';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { stateFor } from '@/lib/server/actions';
import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
export async function GET(request: Request) {
  try {
    const id = await sessionUserId();
    const headers = { 'Cache-Control': 'private, no-store' };
    // With PostgreSQL, a few indexed lookups decide whether anything changed;
    // an unchanged poll is answered without loading the state at all.
    const fingerprint = id ? await stateFingerprint(id) : null;
    const known = fingerprint && `"v-${digest(`${id}:${fingerprint}`)}"`;
    if (known && request.headers.get('if-none-match') === known)
      return new Response(null, { status: 304, headers: { ...headers, ETag: known } });
    const state = await withScopedState(id, (db) => stateFor(db, requireUser(db, id, true)));
    const body = JSON.stringify(state);
    const etag = known || `"c-${digest(body)}"`;
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
    return new Response(body, {
      headers: { ...headers, ETag: etag, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
