import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthToken, Database, StoredUser } from '@/lib/types';
import { hashPassword, HttpError, isDemoAccount } from './auth';
import { emailMode, sendAccountMail, type AccountMail } from './mail';
import { readJsonObject } from './request';

export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  .max(128, 'Mật khẩu tối đa 128 ký tự.');
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(200)
  .transform((value) => value.toLowerCase());
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const invalidToken = () =>
  new HttpError(
    400,
    'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu liên kết mới.',
  );
export const REGISTER_MESSAGE =
  'Nếu địa chỉ email có thể đăng ký, liên kết xác minh đã được tạo. Vui lòng kiểm tra hộp thư để tiếp tục.';
export const VERIFY_MESSAGE =
  'Nếu tài khoản cần xác minh, email hướng dẫn đã được tạo. Vui lòng kiểm tra hộp thư và thư rác.';
export const RESET_MESSAGE =
  'Nếu email thuộc tài khoản phù hợp, hướng dẫn đặt lại mật khẩu đã được tạo. Vui lòng kiểm tra hộp thư và thư rác.';
export type Delivery = (mail: AccountMail) => Promise<{ previewUrl?: string }>;
const attempts = new Map<string, { count: number; reset: number }>();
export function accountRateLimit(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const key = createHash('sha256').update(ip).digest('hex');
  const now = Date.now();
  const previous = attempts.get(key);
  if (attempts.size >= 10000 && !previous) {
    for (const [entry, value] of attempts) if (value.reset <= now) attempts.delete(entry);
    if (attempts.size >= 10000)
      throw new HttpError(429, 'Hệ thống đang nhận nhiều yêu cầu. Vui lòng thử lại sau.');
  }
  if (previous && previous.reset > now && previous.count >= 30)
    throw new HttpError(429, 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.');
  attempts.set(key, {
    count: previous && previous.reset > now ? previous.count + 1 : 1,
    reset: previous && previous.reset > now ? previous.reset : now + 900000,
  });
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
}
export const accountInput = readJsonObject;
function passwordInput(input: unknown) {
  const v = z
    .object({ password: passwordSchema, confirmPassword: z.string().optional() })
    .parse(input);
  if (v.confirmPassword !== undefined && v.password !== v.confirmPassword)
    throw new HttpError(400, 'Mật khẩu xác nhận chưa khớp.');
  return v.password;
}
export function tokenHash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
export function createAuthToken(
  db: Database,
  userId: string,
  purpose: AuthToken['purpose'],
  now = Date.now(),
  pending?: { passwordHash: string; name: string },
) {
  const raw = randomBytes(32).toString('hex');
  db.authTokens = db.authTokens.filter(
    (t) => Date.parse(t.expiresAt) > now && !(t.userId === userId && t.purpose === purpose),
  );
  const token: AuthToken = {
    id: randomUUID(),
    userId,
    tokenHash: tokenHash(raw),
    purpose,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (purpose === 'VERIFY_EMAIL' ? 3600000 : 1800000)).toISOString(),
    ...(purpose === 'VERIFY_EMAIL' && pending
      ? { pendingPasswordHash: pending.passwordHash, pendingName: pending.name }
      : {}),
  };
  db.authTokens.push(token);
  return raw;
}
function tokenUser(db: Database, raw: unknown, purpose: AuthToken['purpose'], now = Date.now()) {
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) throw invalidToken();
  const token = db.authTokens.find(
    (t) =>
      t.tokenHash === tokenHash(parsed.data) &&
      t.purpose === purpose &&
      !t.consumedAt &&
      Date.parse(t.expiresAt) > now,
  );
  const user = token && db.users.find((u) => u.id === token.userId);
  if (!token || !user) throw invalidToken();
  return { token, user };
}
function recentlyIssued(db: Database, userId: string, purpose: AuthToken['purpose']) {
  return db.authTokens.some(
    (t) =>
      t.userId === userId && t.purpose === purpose && Date.parse(t.createdAt) > Date.now() - 60000,
  );
}
function ensureDelivery() {
  if (emailMode() === 'unavailable')
    throw new HttpError(
      503,
      'Email chưa được cấu hình. Vui lòng liên hệ quản trị viên để hỗ trợ tài khoản.',
    );
}
async function deliverToken(
  db: Database,
  user: StoredUser,
  purpose: AuthToken['purpose'],
  origin: string,
  deliver: Delivery,
  pending?: { passwordHash: string; name: string },
) {
  const token = createAuthToken(db, user.id, purpose, Date.now(), pending);
  const url = new URL(purpose === 'VERIFY_EMAIL' ? '/verify-email' : '/reset-password', origin);
  url.searchParams.set('token', token);
  return deliver({ to: user.email, url: url.href, purpose });
}
export async function registerAccount(
  db: Database,
  input: unknown,
  origin: string,
  deliver: Delivery = sendAccountMail,
) {
  const v = z
    .object({
      name: z.string().trim().min(2).max(100),
      email: emailSchema,
      password: passwordSchema,
      confirmPassword: z.string().optional(),
      role: z.literal('STUDENT').optional(),
    })
    .parse(input);
  passwordInput(v);
  ensureDelivery();
  const previous = db.users.find((u) => u.email.toLowerCase() === v.email);
  if (previous) {
    if (previous.emailVerified === false) {
      if (recentlyIssued(db, previous.id, 'VERIFY_EMAIL'))
        throw new HttpError(
          429,
          'Email này vừa được yêu cầu đăng ký. Vui lòng đợi một phút rồi đăng ký lại bằng mật khẩu của bạn.',
        );
      return {
        message: REGISTER_MESSAGE,
        ...(await deliverToken(db, previous, 'VERIFY_EMAIL', origin, deliver, {
          passwordHash: hashPassword(v.password),
          name: v.name,
        })),
      };
    }
    return { message: REGISTER_MESSAGE };
  }
  const user: StoredUser = {
    id: randomUUID(),
    name: v.name,
    email: v.email,
    role: 'STUDENT',
    passwordHash: hashPassword(v.password),
    emailVerified: false,
    sessionVersion: 0,
    isDemo: false,
  };
  db.users.push(user);
  return {
    message: REGISTER_MESSAGE,
    ...(await deliverToken(db, user, 'VERIFY_EMAIL', origin, deliver, {
      passwordHash: user.passwordHash,
      name: user.name,
    })),
  };
}
export async function resendVerification(
  db: Database,
  input: unknown,
  origin: string,
  deliver: Delivery = sendAccountMail,
) {
  const { email } = z.object({ email: emailSchema }).parse(input);
  ensureDelivery();
  const user = db.users.find((u) => u.email.toLowerCase() === email && u.emailVerified === false);
  if (!user || recentlyIssued(db, user.id, 'VERIFY_EMAIL')) return { message: VERIFY_MESSAGE };
  const previous = [...db.authTokens]
    .reverse()
    .find((t) => t.userId === user.id && t.purpose === 'VERIFY_EMAIL' && !t.consumedAt);
  return {
    message: VERIFY_MESSAGE,
    ...(await deliverToken(db, user, 'VERIFY_EMAIL', origin, deliver, {
      passwordHash: previous?.pendingPasswordHash || user.passwordHash,
      name: previous?.pendingName || user.name,
    })),
  };
}
export function verifyEmail(db: Database, input: unknown, now = Date.now()) {
  const { token: raw } = z.object({ token: z.unknown() }).parse(input);
  const { token, user } = tokenUser(db, raw, 'VERIFY_EMAIL', now);
  if (user.emailVerified !== false) throw invalidToken();
  if (token.pendingPasswordHash) user.passwordHash = token.pendingPasswordHash;
  if (token.pendingName) user.name = token.pendingName;
  user.emailVerified = true;
  token.consumedAt = new Date(now).toISOString();
  db.authTokens.forEach((t) => {
    if (t.userId === user.id && t.purpose === 'VERIFY_EMAIL' && !t.consumedAt)
      t.consumedAt = token.consumedAt;
  });
  return { message: 'Email đã được xác minh. Bạn có thể đăng nhập để bắt đầu học tập.' };
}
export async function forgotPassword(
  db: Database,
  input: unknown,
  origin: string,
  deliver: Delivery = sendAccountMail,
) {
  const { email } = z.object({ email: emailSchema }).parse(input);
  ensureDelivery();
  const user = db.users.find((u) => u.email.toLowerCase() === email && u.emailVerified !== false);
  if (
    !user ||
    recentlyIssued(db, user.id, 'RESET_PASSWORD') ||
    (emailMode() === 'preview' && isDemoAccount(user))
  )
    return { message: RESET_MESSAGE };
  return {
    message: RESET_MESSAGE,
    ...(await deliverToken(db, user, 'RESET_PASSWORD', origin, deliver)),
  };
}
export function resetPassword(db: Database, input: unknown, now = Date.now()) {
  const { token: raw } = z.object({ token: z.unknown() }).parse(input);
  const password = passwordInput(input);
  const { token, user } = tokenUser(db, raw, 'RESET_PASSWORD', now);
  if (user.emailVerified === false) throw invalidToken();
  user.passwordHash = hashPassword(password);
  user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  token.consumedAt = new Date(now).toISOString();
  db.authTokens.forEach((t) => {
    if (t.userId === user.id && !t.consumedAt) t.consumedAt = token.consumedAt;
  });
  return { message: 'Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại bằng mật khẩu mới.' };
}
