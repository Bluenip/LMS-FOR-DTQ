import { cookies } from 'next/headers';
import { accountInput } from '@/lib/server/accounts';
import {
  assertOrigin,
  COOKIE,
  errorResponse,
  readSession,
  requireUser,
  sessionMatches,
  sessionUserId,
  signSession,
} from '@/lib/server/auth';
import { getProfile, updateProfile } from '@/lib/server/profile';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit';
import {
  commitProfileUpdate,
  findSessionUser,
  withClassScope,
  withDatabase,
} from '@/lib/server/repository';
import type { Database } from '@/lib/types';
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
    if (id)
      await consumeSharedRateLimit(
        `profile:${id}`,
        30,
        15 * 60 * 1000,
        'Bạn đã thử thay đổi nhiều lần. Vui lòng thử lại sau 15 phút.',
      );
    const result = process.env.DATABASE_URL
      ? await (async () => {
          const existing = id ? await findSessionUser(id) : undefined;
          const session = await readSession((await cookies()).get(COOKIE)?.value);
          const db = {
            users:
              existing && session && sessionMatches(existing, session)
                ? [structuredClone(existing)]
                : [],
            authTokens: [],
            classes: [],
            enrollments: [],
            lessons: [],
            assignments: [],
            submissions: [],
            progress: [],
            notes: [],
            discussions: [],
            notifications: [],
            files: [],
          } as unknown as Database;
          const user = requireUser(db, id, true);
          const result = updateProfile(db, user.id, input);
          await commitProfileUpdate(existing!, user, result.passwordChanged);
          return result;
        })()
      : await withDatabase((db) => {
          const user = requireUser(db, id, true);
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
