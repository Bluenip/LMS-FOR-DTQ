import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  assertOrigin,
  COOKIE,
  errorResponse,
  HttpError,
  publicUser,
  signSession,
  verifyPassword,
  accountEnabled,
} from '@/lib/server/auth';
import { withDatabase } from '@/lib/server/repository';
export const runtime = 'nodejs';
const attempts = new Map<string, { count: number; reset: number }>();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const key = request.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
    const rate = attempts.get(key);
    if (rate && rate.reset > Date.now() && rate.count >= 20)
      throw new HttpError(429, 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.');
    const v = z
      .object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
      .parse(await request.json());
    const user = await withDatabase((db) =>
      db.users.find((u) => u.email.toLowerCase() === v.email.toLowerCase()),
    );
    if (!user || !verifyPassword(v.password, user.passwordHash)) {
      attempts.set(key, {
        count: (rate && rate.reset > Date.now() ? rate.count : 0) + 1,
        reset: rate?.reset && rate.reset > Date.now() ? rate.reset : Date.now() + 900000,
      });
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng.');
    }
    attempts.delete(key);
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
        'Tài khoản mẫu đã tắt trên hệ thống chính thức. Vui lòng dùng tài khoản được cấp hoặc đăng ký học viên.',
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
