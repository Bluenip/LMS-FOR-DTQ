import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, DriveFile, DriveStatus, DriveUpload, StoredUser } from '@/lib/types';
import { managesClass } from '@/lib/class-teachers';
import { accessDriveDocument, driveJobUnused, isClassMaterial, teacherClass } from './actions';
import { assertOrigin, errorResponse, HttpError, requireUser, sessionUserId } from './auth';
import {
  appOrigin,
  authorizationUrl,
  cancelResumable,
  CHUNK_SIZE,
  clearAccessTokenCache,
  CONNECTION_ID,
  createFolder,
  decryptSecret,
  deleteDriveFile,
  driveDownload,
  driveAccountEmail,
  driveConfigured,
  DRIVE_SCOPE,
  encryptSecret,
  ensurePublicReader,
  exchangeCode,
  getDriveFile,
  listDriveFiles,
  matchesOfficeTail,
  matchesSignature,
  needsOfficeCheck,
  readFileTail,
  newOAuthState,
  previewUrl,
  queryResumable,
  readFileHead,
  rememberAccessToken,
  renameDriveFile,
  revokePublicReader,
  revokeToken,
  startResumable,
  statesMatch,
  type DriveRemoteFile,
} from './google-drive';
import { consumeSharedRateLimit, RateLimit } from './rate-limit';
import { readJsonObject } from './request';
import { recordAudit, withDatabase } from './repository';
import { MAX_DOCUMENT, MAX_VIDEO } from './storage';

const FOLDER_NAME = 'LMS Đệ Tử Quy';
const SESSION_LIFETIME_MS = 6 * 86400000; // Drive keeps resumable sessions for one week.
const MAX_ACTIVE_JOBS = 10;
const ACTIVE = ['PENDING', 'UPLOADING'] as const;
const STATE_COOKIE = 'dtq_drive_state';
const callLimit = new RateLimit(
  600,
  15 * 60 * 1000,
  10000,
  'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const FORMATS: Record<string, { mime: string; kind: 'video' | 'document' }> = {
  mp4: { mime: 'video/mp4', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  pdf: { mime: 'application/pdf', kind: 'document' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
  },
  jpg: { mime: 'image/jpeg', kind: 'document' },
  jpeg: { mime: 'image/jpeg', kind: 'document' },
  png: { mime: 'image/png', kind: 'document' },
  gif: { mime: 'image/gif', kind: 'document' },
  webp: { mime: 'image/webp', kind: 'document' },
};
const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() || '';
const fileName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !/[\\/\u0000-\u001f]/u.test(v), 'Tên tệp không hợp lệ.');
const initSchema = z.object({
  classId: z.string().min(1).max(120),
  lessonId: z.string().min(1).max(120).nullable().optional(),
  name: fileName,
  size: z.number().int().positive(),
  mimeType: z.string().max(200),
  kind: z.enum(['video', 'document']),
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(5000).default(''),
});
export function validateDriveUpload(raw: unknown) {
  const v = initSchema.parse(raw);
  const format = FORMATS[extensionOf(v.name)];
  if (!format || format.mime !== v.mimeType || format.kind !== v.kind)
    throw new HttpError(
      400,
      'Định dạng tệp không hợp lệ. Video: MP4, WebM, MOV. Tài liệu: PDF, DOCX, PPTX, JPG, PNG, GIF, WebP.',
    );
  if (v.size > (v.kind === 'video' ? MAX_VIDEO : MAX_DOCUMENT))
    throw new HttpError(413, v.kind === 'video' ? 'Video tối đa 2 GB.' : 'Tài liệu tối đa 25 MB.');
  return v;
}

// ---------------------------------------------------------------------------
// DTOs and access helpers
// ---------------------------------------------------------------------------
export function driveFileDto(job: DriveUpload): DriveFile {
  const { encryptedSessionUri: _secret, ...rest } = job;
  return {
    ...rest,
    ...(job.driveFileId && job.status === 'COMPLETED'
      ? { previewUrl: previewUrl(job.driveFileId) }
      : {}),
  };
}
function now() {
  return new Date().toISOString();
}
function readUser(db: Database, userId: string) {
  return requireUser(db, userId);
}
/** Owner, administrator, or a teacher who manages the class. Prevents IDOR on job ids. */
function jobFor(db: Database, user: StoredUser, jobId: string) {
  const job = db.driveUploads.find((u) => u.id === jobId);
  if (!job) throw new HttpError(404, 'Không tìm thấy tệp tải lên.');
  const classroom = db.classes.find((c) => c.id === job.classId);
  if (job.ownerId !== user.id && !user.isAdmin && !(classroom && managesClass(classroom, user)))
    throw new HttpError(403, 'Bạn không có quyền với tệp này.');
  return job;
}
/**
 * Owner or administrator may change a file. A class's teachers may only change class material,
 * never a learner's own files (renaming, unsharing or deleting someone else's work).
 */
function mutableJob(db: Database, user: StoredUser, jobId: string) {
  const job = jobFor(db, user, jobId);
  if (job.ownerId !== user.id && !user.isAdmin && !isClassMaterial(db, job))
    throw new HttpError(
      403,
      'Chỉ chủ tệp hoặc quản trị viên được thay đổi tệp bài làm của học viên.',
    );
  return job;
}
function requireAdminUser(db: Database, userId: string) {
  const user = readUser(db, userId);
  if (!user.isAdmin)
    throw new HttpError(403, 'Chỉ quản trị viên được quản lý kết nối Google Drive.');
  return user;
}
function expireIfStale(job: DriveUpload) {
  return (
    (ACTIVE as readonly string[]).includes(job.status) &&
    Date.parse(job.createdAt) < Date.now() - SESSION_LIFETIME_MS
  );
}

// ---------------------------------------------------------------------------
// Connection (OAuth)
// ---------------------------------------------------------------------------
export async function connectionStatus(userId: string): Promise<DriveStatus> {
  return withDatabase((db) => {
    const user = readUser(db, userId);
    const connection = db.driveConnections.find((c) => c.id === CONNECTION_ID);
    return {
      configured: driveConfigured(),
      connected: connection?.status === 'ACTIVE',
      ...(connection ? { status: connection.status } : {}),
      ...(connection && user.isAdmin ? { email: connection.email } : {}),
      canConnect: user.isAdmin === true,
    };
  }, false);
}
function cookieAttrs(request: Request, maxAge: number) {
  const secure = appOrigin(request).startsWith('https://') ? '; Secure' : '';
  return `Path=/api/drive; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export async function beginConnect(request: Request) {
  const userId = await sessionUserId();
  if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
  await withDatabase((db) => requireAdminUser(db, userId));
  const state = newOAuthState();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl(request, state),
      'Set-Cookie': `${STATE_COOKIE}=${state}; ${cookieAttrs(request, 600)}`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
export async function finishConnect(request: Request) {
  const done = (outcome: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: new URL(`/admin?drive=${outcome}`, appOrigin(request)).toString(),
        'Set-Cookie': `${STATE_COOKIE}=; ${cookieAttrs(request, 0)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  const url = new URL(request.url);
  try {
    const userId = await sessionUserId();
    if (!userId) return done('login');
    await withDatabase((db) => requireAdminUser(db, userId));
    if (url.searchParams.get('error')) return done('denied');
    // OAuth CSRF: the state in the URL must equal the one planted in this browser's cookie.
    if (!statesMatch(cookieValue(request, STATE_COOKIE), url.searchParams.get('state')))
      return done('state');
    const code = url.searchParams.get('code');
    if (!code) return done('error');
    const tokens = await exchangeCode(request, code);
    if (!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) return done('scope');
    if (!tokens.refresh_token) return done('norefresh');
    const email = await driveAccountEmail(tokens.access_token);
    const previous = await withDatabase((db) =>
      db.driveConnections.find((c) => c.id === CONNECTION_ID),
    );
    if (previous?.status === 'ACTIVE' && previous.email !== email)
      // A different Google account owns a different folder; existing files would become unreachable.
      return done('different-account');
    const time = now();
    await withDatabase((db) => {
      const connection = {
        id: CONNECTION_ID,
        connectedById: userId,
        email,
        encryptedRefreshToken: encryptSecret(tokens.refresh_token!),
        scope: DRIVE_SCOPE,
        status: 'ACTIVE' as const,
        ...(previous?.email === email && previous.folderId ? { folderId: previous.folderId } : {}),
        createdAt: previous?.createdAt || time,
        updatedAt: time,
      };
      db.driveConnections = [connection];
    }, true);
    clearAccessTokenCache();
    rememberAccessToken(tokens.access_token, tokens.expires_in);
    await recordAudit(userId, 'drive.connect', undefined, `account=${email}`);
    return done('connected');
  } catch (error) {
    if (error instanceof HttpError && error.status !== 500) return done('error');
    console.error('Drive connect failed', error instanceof Error ? error.message : 'unknown');
    return done('error');
  }
}
export async function disconnect(userId: string) {
  const connection = await withDatabase((db) => {
    requireAdminUser(db, userId);
    return db.driveConnections.find((c) => c.id === CONNECTION_ID);
  });
  if (!connection || connection.status === 'DISCONNECTED')
    return { message: 'Google Drive chưa được kết nối.' };
  try {
    if (connection.encryptedRefreshToken)
      await revokeToken(decryptSecret(connection.encryptedRefreshToken));
  } catch {
    // The local credential is removed regardless; the grant can also be removed in the Google account.
  }
  await withDatabase((db) => {
    // Keep the row (email, folder) so reconnecting the same account reuses its folder; drop the secret.
    const current = db.driveConnections.find((c) => c.id === CONNECTION_ID);
    if (current) {
      current.status = 'DISCONNECTED';
      current.encryptedRefreshToken = '';
      current.updatedAt = now();
    }
    // Sessions are bound to the removed credential and are useless afterwards.
    for (const job of db.driveUploads)
      if ((ACTIVE as readonly string[]).includes(job.status)) {
        job.status = 'FAILED';
        job.errorMessage = 'Kết nối Google Drive đã bị ngắt.';
        delete job.encryptedSessionUri;
        job.updatedAt = now();
      }
  }, true);
  clearAccessTokenCache();
  await recordAudit(userId, 'drive.disconnect', undefined, `account=${connection.email}`);
  return {
    message:
      'Đã ngắt kết nối Google Drive. Tệp đã tải lên vẫn nằm trong Drive; video đã chia sẻ công khai vẫn xem được cho đến khi bạn xóa tệp.',
  };
}

// ---------------------------------------------------------------------------
// Upload jobs
// ---------------------------------------------------------------------------
async function ensureFolder(folderId: string | undefined, force = false) {
  if (folderId && !force) return folderId;
  const created = await createFolder(FOLDER_NAME);
  await withDatabase((db) => {
    const connection = db.driveConnections.find((c) => c.id === CONNECTION_ID);
    if (connection) {
      connection.folderId = created;
      connection.updatedAt = now();
    }
  }, true);
  return created;
}
function fail(job: DriveUpload, message: string) {
  job.status = 'FAILED';
  job.errorMessage = message;
  delete job.encryptedSessionUri;
  job.updatedAt = now();
}
/**
 * Teachers of the class may upload lesson videos and materials; approved learners may upload
 * files (documents or videos) only as assignment attachments, which stay private to them and
 * the class's teachers.
 */
function uploadClass(
  db: Database,
  user: StoredUser,
  v: { classId: string; kind: 'video' | 'document'; lessonId?: string | null },
) {
  const classroom = db.classes.find((c) => c.id === v.classId);
  if (!classroom) throw new HttpError(404, 'Không tìm thấy lớp học.');
  if (managesClass(classroom, user)) return classroom;
  if (v.lessonId)
    throw new HttpError(403, 'Chỉ giáo viên phụ trách lớp được tải học liệu cho bài giảng.');
  if (
    !db.enrollments.some(
      (e) => e.classId === classroom.id && e.userId === user.id && e.status === 'APPROVED',
    )
  )
    throw new HttpError(403, 'Bạn chưa được duyệt vào lớp học này.');
  return classroom;
}
export async function initUpload(userId: string, origin: string, raw: unknown) {
  await consumeSharedRateLimit(
    `drive-init:${userId}`,
    60,
    15 * 60 * 1000,
    'Bạn khởi tạo tải lên quá nhiều lần. Vui lòng thử lại sau.',
  );
  const v = validateDriveUpload(raw);
  const prepared = await withDatabase((db) => {
    const user = readUser(db, userId);
    const classroom = uploadClass(db, user, v);
    if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
    if (v.lessonId && !db.lessons.some((l) => l.id === v.lessonId && l.classId === classroom.id))
      throw new HttpError(400, 'Bài giảng không thuộc lớp.');
    const connection = db.driveConnections.find((c) => c.id === CONNECTION_ID);
    if (!connection || connection.status !== 'ACTIVE')
      throw new HttpError(409, 'Google Drive chưa được kết nối. Quản trị viên cần kết nối trước.');
    const mine = db.driveUploads.filter(
      (u) =>
        u.ownerId === user.id &&
        (ACTIVE as readonly string[]).includes(u.status) &&
        !expireIfStale(u),
    );
    const duplicate = mine.find(
      (u) =>
        u.classId === v.classId &&
        u.name === v.name &&
        u.size === v.size &&
        u.mimeType === v.mimeType &&
        u.encryptedSessionUri,
    );
    if (!duplicate && mine.length >= MAX_ACTIVE_JOBS)
      throw new HttpError(429, 'Bạn có quá nhiều lượt tải lên đang dở. Hãy hoàn tất hoặc hủy bớt.');
    return { folderId: connection.folderId, duplicateId: duplicate?.id };
  });
  // The same file selected again resumes the existing session instead of creating a duplicate.
  if (prepared.duplicateId) return resumeUpload(userId, prepared.duplicateId);
  const jobId = randomUUID();
  const start = async (folderId: string | undefined) =>
    startResumable({ name: v.name, mimeType: v.mimeType, size: v.size, folderId, jobId, origin });
  let folderId = await ensureFolder(prepared.folderId);
  let uri: string;
  try {
    uri = await start(folderId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    folderId = await ensureFolder(folderId, true); // folder was deleted in Drive
    uri = await start(folderId);
  }
  const time = now();
  const job: DriveUpload = {
    id: jobId,
    ownerId: userId,
    classId: v.classId,
    ...(v.lessonId ? { lessonId: v.lessonId } : {}),
    kind: v.kind,
    name: v.name,
    mimeType: v.mimeType,
    size: v.size,
    title: v.title || v.name,
    description: v.description,
    status: 'PENDING',
    bytesUploaded: 0,
    encryptedSessionUri: encryptSecret(uri),
    shared: false,
    createdAt: time,
    updatedAt: time,
  };
  await withDatabase((db) => {
    const classroom = uploadClass(db, readUser(db, userId), v);
    if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
    db.driveUploads.push(job);
  }, true);
  return { job: driveFileDto(job), uploadUrl: uri, offset: 0, chunkSize: CHUNK_SIZE };
}
/** Returns the resume offset (or completes the job when Drive already holds every byte). */
export async function resumeUpload(userId: string, jobId: string) {
  callLimit.consume(userId);
  const job = await withDatabase((db) => ({ ...jobFor(db, readUser(db, userId), jobId) }));
  if (job.status === 'COMPLETED') return { job: driveFileDto(job), done: true };
  if (job.status === 'CANCELLED') throw new HttpError(409, 'Lượt tải lên đã bị hủy.');
  if (!job.encryptedSessionUri || expireIfStale(job)) {
    await markFailed(jobId, 'Phiên tải lên đã hết hạn. Hãy chọn lại tệp để bắt đầu lại.');
    throw new HttpError(410, 'Phiên tải lên đã hết hạn. Hãy chọn lại tệp để bắt đầu lại.');
  }
  const uri = decryptSecret(job.encryptedSessionUri);
  const result = await queryResumable(uri, job.size);
  if (result.state === 'expired') {
    await markFailed(jobId, 'Phiên tải lên đã hết hạn. Hãy chọn lại tệp để bắt đầu lại.');
    throw new HttpError(410, 'Phiên tải lên đã hết hạn. Hãy chọn lại tệp để bắt đầu lại.');
  }
  if (result.state === 'done') {
    // Upload finished but the browser never reported it (closed tab, DB error): finish it now.
    const done = await finalize(userId, job.id, result.file);
    return { job: done, done: true };
  }
  const updated = await withDatabase((db) => {
    const current = jobFor(db, readUser(db, userId), jobId);
    if (current.status === 'COMPLETED') return { ...current };
    current.status = result.offset > 0 ? 'UPLOADING' : 'PENDING';
    current.bytesUploaded = result.offset;
    delete current.errorMessage;
    current.updatedAt = now();
    return { ...current };
  }, true);
  return {
    job: driveFileDto(updated),
    uploadUrl: uri,
    offset: result.offset,
    chunkSize: CHUNK_SIZE,
    done: false,
  };
}
async function markFailed(jobId: string, message: string) {
  await withDatabase((db) => {
    const job = db.driveUploads.find((u) => u.id === jobId);
    if (job && job.status !== 'COMPLETED') fail(job, message);
  }, true);
}
export async function getUpload(userId: string, jobId: string) {
  const job = await withDatabase((db) => ({ ...jobFor(db, readUser(db, userId), jobId) }));
  return { job: driveFileDto(job) };
}
export async function completeUpload(userId: string, jobId: string, input: unknown) {
  callLimit.consume(userId);
  const { driveFileId } = z
    .object({
      driveFileId: z
        .string()
        .regex(/^[\w-]{10,120}$/)
        .optional(),
    })
    .parse(input);
  const job = await withDatabase((db) => ({ ...jobFor(db, readUser(db, userId), jobId) }));
  if (job.status === 'COMPLETED') return { job: driveFileDto(job) };
  if (job.status === 'CANCELLED') throw new HttpError(409, 'Lượt tải lên đã bị hủy.');
  if (!driveFileId) {
    const result = await resumeUpload(userId, jobId);
    if (!result.done) throw new HttpError(409, 'Tệp chưa tải lên đủ dung lượng.');
    return { job: result.job };
  }
  return { job: await finalize(userId, jobId, await getDriveFile(driveFileId)) };
}
/** Verifies the Drive file really belongs to the job, applies the sharing policy and persists it. */
async function finalize(userId: string, jobId: string, file: DriveRemoteFile): Promise<DriveFile> {
  const job = await withDatabase((db) => ({ ...jobFor(db, readUser(db, userId), jobId) }));
  if (job.status === 'COMPLETED') return driveFileDto(job);
  if (file.appProperties?.lmsJobId !== job.id || Number(file.size) !== job.size || file.trashed)
    throw new HttpError(409, 'Tệp trên Google Drive không khớp với lượt tải lên này.');
  // Drive trusts the declared type; confirm the real bytes before the file is exposed to learners.
  const head = await readFileHead(file.id);
  const genuine =
    matchesSignature(job.mimeType, head) &&
    (!needsOfficeCheck(job.mimeType) ||
      matchesOfficeTail(job.mimeType, await readFileTail(file.id, job.size)));
  if (!genuine) {
    await deleteDriveFile(file.id).catch(() => undefined);
    await markFailed(job.id, 'Nội dung tệp không đúng định dạng đã khai báo.');
    throw new HttpError(
      400,
      'Nội dung tệp không đúng định dạng đã khai báo. Tệp đã bị xóa khỏi Drive.',
    );
  }
  // Policy: every uploaded file is "anyone with the link can view" (docs/GOOGLE_DRIVE.md). If Google
  // refuses (e.g. a Workspace that blocks external sharing) the upload stays unfinished and can be
  // retried, instead of silently ending up private.
  await ensurePublicReader(file.id);
  return withDatabase((db) => {
    const current = jobFor(db, readUser(db, userId), jobId);
    if (current.status === 'COMPLETED') return driveFileDto(current);
    if (db.driveUploads.some((u) => u.id !== current.id && u.driveFileId === file.id))
      throw new HttpError(409, 'Tệp Google Drive này đã được liên kết với lượt tải lên khác.');
    Object.assign(current, {
      status: 'COMPLETED',
      driveFileId: file.id,
      ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
      bytesUploaded: current.size,
      shared: true,
      updatedAt: now(),
    });
    delete current.encryptedSessionUri;
    delete current.errorMessage;
    return driveFileDto(current);
  }, true);
}
export async function cancelUpload(userId: string, jobId: string) {
  const job = await withDatabase((db) => ({ ...mutableJob(db, readUser(db, userId), jobId) }));
  if (job.status === 'COMPLETED')
    throw new HttpError(409, 'Tệp đã tải xong. Hãy dùng chức năng xóa tệp.');
  if (job.encryptedSessionUri) await cancelResumable(decryptSecret(job.encryptedSessionUri));
  const updated = await withDatabase((db) => {
    const current = mutableJob(db, readUser(db, userId), jobId);
    if (current.status === 'COMPLETED') throw new HttpError(409, 'Tệp đã tải xong.');
    current.status = 'CANCELLED';
    delete current.encryptedSessionUri;
    current.updatedAt = now();
    return { ...current };
  }, true);
  return { job: driveFileDto(updated) };
}

// ---------------------------------------------------------------------------
// File management
// ---------------------------------------------------------------------------
export async function listFiles(userId: string, params: URLSearchParams) {
  const classId = params.get('classId') || undefined;
  const lessonId = params.get('lessonId') || undefined;
  const kind = params.get('kind');
  const status = params.get('status') || 'COMPLETED';
  const q = (params.get('q') || '').trim().toLowerCase().slice(0, 100);
  return withDatabase((db) => {
    const user = readUser(db, userId);
    if (classId) teacherClass(db, user, classId);
    const files = db.driveUploads
      .filter((u) => {
        if (classId && u.classId !== classId) return false;
        if (lessonId && u.lessonId !== lessonId) return false;
        if (kind && u.kind !== kind) return false;
        if (status !== 'ALL' && u.status !== status) return false;
        if (q && !`${u.name} ${u.title}`.toLowerCase().includes(q)) return false;
        if (u.ownerId === user.id) return true;
        // Teachers see class materials, not learners' private submission files.
        const classroom = db.classes.find((c) => c.id === u.classId);
        return (
          isClassMaterial(db, u) && (user.isAdmin || (!!classroom && managesClass(classroom, user)))
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200)
      .map(driveFileDto);
    return { files };
  });
}
/** Administrator view of what is physically inside the app's Drive folder (files.list). */
export async function listRemoteFiles(userId: string, params: URLSearchParams) {
  const folderId = await withDatabase((db) => {
    requireAdminUser(db, userId);
    return db.driveConnections.find((c) => c.id === CONNECTION_ID)?.folderId;
  });
  const files = await listDriveFiles(folderId, (params.get('q') || '').trim().slice(0, 100));
  return {
    files: files.map(({ id, name, mimeType, size, createdTime }) => ({
      id,
      name,
      mimeType,
      size,
      createdTime,
    })),
  };
}
export async function getFile(userId: string, jobId: string, live: boolean) {
  const job = await withDatabase((db) => ({ ...jobFor(db, readUser(db, userId), jobId) }));
  let remote: Pick<DriveRemoteFile, 'name' | 'mimeType' | 'size' | 'trashed'> | undefined;
  if (live && job.driveFileId) {
    const { name, mimeType, size, trashed } = await getDriveFile(job.driveFileId);
    remote = { name, mimeType, size, trashed };
  }
  return { file: driveFileDto(job), ...(remote ? { remote } : {}) };
}
export async function updateFile(userId: string, jobId: string, input: unknown) {
  const v = z
    .object({
      name: fileName.optional(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(5000).optional(),
    })
    .strict()
    .refine((x) => Object.keys(x).length > 0, 'Chưa có thay đổi để lưu.')
    .parse(input);
  const job = await withDatabase((db) => ({ ...mutableJob(db, readUser(db, userId), jobId) }));
  if (v.name !== undefined && v.name !== job.name) {
    if (extensionOf(v.name) !== extensionOf(job.name))
      throw new HttpError(400, 'Giữ nguyên đuôi tệp khi đổi tên.');
    if (job.driveFileId) await renameDriveFile(job.driveFileId, v.name);
  }
  const updated = await withDatabase((db) => {
    const current = mutableJob(db, readUser(db, userId), jobId);
    Object.assign(current, v, { updatedAt: now() });
    return { ...current };
  }, true);
  return { file: driveFileDto(updated) };
}
export async function deleteFile(userId: string, jobId: string) {
  const job = await withDatabase((db) => {
    const found = mutableJob(db, readUser(db, userId), jobId);
    if (
      db.lessons.some((l) => l.documents.some((d) => d.id === found.id)) ||
      db.submissions.some((sub) => sub.attachments.some((a) => a.id === found.id))
    )
      throw new HttpError(
        409,
        'Tệp đang được dùng trong bài giảng hoặc bài nộp. Hãy gỡ tệp khỏi đó trước khi xóa.',
      );
    if (found.driveFileId && db.lessons.some((l) => l.driveFileId === found.driveFileId))
      throw new HttpError(
        409,
        'Video đang được dùng trong một bài giảng. Hãy gỡ khỏi bài giảng trước khi xóa.',
      );
    return { ...found };
  });
  if (job.encryptedSessionUri) await cancelResumable(decryptSecret(job.encryptedSessionUri));
  // Remove from Drive first: if that fails the record stays and the delete can be retried.
  if (job.driveFileId) await deleteDriveFile(job.driveFileId);
  await withDatabase((db) => {
    db.driveUploads = db.driveUploads.filter((u) => u.id !== jobId);
  }, true);
  return { message: 'Đã xóa tệp khỏi Google Drive.' };
}
export async function setSharing(userId: string, jobId: string, input: unknown) {
  const { public: makePublic } = z.object({ public: z.boolean() }).strict().parse(input);
  const job = await withDatabase((db) => {
    return { ...mutableJob(db, readUser(db, userId), jobId) };
  });
  if (job.status !== 'COMPLETED' || !job.driveFileId)
    throw new HttpError(409, 'Tệp chưa tải lên xong.');
  if (!makePublic && job.driveFileId && (await lessonUses(job.driveFileId)))
    throw new HttpError(
      409,
      'Video đang được dùng trong bài giảng; thu hồi chia sẻ sẽ làm học viên không xem được.',
    );
  if (makePublic) await ensurePublicReader(job.driveFileId);
  else await revokePublicReader(job.driveFileId);
  const updated = await withDatabase((db) => {
    const current = mutableJob(db, readUser(db, userId), jobId);
    current.shared = makePublic;
    current.updatedAt = now();
    return { ...current };
  }, true);
  return { file: driveFileDto(updated) };
}
function lessonUses(driveFileId: string) {
  return withDatabase((db) => db.lessons.some((l) => l.driveFileId === driveFileId));
}

/** Streams a private Drive document to a reader after the same access checks as the app's files. */
/** Formats a browser can render itself; everything else (DOCX, PPTX) is download-only. */
const INLINE_TYPES = /^(video\/|image\/|application\/pdf$)/;
export const canViewInline = (mimeType: string) => INLINE_TYPES.test(mimeType);
// Seeking in a video issues many Range requests, so views get a roomier limit than API calls.
const accessCache = new Map<string, { job: DriveUpload; until: number }>();
const viewLimit = new RateLimit(
  3000,
  15 * 60 * 1000,
  10000,
  'Bạn xem quá nhiều lần. Vui lòng thử lại sau.',
);

/**
 * Streams a private Drive file after the same access checks as the app's files. With `inline`,
 * videos, PDFs and images are sent for in-page viewing and Range requests are honoured (seeking).
 */
export async function serveDocument(
  userId: string,
  jobId: string,
  range: string | null,
  inline: boolean,
) {
  viewLimit.consume(userId);
  // Seeking in a video sends many requests within seconds; the access decision is reused briefly
  // (the session itself is still verified on every request).
  const cacheKey = `${userId}:${jobId}`;
  const cached = accessCache.get(cacheKey);
  const job =
    cached && cached.until > Date.now()
      ? cached.job
      : await withDatabase(
          (db) => ({ ...accessDriveDocument(db, readUser(db, userId), jobId) }),
          false,
        );
  if (!cached || cached.until <= Date.now()) {
    if (accessCache.size > 5000) accessCache.clear();
    accessCache.set(cacheKey, { job, until: Date.now() + 20000 });
  }
  const upstream = await driveDownload(job.driveFileId!, range ?? undefined);
  const view = inline && canViewInline(job.mimeType);
  const pass = (name: string) => upstream.headers.get(name);
  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers: {
      'Content-Type': job.mimeType,
      'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(job.name)}`,
      'Accept-Ranges': 'bytes',
      ...(pass('content-length') ? { 'Content-Length': pass('content-length')! } : {}),
      ...(pass('content-range') ? { 'Content-Range': pass('content-range')! } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Uploaded content must never run script in the app's origin, even if a viewer tried.
      ...(view && !job.mimeType.startsWith('application/')
        ? {
            'Content-Security-Policy':
              "sandbox; default-src 'none'; media-src 'self'; img-src 'self'",
          }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Route wrapper
// ---------------------------------------------------------------------------
export async function driveRoute(
  request: Request,
  write: boolean,
  fn: (context: {
    userId: string;
    input: Record<string, unknown>;
    origin: string;
  }) => Promise<unknown>,
) {
  try {
    if (write) assertOrigin(request);
    const userId = await sessionUserId();
    if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    // DELETE carries no payload; POST/PATCH bodies are JSON objects.
    const input =
      write && request.method !== 'DELETE' && request.body
        ? await readJsonObject(request, 20000)
        : {};
    const result = await fn({ userId, input, origin: appOrigin(request) });
    return Response.json(result ?? { ok: true }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}

// ---------------------------------------------------------------------------
// Maintenance: remove files nobody references any more
// ---------------------------------------------------------------------------
export interface PruneResult {
  deletedFromDrive: number;
  removedRecords: number;
  failed: number;
  skippedNoConnection: boolean;
}
/**
 * Deletes from Google Drive (and from the database):
 *  - files queued in DriveTrash (deleted lessons, assignments, classes);
 *  - learner files and lesson materials that never got attached, or were detached, after `graceHours`;
 *  - failed, cancelled and abandoned upload records.
 * A teacher's library videos are kept on purpose: they are reusable material, not orphans.
 * Idempotent and safe to run from several instances.
 */
export async function pruneDrive(graceHours = 24, at = Date.now()): Promise<PruneResult> {
  const cutoff = at - graceHours * 3600000;
  const plan = await withDatabase((db) => {
    const connected = db.driveConnections.some(
      (c) => c.id === CONNECTION_ID && c.status === 'ACTIVE',
    );
    const stale = db.driveUploads.filter((u) => {
      if (Date.parse(u.createdAt) >= cutoff) return false;
      if (u.status === 'FAILED' || u.status === 'CANCELLED') return true;
      if (u.status === 'PENDING' || u.status === 'UPLOADING')
        return Date.parse(u.createdAt) < at - SESSION_LIFETIME_MS;
      return (
        u.status === 'COMPLETED' &&
        (u.kind === 'document' || !isClassMaterial(db, u)) &&
        driveJobUnused(db, u)
      );
    });
    return {
      connected,
      trash: db.driveTrash.map((t) => t.id),
      stale: stale.map((u) => ({ id: u.id, driveFileId: u.driveFileId })),
    };
  });
  const result: PruneResult = {
    deletedFromDrive: 0,
    removedRecords: 0,
    failed: 0,
    skippedNoConnection: false,
  };
  const goneTrash = new Set<string>();
  const goneJobs = new Set<string>();
  const drop = async (driveFileId: string | undefined) => {
    if (!driveFileId) return true;
    if (!plan.connected) {
      result.skippedNoConnection = true;
      return false;
    }
    try {
      await deleteDriveFile(driveFileId);
      result.deletedFromDrive++;
      return true;
    } catch (error) {
      result.failed++;
      console.error(
        'Drive prune could not delete a file',
        error instanceof Error ? error.message : '',
      );
      return false;
    }
  };
  for (const id of plan.trash) if (await drop(id)) goneTrash.add(id);
  for (const job of plan.stale) if (await drop(job.driveFileId)) goneJobs.add(job.id);
  if (goneTrash.size || goneJobs.size)
    await withDatabase((db) => {
      db.driveTrash = db.driveTrash.filter((t) => !goneTrash.has(t.id));
      // Re-check inside the write: the file may have been attached since the plan was made.
      db.driveUploads = db.driveUploads.filter(
        (u) => !(goneJobs.has(u.id) && (u.status !== 'COMPLETED' || driveJobUnused(db, u))),
      );
    }, true);
  result.removedRecords = goneTrash.size + goneJobs.size;
  return result;
}
export async function runMaintenance(userId: string) {
  await withDatabase((db) => requireAdminUser(db, userId));
  const result = await pruneDrive();
  await recordAudit(userId, 'drive.prune', undefined, JSON.stringify(result));
  return result;
}
