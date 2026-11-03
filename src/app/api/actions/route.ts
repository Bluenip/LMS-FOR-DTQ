import { withDatabase } from '@/lib/server/repository';
import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { runAction } from '@/lib/server/actions';
import { readJsonObject } from '@/lib/server/request';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const id = await sessionUserId();
    if (!id) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const input = await readJsonObject(request, 200000);
    const result = await withDatabase((db) => runAction(db, requireUser(db, id), input), true);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    return errorResponse(e);
  }
}
