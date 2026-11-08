import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_PASSWORD } from '@/lib/account-policy';
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
import { findSessionUser, recordAudit, withAdminDatabase, withDatabase } from './repository';
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
/**
 * New and reset accounts start with the shared default password (DEFAULT_ACCOUNT_PASSWORD) and
 * must choose their own at first sign-in; the default can never be chosen again (see profile.ts).
 */
function temporaryCredential(): TemporaryCredential {
  const password = DEFAULT_ACCOUNT_PASSWORD;
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
    message: `Đã tạo tài khoản. Mật khẩu đăng nhập lần đầu: ${prepared.password}.`,
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
    message: `Đã đặt lại mật khẩu về mặc định (${prepared.password}) và đăng xuất các phiên cũ.`,
    temporaryPassword: prepared.password,
  };
}
/**
 * Permanently deletes a teacher or student account and everything that only belongs to it:
 * sessions, enrollments, submissions, progress, notes, discussions, notifications and the
 * person's own files. Class material the person uploaded and a lesson still uses is handed to
 * the class owner instead, so lessons keep working. Drive files are queued for removal.
 * Administrators, the caller and class owners are refused; the email must be typed to confirm.
 */
export function deleteManagedUser(
  db: Database,
  actorId: string | null,
  id: string,
  input: unknown,
) {
  const actor = requireAdmin(db, actorId);
  const v = z
    .object({ confirmEmail: z.string().trim().max(320) })
    .strict()
    .parse(input);
  const user = managedUser(db, id);
  if (user.id === actor.id) throw new HttpError(403, 'Không thể tự xóa tài khoản của mình.');
  if (user.isAdmin)
    throw new HttpError(403, 'Không thể xóa tài khoản quản trị. Hãy thu hồi quyền quản trị trước.');
  if (v.confirmEmail.toLowerCase() !== user.email.toLowerCase())
    throw new HttpError(409, 'Email xác nhận không khớp. Kiểm tra lại trước khi xóa.');
  const owned = db.classes.filter((c) => c.teacherId === user.id);
  if (owned.length)
    throw new HttpError(
      409,
      `Tài khoản đang quản lý ${owned.length} lớp. Hãy chuyển quyền quản lý lớp trước khi xóa.`,
    );
  const now = new Date().toISOString();
  // Co-teaching assignments are a plain id list, not a foreign key.
  for (const classroom of db.classes)
    if (classroom.teacherIds?.includes(user.id)) {
      classroom.teacherIds = classroom.teacherIds.filter((teacherId) => teacherId !== user.id);
      classroom.revision = randomUUID();
    }
  const lessonUses = (fileId: string, driveFileId?: string) =>
    db.lessons.find(
      (l) =>
        l.videoFileId === fileId ||
        (!!driveFileId && l.driveFileId === driveFileId) ||
        l.documents.some((d) => d.id === fileId),
    );
  const ownerOf = (classId: string) => db.classes.find((c) => c.id === classId)?.teacherId;
  // Files: lesson material is kept and handed to the class owner; everything else goes.
  for (const file of db.files.filter((f) => f.ownerId === user.id)) {
    const owner = lessonUses(file.id) && ownerOf(file.classId);
    if (owner) file.ownerId = owner;
  }
  db.files = db.files.filter((f) => f.ownerId !== user.id);
  for (const upload of db.driveUploads.filter((u) => u.ownerId === user.id)) {
    const owner = lessonUses(upload.id, upload.driveFileId) && ownerOf(upload.classId);
    if (owner) upload.ownerId = owner;
    else if (upload.driveFileId && !db.driveTrash.some((t) => t.id === upload.driveFileId))
      db.driveTrash.push({ id: upload.driveFileId, createdAt: now });
  }
  db.driveUploads = db.driveUploads.filter((u) => u.ownerId !== user.id);
  // The shared Drive connection must survive the person who happened to connect it.
  for (const connection of db.driveConnections)
    if (connection.connectedById === user.id) connection.connectedById = actor.id;
  const removedSubmissions = db.submissions.filter((s) => s.studentId === user.id).length;
  db.authTokens = db.authTokens.filter((t) => t.userId !== user.id);
  db.enrollments = db.enrollments.filter((e) => e.userId !== user.id);
  db.submissions = db.submissions.filter((s) => s.studentId !== user.id);
  db.progress = db.progress.filter((p) => p.userId !== user.id);
  db.practiceChecks = db.practiceChecks.filter((p) => p.studentId !== user.id);
  db.notes = db.notes.filter((n) => n.userId !== user.id);
  db.discussions = db.discussions.filter((d) => d.userId !== user.id);
  db.notifications = db.notifications.filter((n) => n.userId !== user.id);
  db.users = db.users.filter((u) => u.id !== user.id);
  return {
    deleted: { id: user.id, email: user.email, role: user.role, submissions: removedSubmissions },
    message: `Đã xóa vĩnh viễn tài khoản ${user.email}.`,
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
    /** Rare, wide changes (deleting an account) read and lock the whole database. */
    fullSnapshot?: boolean;
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
    const guarded = (db: Database) => {
      const actor = requireAdmin(db, id);
      if (!session || !sessionMatches(actor, session))
        throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
      return fn(db, actor.id, input, credential);
    };
    const result = options.fullSnapshot
      ? await withDatabase(guarded, write)
      : await withAdminDatabase(
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
          guarded,
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
