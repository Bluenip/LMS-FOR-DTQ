import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { accessClass } from '@/lib/server/actions';
import { withDatabase } from '@/lib/server/repository';
import {
  fileRecord,
  MAX_DOCUMENT,
  putDocument,
  storage,
  validateUpload,
  validateDocument,
  deleteObject,
} from '@/lib/server/storage';
import { readUploadBody, reserveUpload, uploadGate } from '@/lib/server/upload-policy';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    const user = await withDatabase((db) => requireUser(db, userId));
    release = uploadGate.acquire(user.id);
    await consumeSharedRateLimit(
      `uploads:${user.id}`,
      60,
      3600000,
      'Bạn đã tải quá nhiều tệp. Vui lòng thử lại sau một giờ.',
    );
    storage();
    const parsed = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') || '' },
      body: await readUploadBody(request, MAX_DOCUMENT + 1024 * 1024),
    });
    let form: FormData;
    try {
      form = await parsed.formData();
    } catch {
      throw new HttpError(400, 'Dữ liệu tải tệp không hợp lệ.');
    }
    const f = form.get('file');
    if (!(f instanceof File)) throw new HttpError(400, 'Vui lòng chọn tệp.');
    const v = validateUpload({
      classId: form.get('classId'),
      name: f.name,
      size: f.size,
      mimeType: f.type,
      kind: 'document',
    });
    const bytes = Buffer.from(await f.arrayBuffer());
    validateDocument(fileRecord(user.id, v), bytes);
    const record = await withDatabase((db) => {
      const user = requireUser(db, userId);
      const classroom = accessClass(db, user, v.classId);
      if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
      const record = fileRecord(user.id, v);
      reserveUpload(db, record);
      return record;
    }, true);
    try {
      await putDocument(record, bytes);
      await withDatabase((db) => {
        const user = requireUser(db, userId);
        const classroom = accessClass(db, user, v.classId);
        if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
        const stored = db.files.find(
          (entry) => entry.id === record.id && entry.ownerId === user.id,
        );
        if (!stored) throw new HttpError(409, 'Tệp đã thay đổi. Vui lòng tải lại.');
        stored.verified = true;
      }, true);
    } catch (error) {
      // Only remove an unverified reservation; a committed file must remain available.
      const removed = await withDatabase((db) => {
        const index = db.files.findIndex(
          (entry) => entry.id === record.id && entry.ownerId === user.id && !entry.verified,
        );
        if (index < 0) return false;
        db.files.splice(index, 1);
        return true;
      }, true).catch(() => false);
      if (removed) await deleteObject(record.key).catch(() => {});
      throw error;
    }
    return Response.json({
      id: record.id,
      name: record.name,
      size: record.size,
      mimeType: record.mimeType,
      url: `/api/files/${record.id}`,
    });
  } catch (e) {
    return errorResponse(e);
  } finally {
    release?.();
  }
}
