import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cookies } from 'next/headers';
import type { AdminState, AdminUser, Database, StoredUser } from '@/lib/types';
import { assignedTeacherIds, managesClass } from '@/lib/class-teachers';
import { accountInput, emailSchema } from './accounts';
import {
  assertOrigin,
  accountEnabled,
  COOKIE,
  errorResponse,
  hashPassword,
  HttpError,
  isDemoAccount,
  requireUser,
  readSession,
  sessionMatches,
  sessionUserId,
} from './auth';
import { findSessionUser, recordAudit, withAdminDatabase } from './repository';
import { consumeSharedRateLimit } from './rate-limit';

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
    classCount: db.classes.filter((c) => managesClass(c, user)).length,
    enrollmentCount: db.enrollments.filter((e) => e.userId === user.id && e.status === 'APPROVED')
      .length,
  };
}
export function adminState(db: Database, userId: string | null): AdminState {
  requireAdmin(db, userId);
  const users = db.users.map((user) => adminUser(db, user));
  return {
    users,
    managedClasses: db.classes.map(({ id, title, teacherId }) => ({ id, title, teacherId })),
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
type TemporaryCredential = { password: string; hash: string };
function temporaryCredential(): TemporaryCredential {
  const password = randomBytes(12).toString('base64url');
  return { password, hash: hashPassword(password) };
}
export function createManagedUser(
  db: Database,
  actorId: string | null,
  input: unknown,
  credential?: TemporaryCredential,
) {
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
  const prepared = credential ?? temporaryCredential();
  const user: StoredUser = {
    id: randomUUID(),
    name: v.name,
    email: v.email,
    role: v.role,
    passwordHash: prepared.hash,
    mustChangePassword: true,
    emailVerified: true,
    isAdmin: false,
    disabled: false,
    sessionVersion: 0,
    isDemo: false,
  };
  db.users.push(user);
  return {
    user: adminUser(db, user),
    message: 'Đã tạo tài khoản. Hãy chuyển mật khẩu tạm riêng cho người dùng.',
    temporaryPassword: prepared.password,
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
      role: z.enum(['TEACHER', 'STUDENT']).optional(),
      disabled: z.boolean().optional(),
      emailVerified: z.literal(true).optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.name !== undefined ||
        v.role !== undefined ||
        v.disabled !== undefined ||
        v.emailVerified !== undefined,
      'Chưa có thay đổi để lưu.',
    )
    .parse(input);
  const user = managedUser(db, id);
  if ((v.disabled !== undefined || v.emailVerified !== undefined) && user.isAdmin)
    throw new HttpError(403, 'Không thể thay đổi trạng thái tài khoản quản trị tại đây.');
  const roleChanged = v.role !== undefined && v.role !== user.role;
  if (roleChanged) {
    if (user.isAdmin)
      throw new HttpError(403, 'Không thể đổi vai trò của tài khoản quản trị tại đây.');
    if (
      v.role === 'STUDENT' &&
      db.classes.some((c) => c.teacherId === user.id || assignedTeacherIds(c).includes(user.id))
    )
      throw new HttpError(
        409,
        'Hãy chuyển quyền quản lý và gỡ phân công giáo viên trước khi đổi vai trò.',
      );
    user.role = v.role!;
  }
  if (v.name !== undefined) user.name = v.name;
  const statusChanged = v.disabled !== undefined && v.disabled !== (user.disabled === true);
  const activated = v.emailVerified === true && user.emailVerified === false;
  if (v.disabled !== undefined) user.disabled = v.disabled;
  if (v.emailVerified === true) user.emailVerified = true;
  if (statusChanged || activated || roleChanged) {
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
export function transferClassOwner(
  db: Database,
  actorId: string | null,
  classId: string,
  input: unknown,
) {
  requireAdmin(db, actorId);
  const v = z
    .object({ teacherId: z.string().min(1), expectedTeacherId: z.string().min(1) })
    .strict()
    .parse(input);
  const classroom = db.classes.find((c) => c.id === classId);
  if (!classroom) throw new HttpError(404, 'Không tìm thấy lớp học.');
  if (classroom.teacherId !== v.expectedTeacherId)
    throw new HttpError(409, 'Chủ lớp đã thay đổi. Hãy tải lại danh sách.');
  const teacher = db.users.find((u) => u.id === v.teacherId);
  if (!teacher || teacher.role !== 'TEACHER' || !accountEnabled(teacher))
    throw new HttpError(400, 'Chọn một giáo viên đang hoạt động.');
  if (
    db.enrollments.some(
      (e) => e.classId === classroom.id && e.userId === teacher.id && e.status !== 'REMOVED',
    )
  )
    throw new HttpError(
      409,
      'Giáo viên đang là học viên lớp này; cần rời lớp trước khi chuyển quyền.',
    );
  classroom.teacherId = teacher.id;
  classroom.revision = randomUUID();
  return { message: 'Đã chuyển quyền quản lý lớp. Danh sách giáo viên phụ trách được giữ nguyên.' };
}
export function resetManagedPassword(
  db: Database,
  actorId: string | null,
  id: string,
  input: unknown = {},
  credential?: TemporaryCredential,
) {
  requireAdmin(db, actorId);
  z.object({}).strict().parse(input);
  const user = managedUser(db, id);
  if (user.isAdmin)
    throw new HttpError(403, 'Không thể đặt lại mật khẩu tài khoản quản trị tại đây.');
  const prepared = credential ?? temporaryCredential();
  user.passwordHash = prepared.hash;
  user.mustChangePassword = true;
  user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  db.authTokens = db.authTokens.filter((t) => t.userId !== user.id);
  return {
    message: 'Đã tạo mật khẩu tạm mới và đăng xuất các phiên cũ.',
    temporaryPassword: prepared.password,
  };
}
export async function adminRequest(
  request: Request,
  options: {
    write: boolean;
    targetId?: string;
    classId?: string;
    exclusive?: boolean;
    credential?: boolean;
    create?: boolean;
  },
  fn: (
    db: Database,
    actorId: string,
    input: Record<string, unknown>,
    credential?: TemporaryCredential,
  ) => unknown,
  audit?: {
    action: string;
    target?: string;
    detail?: (result: unknown, input: Record<string, unknown>) => string;
  },
) {
  try {
    const { write } = options;
    if (write) assertOrigin(request);
    const id = await sessionUserId();
    const session = await readSession((await cookies()).get(COOKIE)?.value);
    const input = write && request.body ? await accountInput(request) : {};
    if (write && id)
      await consumeSharedRateLimit(
        `admin:${id}`,
        120,
        15 * 60 * 1000,
        'Bạn đã thực hiện nhiều thay đổi. Vui lòng thử lại sau.',
      );
    // Derive slow password hashes outside database locks, after verifying the caller.
    let credential: TemporaryCredential | undefined;
    if (options.credential && process.env.DATABASE_URL) {
      const actor = id && (await findSessionUser(id));
      if (actor && accountEnabled(actor) && actor.isAdmin) credential = temporaryCredential();
    }
    const result = await withAdminDatabase(
      id,
      {
        ...options,
        exclusive:
          options.exclusive === true ||
          (!!options.targetId &&
            ['name', 'role', 'disabled', 'emailVerified'].some((key) => key in input)),
        renameOnly:
          options.exclusive !== true &&
          !!options.targetId &&
          'name' in input &&
          !['role', 'disabled', 'emailVerified'].some((key) => key in input),
        candidateId: typeof input.teacherId === 'string' ? input.teacherId : undefined,
        email:
          options.create && typeof input.email === 'string'
            ? input.email.trim().toLowerCase()
            : undefined,
      },
      (db) => {
        const actor = requireAdmin(db, id);
        if (!session || !sessionMatches(actor, session))
          throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
        return fn(db, actor.id, input, credential);
      },
    );
    if (write && audit && id)
      await recordAudit(id, audit.action, audit.target, audit.detail?.(result, input) ?? '');
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
