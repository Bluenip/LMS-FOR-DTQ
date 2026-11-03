import { cookies } from 'next/headers';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { emailSchema } from '@/lib/server/accounts';
import { readJsonObject } from '@/lib/server/request';
import { clientIp, SharedRateLimit } from '@/lib/server/rate-limit';
import {
  assertOrigin,
  COOKIE,
  errorResponse,
  HttpError,
  publicUser,
  signSession,
  hashPassword,
  verifyPassword,
  accountEnabled,
} from '@/lib/server/auth';
import { findUserByEmail } from '@/lib/server/repository';
export const runtime = 'nodejs';
const attempts = new SharedRateLimit('login', 20, 15 * 60 * 1000);
// Verifying against this when the email is unknown keeps response times equal, so attackers cannot
// learn which emails have accounts from how long a login takes.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const v = z
      .object({ email: emailSchema, password: z.string().min(1).max(200) })
      .parse(await readJsonObject(request));
    const key = createHash('sha256')
      .update(`${clientIp(request)}:${v.email}`)
      .digest('hex');
    await attempts.consume(key);
    const user = await findUserByEmail(v.email);
    if (!verifyPassword(v.password, user?.passwordHash ?? DUMMY_HASH) || !user) {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng.');
    }
    if (user.disabled)
      throw new HttpError(
        403,
        'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
      );
    if (user.emailVerified === false)
      throw new HttpError(
        403,
        'Tài khoản chưa được kích hoạt. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
      );
    if (!accountEnabled(user, request))
      throw new HttpError(
        403,
        'Tài khoản mẫu đã tắt trên hệ thống chính thức. Vui lòng dùng tài khoản được quản trị viên cấp.',
      );
    await attempts.reset(key);
    (await cookies()).set(COOKIE, await signSession(user.id, user.sessionVersion ?? 0), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 86400,
    });
    return Response.json({ user: publicUser(user) });
  } catch (e) {
    return errorResponse(e);
  }
}
