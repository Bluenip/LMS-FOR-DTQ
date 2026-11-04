import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { accessClass, teacherClass } from '@/lib/server/actions';
import { classOf, withClassScope } from '@/lib/server/repository';
import { fileRecord, presign, storage, validateUpload } from '@/lib/server/storage';
import { readJsonObject } from '@/lib/server/request';
import { reserveUpload } from '@/lib/server/upload-policy';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    storage();
    const userId = await sessionUserId();
    const user = await withClassScope(
      userId,
      async () => ({ classIds: [] }),
      (db) => requireUser(db, userId),
    );
    await consumeSharedRateLimit(
      `uploads:${user.id}`,
      60,
      3600000,
      'Bạn đã tải quá nhiều tệp. Vui lòng thử lại sau một giờ.',
    );
    const v = validateUpload(await readJsonObject(request));
    const scope = async () => ({ classIds: [v.classId] });
    const file = await withClassScope(
      userId,
      scope,
      (db) => {
        const user = requireUser(db, userId);
        const classroom =
          v.kind === 'video' ? teacherClass(db, user, v.classId) : accessClass(db, user, v.classId);
        if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
        const f = fileRecord(user.id, v);
        reserveUpload(db, f);
        return f;
      },
      true,
    );
    try {
      return Response.json({ fileId: file.id, uploadUrl: await presign(file) });
    } catch (error) {
      await withClassScope(
        userId,
        scope,
        (db) => {
          db.files = db.files.filter((entry) => entry.id !== file.id || entry.verified);
        },
        true,
      ).catch(() => {});
      throw error;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
