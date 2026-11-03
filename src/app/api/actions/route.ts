import { withDatabase } from '@/lib/server/repository';
import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { runAction } from '@/lib/server/actions';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const body = await request.text();
    if (body.length > 200000) throw new HttpError(413, 'Nội dung yêu cầu quá lớn.');
    const input = JSON.parse(body);
    const id = await sessionUserId();
    const result = await withDatabase((db) => runAction(db, requireUser(db, id), input), true);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    return errorResponse(e);
  }
}
