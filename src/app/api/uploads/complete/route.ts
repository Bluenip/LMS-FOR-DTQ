import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { withDatabase } from '@/lib/server/repository';
import { finalizeObject, verifyObject } from '@/lib/server/storage';
import { accessClass } from '@/lib/server/actions';
import { readJsonObject } from '@/lib/server/request';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    const { fileId } = z
      .object({ fileId: z.string().min(1).max(120) })
      .parse(await readJsonObject(request));
    const file = await withDatabase((db) => {
      const user = requireUser(db, userId);
      const f = db.files.find((f) => f.id === fileId && f.ownerId === user.id);
      if (!f) throw new HttpError(404, 'Không tìm thấy tệp.');
      accessClass(db, user, f.classId);
      return f;
    });
    if (file.verified)
      return Response.json({
        id: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        url: `/api/files/${file.id}`,
      });
    const etag = await verifyObject(file);
    const finalKey = await finalizeObject(file, etag);
    await withDatabase((db) => {
      const user = requireUser(db, userId);
      accessClass(db, user, file.classId);
      const f = db.files.find((f) => f.id === file.id);
      if (f) {
        f.verified = true;
        f.key = finalKey;
      }
    }, true);
    return Response.json({
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      url: `/api/files/${file.id}`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
