import { cookies } from 'next/headers';
import { accountInput } from '@/lib/server/accounts';
import {
  assertOrigin,
  COOKIE,
  errorResponse,
  requireUser,
  sessionUserId,
  signSession,
} from '@/lib/server/auth';
import { getProfile, profileRateLimit, updateProfile } from '@/lib/server/profile';
import { withClassScope, withDatabase } from '@/lib/server/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function failure(error: unknown) {
  const response = errorResponse(error);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export async function GET() {
  try {
    const id = await sessionUserId();
    return Response.json(
      await withClassScope(
        id,
        async () => ({ classIds: [] }),
        (db) => getProfile(db, id),
      ),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const id = await sessionUserId();
    const input = await accountInput(request);
    const result = await withDatabase((db) => {
      const user = requireUser(db, id, true);
      profileRateLimit(user.id);
      return updateProfile(db, user.id, input);
    }, true);
    if (result.passwordChanged)
      (await cookies()).set(COOKIE, await signSession(result.user.id, result.sessionVersion), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 86400,
      });
    return Response.json(
      { user: result.user, message: result.message },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
