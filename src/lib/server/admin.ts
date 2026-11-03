import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AdminState, AdminUser, Database, StoredUser } from '@/lib/types';
import { DEFAULT_ACCOUNT_PASSWORD } from '@/lib/account-policy';
import { accountInput, emailSchema } from './accounts';
import {
  assertOrigin,
  errorResponse,
  hashPassword,
  HttpError,
  isDemoAccount,
  requireUser,
  sessionUserId,
} from './auth';
import { withDatabase } from './repository';

const nameSchema = z.string().trim().min(2).max(100);
export function requireAdmin(db: Database, userId: string | null) {
  const user = requireUser(db, userId);
  if (!user.isAdmin) throw new HttpError(403, 'Bạn không có quyền quản trị tài khoản.');
  return user;
}
export function adminUser(db: Database, user: StoredUser): AdminUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ...(user.avatar ? { avatar: user.avatar } : {}),
    isAdmin: user.isAdmin === true,
    emailVerified: user.emailVerified !== false,
    disabled: user.disabled === true,
    isDemo: isDemoAccount(user),
    classCount: db.classes.filter((c) => c.teacherId === user.id).length,
    enrollmentCount: db.enrollments.filter((e) => e.userId === user.id && e.status === 'APPROVED')
      .length,
  };
}
export function adminState(db: Database, userId: string | null): AdminState {
  requireAdmin(db, userId);
  const users = db.users.map((user) => adminUser(db, user));
  return {
    users,
    summary: {
      teachers: users.filter((u) => u.role === 'TEACHER').length,
      students: users.filter((u) => u.role === 'STUDENT').length,
      active: users.filter((u) => u.emailVerified && !u.disabled).length,
      pendingVerification: users.filter((u) => !u.emailVerified && !u.disabled).length,
      disabled: users.filter((u) => u.disabled).length,
      classes: db.classes.length,
    },
  };
}
function managedUser(db: Database, id: string) {
  const user = db.users.find((u) => u.id === id);
  if (!user) throw new HttpError(404, 'Không tìm thấy tài khoản.');
  if (user.role !== 'TEACHER' && user.role !== 'STUDENT')
    throw new HttpError(403, 'Tài khoản không thuộc vai trò được quản lý.');
  return user;
}
export function createManagedUser(db: Database, actorId: string | null, input: unknown) {
  requireAdmin(db, actorId);
  const v = z
    .object({
      name: nameSchema,
      email: emailSchema,
      role: z.enum(['TEACHER', 'STUDENT']).default('TEACHER'),
    })
    .strict()
    .parse(input);
  if (db.users.some((u) => u.email.toLowerCase() === v.email))
    throw new HttpError(409, 'Email đã có tài khoản. Vui lòng dùng địa chỉ khác.');
  const user: StoredUser = {
    id: randomUUID(),
    name: v.name,
    email: v.email,
    role: v.role,
    passwordHash: hashPassword(DEFAULT_ACCOUNT_PASSWORD),
    emailVerified: true,
    isAdmin: false,
    disabled: false,
    sessionVersion: 0,
    isDemo: false,
  };
  db.users.push(user);
  return {
    user: adminUser(db, user),
    message: 'Đã tạo tài khoản. Người dùng có thể đăng nhập bằng mật khẩu mặc định.',
  };
}
export function updateManagedUser(
  db: Database,
  actorId: string | null,
  id: string,
  input: unknown,
) {
  requireAdmin(db, actorId);
  const v = z
    .object({
      name: nameSchema.optional(),
      disabled: z.boolean().optional(),
      emailVerified: z.literal(true).optional(),
    })
    .strict()
    .refine(
      (v) => v.name !== undefined || v.disabled !== undefined || v.emailVerified !== undefined,
      'Chưa có thay đổi để lưu.',
    )
    .parse(input);
  const user = managedUser(db, id);
  if ((v.disabled !== undefined || v.emailVerified !== undefined) && user.isAdmin)
    throw new HttpError(403, 'Không thể thay đổi trạng thái tài khoản quản trị tại đây.');
  if (v.name !== undefined) user.name = v.name;
  const statusChanged = v.disabled !== undefined && v.disabled !== (user.disabled === true);
  const activated = v.emailVerified === true && user.emailVerified === false;
  if (v.disabled !== undefined) user.disabled = v.disabled;
  if (v.emailVerified === true) user.emailVerified = true;
  if (statusChanged || activated) {
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    db.authTokens = db.authTokens.filter((t) => t.userId !== user.id);
  }
  return {
    user: adminUser(db, user),
    message:
      v.disabled !== undefined
        ? v.disabled
          ? 'Đã khóa tài khoản và đăng xuất các phiên đang dùng.'
          : 'Đã mở khóa tài khoản. Người dùng có thể đăng nhập lại.'
        : activated
          ? 'Đã kích hoạt tài khoản. Người dùng có thể đăng nhập bằng email và mật khẩu.'
          : 'Đã cập nhật thông tin tài khoản.',
  };
}
export function resetManagedPassword(
  db: Database,
  actorId: string | null,
  id: string,
  input: unknown = {},
) {
  requireAdmin(db, actorId);
  z.object({}).strict().parse(input);
  const user = managedUser(db, id);
  if (user.isAdmin)
    throw new HttpError(403, 'Không thể đặt lại mật khẩu tài khoản quản trị tại đây.');
  user.passwordHash = hashPassword(DEFAULT_ACCOUNT_PASSWORD);
  user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  db.authTokens = db.authTokens.filter((t) => t.userId !== user.id);
  return {
    message: 'Đã khôi phục mật khẩu mặc định và đăng xuất các phiên cũ.',
  };
}
const attempts = new Map<string, { count: number; reset: number }>();
function adminRateLimit(userId: string) {
  const now = Date.now();
  const rate = attempts.get(userId);
  if (rate && rate.reset > now && rate.count >= 120)
    throw new HttpError(429, 'Bạn đã thực hiện nhiều thay đổi. Vui lòng thử lại sau.');
  attempts.set(userId, {
    count: rate && rate.reset > now ? rate.count + 1 : 1,
    reset: rate && rate.reset > now ? rate.reset : now + 900000,
  });
  if (attempts.size > 10000)
    for (const [id, value] of attempts) if (value.reset <= now) attempts.delete(id);
}
export async function adminRequest(
  request: Request,
  write: boolean,
  fn: (db: Database, actorId: string, input: Record<string, unknown>) => unknown,
) {
  try {
    if (write) assertOrigin(request);
    const id = await sessionUserId();
    const input = write && request.body ? await accountInput(request) : {};
    const result = await withDatabase((db) => {
      const actor = requireAdmin(db, id);
      if (write) adminRateLimit(actor.id);
      return fn(db, actor.id, input);
    }, write);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
