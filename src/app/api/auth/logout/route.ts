import { cookies } from 'next/headers';
import { assertOrigin, COOKIE, errorResponse, readSession } from '@/lib/server/auth';
import { readJsonObject } from '@/lib/server/request';
import { revokeSession } from '@/lib/server/repository';
/**
 * Logs out this browser only. Other devices stay signed in unless the client
 * explicitly asks for `{ "everywhere": true }`, which revokes every session.
 */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const body = request.body ? await readJsonObject(request).catch(() => ({})) : {};
    const jar = await cookies();
    if ((body as { everywhere?: unknown }).everywhere === true) {
      const session = await readSession(jar.get(COOKIE)?.value);
      if (session) await revokeSession(session);
    }
    jar.delete(COOKIE);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
