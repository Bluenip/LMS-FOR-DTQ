import { assertOrigin, errorResponse, requireUser, sessionUserId } from '@/lib/server/auth';
import { classOf, withClassScope } from '@/lib/server/repository';
import { readJsonObject } from '@/lib/server/request';
import { deleteObject } from '@/lib/server/storage';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const userId = await sessionUserId();
    const { fileId } = z
      .object({ fileId: z.string().min(1).max(120) })
      .parse(await readJsonObject(request));
    const key = await withClassScope(
      userId,
      async (tx) => ({ classIds: await classOf(tx, 'file', fileId) }),
      (db) => {
        const user = requireUser(db, userId);
        const index = db.files.findIndex(
          (file) => file.id === fileId && file.ownerId === user.id && !file.verified,
        );
        if (index < 0) return undefined;
        return db.files.splice(index, 1)[0].key;
      },
      true,
    );
    if (key) await deleteObject(key).catch(() => {});
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
