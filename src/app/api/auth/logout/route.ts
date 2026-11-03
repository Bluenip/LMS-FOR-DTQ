import { cookies } from 'next/headers';
import { assertOrigin, COOKIE, errorResponse } from '@/lib/server/auth';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    (await cookies()).delete(COOKIE);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
