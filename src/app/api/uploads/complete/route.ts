import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { withDatabase } from '@/lib/server/repository';
import { finalizeObject, verifyObject } from '@/lib/server/storage';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    const { fileId } = await request.json();
    const file = await withDatabase((db) => {
      const user = requireUser(db, userId);
      const f = db.files.find((f) => f.id === fileId && f.ownerId === user.id);
      if (!f) throw new HttpError(404, 'Không tìm thấy tệp.');
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
