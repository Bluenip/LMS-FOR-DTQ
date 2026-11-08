import { cookies } from 'next/headers';
import { z } from 'zod';
import { emailSchema } from '@/lib/server/accounts';
import { readJsonObject } from '@/lib/server/request';
import { clientIp, consumeSharedRateLimit, releaseSharedRateLimit } from '@/lib/server/rate-limit';
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
import { findLoginUser } from '@/lib/server/repository';
export const runtime = 'nodejs';
const dummyHash = `00000000000000000000000000000000:${'0'.repeat(128)}`;
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const v = z
      .object({ email: emailSchema, password: z.string().min(1).max(200) })
      .parse(await readJsonObject(request));
    const ip = clientIp(request);
    const windowMs = 15 * 60 * 1000;
    const ipKey = `login:ip:${ip}`;
    const pairKey = `login:pair:${ip}:${v.email.toLowerCase()}`;
    // Reserve before password verification so parallel requests cannot bypass limits.
    await consumeSharedRateLimit(ipKey, 300, windowMs);
    try {
      await consumeSharedRateLimit(pairKey, 20, windowMs);
    } catch (error) {
      await releaseSharedRateLimit(ipKey);
      throw error;
    }
    const user = await findLoginUser(v.email);
    const valid = verifyPassword(v.password, user?.passwordHash ?? dummyHash);
    if (!user || !valid) {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng.');
    }
    await Promise.all([releaseSharedRateLimit(ipKey), releaseSharedRateLimit(pairKey)]);
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
