import { cookies } from 'next/headers';
import { assertOrigin, COOKIE, errorResponse, readSession } from '@/lib/server/auth';
import { revokeSession } from '@/lib/server/repository';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const jar = await cookies();
    const session = await readSession(jar.get(COOKIE)?.value);
    if (session) await revokeSession(session);
    jar.delete(COOKIE);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
