import type { Database, StoredFile } from '@/lib/types';
import { HttpError } from './auth';

const GiB = 1024 ** 3;
function configuredBytes(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}
/** Per-account and per-class storage limits, shared by the S3 and Google Drive upload paths. */
export function assertUploadQuota(userBytes: number, classBytes: number, size: number) {
  if (userBytes + size > configuredBytes('LMS_UPLOAD_USER_QUOTA_BYTES', 10 * GiB))
    throw new HttpError(
      413,
      'Đã đạt hạn mức dung lượng tài khoản. Vui lòng liên hệ quản trị viên.',
    );
  if (classBytes + size > configuredBytes('LMS_UPLOAD_CLASS_QUOTA_BYTES', 100 * GiB))
    throw new HttpError(413, 'Đã đạt hạn mức dung lượng lớp học. Vui lòng liên hệ quản trị viên.');
}
/** Call inside the same write transaction that reserves the file. Pending bytes count too. */
export function reserveUpload(db: Database, file: StoredFile, now = Date.now()) {
  const owned = db.files.filter((entry) => entry.ownerId === file.ownerId);
  const recent = owned.filter((entry) => Date.parse(entry.createdAt) > now - 3600000);
  if (recent.length >= 60)
    throw new HttpError(429, 'Bạn đã tải quá nhiều tệp. Vui lòng thử lại sau một giờ.');
  if (recent.filter((entry) => !entry.verified).length >= 3)
    throw new HttpError(
      429,
      'Bạn có quá nhiều tệp đang tải lên. Hoàn tất tệp đang tải trước khi tiếp tục.',
    );
  const total = (files: StoredFile[]) => files.reduce((sum, entry) => sum + entry.size, 0);
  assertUploadQuota(
    total(owned),
    total(db.files.filter((entry) => entry.classId === file.classId)),
    file.size,
  );
  db.files.push(file);
}

/** Bounds memory before reading a multipart body, including requests with invalid metadata. */
export class UploadGate {
  private users = new Map<string, number>();
  private count = 0;
  constructor(
    private total = 2,
    private perUser = 1,
  ) {}
  acquire(userId: string) {
    const count = this.users.get(userId) || 0;
    if (this.count >= this.total || count >= this.perUser)
      throw new HttpError(429, 'Đang xử lý tải tệp. Vui lòng đợi rồi thử lại.');
    this.count++;
    this.users.set(userId, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.count--;
      const remaining = (this.users.get(userId) || 1) - 1;
      if (remaining) this.users.set(userId, remaining);
      else this.users.delete(userId);
    };
  }
}
export const uploadGate = new UploadGate(4);
export const videoCompletionGate = new UploadGate(2);

export async function readUploadBody(request: Request, cap: number, timeoutMs = 60000) {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > cap)
    throw new HttpError(413, 'Tệp bài tập tối đa 25 MB.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Thiếu tệp tải lên.');
  const parts: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, 'Tải tệp quá thời gian. Vui lòng thử lại.'));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      length += value.byteLength;
      if (length > cap) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, 'Tệp bài tập tối đa 25 MB.');
      }
      parts.push(value);
    }
    return Buffer.concat(parts, length);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
