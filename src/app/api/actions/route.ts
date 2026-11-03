import { withDatabase } from '@/lib/server/repository';
import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { runActionStrict, tablesFor } from '@/lib/server/actions';
import { readJsonObject } from '@/lib/server/request';
import { SharedRateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';
const classCodeAttempts = new SharedRateLimit(
  'class-code',
  30,
  15 * 60 * 1000,
  'Bạn đã thử mã lớp quá nhiều lần. Vui lòng thử lại sau 15 phút.',
);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const id = await sessionUserId();
    if (!id) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const input = await readJsonObject(request, 200000);
    if (input.action === 'previewClass' || input.action === 'joinClass')
      await classCodeAttempts.consume(id);
    const result = await withDatabase(
      (db) => {
        const user = requireUser(db, id);
        return runActionStrict(db, user, input);
      },
      true,
      tablesFor(input.action),
    );
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    return errorResponse(e);
  }
}
