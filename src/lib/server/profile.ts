import { z } from 'zod';
import type { Database } from '@/lib/types';
import { DEFAULT_ACCOUNT_PASSWORD } from '@/lib/account-policy';
import { passwordSchema } from './accounts';
import {
  hashPassword,
  HttpError,
  needsPasswordChange,
  publicUser,
  requireUser,
  verifyPassword,
} from './auth';

export function getProfile(db: Database, userId: string | null) {
  return { user: publicUser(requireUser(db, userId, true)) };
}
export function updateProfile(db: Database, userId: string | null, input: unknown) {
  const user = requireUser(db, userId, true);
  const v = z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      currentPassword: z.string().min(1).max(200).optional(),
      newPassword: passwordSchema.optional(),
      confirmPassword: z.string().max(128).optional(),
    })
    .strict()
    .refine((v) => v.name !== undefined || v.newPassword !== undefined, 'Chưa có thay đổi để lưu.')
    .parse(input);
  const passwordChanged = v.newPassword !== undefined;
  if (needsPasswordChange(user) && !passwordChanged)
    throw new HttpError(403, 'Vui lòng đổi mật khẩu trước khi cập nhật thông tin.');
  if (passwordChanged) {
    if (!v.currentPassword || !verifyPassword(v.currentPassword, user.passwordHash))
      throw new HttpError(400, 'Mật khẩu hiện tại chưa đúng. Vui lòng kiểm tra lại.');
    if (v.confirmPassword !== v.newPassword)
      throw new HttpError(400, 'Mật khẩu nhập lại chưa khớp.');
    if (verifyPassword(v.newPassword!, user.passwordHash))
      throw new HttpError(400, 'Mật khẩu mới cần khác mật khẩu hiện tại.');
    if (v.newPassword === DEFAULT_ACCOUNT_PASSWORD)
      throw new HttpError(400, 'Vui lòng chọn mật khẩu riêng, không dùng mật khẩu cũ phổ biến.');
  } else if (v.currentPassword !== undefined || v.confirmPassword !== undefined) {
    throw new HttpError(400, 'Vui lòng nhập đầy đủ mật khẩu mới và mật khẩu xác nhận.');
  }
  if (v.name !== undefined) user.name = v.name;
  if (v.newPassword !== undefined) {
    user.passwordHash = hashPassword(v.newPassword);
    user.mustChangePassword = false;
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    db.authTokens = db.authTokens.filter((t) => t.userId !== user.id);
  }
  return {
    user: publicUser(user),
    message: passwordChanged
      ? 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã được đăng xuất.'
      : 'Đã cập nhật thông tin cá nhân.',
    passwordChanged,
    sessionVersion: user.sessionVersion ?? 0,
  };
}
const attempts = new Map<string, { count: number; reset: number }>();
export function profileRateLimit(userId: string) {
  const now = Date.now();
  const rate = attempts.get(userId);
  if (rate && rate.reset > now && rate.count >= 30)
    throw new HttpError(429, 'Bạn đã thử thay đổi nhiều lần. Vui lòng thử lại sau 15 phút.');
  attempts.set(userId, {
    count: rate && rate.reset > now ? rate.count + 1 : 1,
    reset: rate && rate.reset > now ? rate.reset : now + 900000,
  });
  if (attempts.size > 10000)
    for (const [id, value] of attempts) if (value.reset <= now) attempts.delete(id);
}
