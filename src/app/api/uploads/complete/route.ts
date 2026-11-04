import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { classOf, type ScopeResolver, withClassScope } from '@/lib/server/repository';
import { completeStoredUpload } from '@/lib/server/storage';
import { accessClass, teacherClass } from '@/lib/server/actions';
import { readJsonObject } from '@/lib/server/request';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit';
import { videoCompletionGate } from '@/lib/server/upload-policy';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    const { fileId } = z
      .object({ fileId: z.string().min(1).max(120) })
      .parse(await readJsonObject(request));
    const scope: ScopeResolver = async (tx) => ({
      classIds: await classOf(tx, 'file', fileId),
    });
    const file = await withClassScope(userId, scope, (db) => {
      const user = requireUser(db, userId);
      const f = db.files.find((f) => f.id === fileId && f.ownerId === user.id);
      if (!f) throw new HttpError(404, 'Không tìm thấy tệp.');
      const classroom = f.mimeType.startsWith('video/')
        ? teacherClass(db, user, f.classId)
        : accessClass(db, user, f.classId);
      if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
      return f;
    });
    release = videoCompletionGate.acquire(file.ownerId);
    await consumeSharedRateLimit(
      `upload-complete:${file.ownerId}`,
      120,
      3600000,
      'Bạn đã gửi quá nhiều yêu cầu hoàn tất tệp. Vui lòng thử lại sau.',
    );
    const result = await completeStoredUpload(file, (finalKey) =>
      withClassScope(
        userId,
        scope,
        (db) => {
          const user = requireUser(db, userId);
          const classroom = file.mimeType.startsWith('video/')
            ? teacherClass(db, user, file.classId)
            : accessClass(db, user, file.classId);
          if (classroom.status === 'ARCHIVED') throw new HttpError(409, 'Lớp học đã lưu trữ.');
          const f = db.files.find((f) => f.id === file.id && f.ownerId === user.id);
          if (!f) throw new HttpError(409, 'Tệp đã bị xóa. Vui lòng tải lại.');
          if (!f.verified) {
            if (f.key !== file.key) throw new HttpError(409, 'Tệp đã thay đổi. Vui lòng thử lại.');
            f.verified = true;
            f.key = finalKey;
          }
          return f;
        },
        true,
      ),
    );
    return Response.json({
      id: result.id,
      name: result.name,
      size: result.size,
      mimeType: result.mimeType,
      url: `/api/files/${result.id}`,
    });
  } catch (e) {
    return errorResponse(e);
  } finally {
    release?.();
  }
}
