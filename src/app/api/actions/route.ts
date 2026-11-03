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
import { RateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';
const classCodeAttempts = new RateLimit(
  30,
  15 * 60 * 1000,
  10000,
  'Bạn đã thử mã lớp quá nhiều lần. Vui lòng thử lại sau 15 phút.',
);
function requireEditVersion(input: Record<string, unknown>) {
  const reload = () => {
    throw new HttpError(
      409,
      'Phiên soạn thảo đã cũ. Hãy sao chép nội dung và tải lại trang trước khi lưu.',
    );
  };
  if (
    (input.action === 'saveSubmission' || input.action === 'submitAssignment') &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    input.action === 'saveNote' &&
    !(input.expectedUpdatedAt === null || typeof input.expectedUpdatedAt === 'string')
  )
    reload();
  if (
    input.action === 'saveLesson' &&
    (input.id || input.lessonId) &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    (input.action === 'updateClass' || input.action === 'updateAssignment') &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    input.action === 'gradeSubmission' &&
    (typeof input.expectedGradeRevision !== 'string' ||
      typeof input.expectedAttempt !== 'number' ||
      !(input.expectedSubmittedAt === null || typeof input.expectedSubmittedAt === 'string'))
  )
    reload();
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const id = await sessionUserId();
    if (!id) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const input = await readJsonObject(request, 200000);
    if (input.action === 'previewClass' || input.action === 'joinClass')
      classCodeAttempts.consume(id);
    const result = await withDatabase((db) => {
      const user = requireUser(db, id);
      requireEditVersion(input);
      return runAction(db, user, input);
    }, true);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    return errorResponse(e);
  }
}
