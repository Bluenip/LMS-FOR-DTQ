import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { accessClass, teacherClass } from '@/lib/server/actions';
import { withDatabase } from '@/lib/server/repository';
import { fileRecord, presign, storage, validateUpload } from '@/lib/server/storage';
import { readJsonObject } from '@/lib/server/request';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    storage();
    const userId = await sessionUserId();
    const v = validateUpload(await readJsonObject(request));
    const file = await withDatabase((db) => {
      const user = requireUser(db, userId);
      if (v.kind === 'video') teacherClass(db, user, v.classId);
      else accessClass(db, user, v.classId);
      if (
        db.files.filter(
          (f) =>
            f.ownerId === user.id && !f.verified && Date.parse(f.createdAt) > Date.now() - 3600000,
        ).length >= 20
      )
        throw new HttpError(429, 'Bạn có quá nhiều tệp đang tải lên.');
      const f = fileRecord(user.id, v);
      db.files.push(f);
      return f;
    }, true);
    return Response.json({ fileId: file.id, uploadUrl: await presign(file) });
  } catch (e) {
    return errorResponse(e);
  }
}
