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
} from '@/lib/server/storage';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    await withDatabase((db) => requireUser(db, userId));
    storage();
    const cap = MAX_DOCUMENT + 1024 * 1024;
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'Thiếu tệp tải lên.');
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > cap) {
        await reader.cancel();
        throw new HttpError(413, 'Tệp bài tập tối đa 25 MB.');
      }
      parts.push(value);
    }
    const parsed = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') || '' },
      body: Buffer.concat(parts),
    });
    const form = await parsed.formData();
    const f = form.get('file');
    if (!(f instanceof File)) throw new HttpError(400, 'Vui lòng chọn tệp.');
    const v = validateUpload({
      classId: form.get('classId'),
      name: f.name,
      size: f.size,
      mimeType: f.type,
      kind: 'document',
    });
    const record = await withDatabase((db) => {
      const user = requireUser(db, userId);
      const classroom = accessClass(db, user, v.classId);
      if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
      return fileRecord(user.id, v);
    });
    await putDocument(record, Buffer.from(await f.arrayBuffer()));
    record.verified = true;
    await withDatabase((db) => {
      const user = requireUser(db, userId);
      const classroom = accessClass(db, user, v.classId);
      if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
      db.files.push(record);
    }, true);
    return Response.json({
      id: record.id,
      name: record.name,
      size: record.size,
      mimeType: record.mimeType,
      url: `/api/files/${record.id}`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
