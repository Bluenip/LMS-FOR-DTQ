import { createHash } from 'node:crypto';
import { withScopedState } from '@/lib/server/repository';
import { errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { stateFor } from '@/lib/server/actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * The client polls this every few seconds. The body is identical most of the time, so it carries an
 * ETag and answers 304 when the caller already has the current state (saves bandwidth and parsing).
 * "no-cache" makes browsers revalidate on every request instead of reusing a stale copy.
 */
export async function GET(request: Request) {
  try {
    const id = await sessionUserId();
    const body = JSON.stringify(
      await withScopedState(id, (db) => stateFor(db, requireUser(db, id, true))),
    );
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 32)}"`;
    const headers = { ETag: etag, 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (e) {
    return errorResponse(e);
  }
}
