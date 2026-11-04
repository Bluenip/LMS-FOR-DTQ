import { withClassScope } from '@/lib/server/repository';
import { actionScope } from '@/lib/server/scope';
import {
  assertOrigin,
  errorResponse,
  HttpError,
  requireUser,
  sessionUserId,
} from '@/lib/server/auth';
import { runAction } from '@/lib/server/actions';
import { readJsonObject } from '@/lib/server/request';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';
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
    [
      'updateClass',
      'updateAssignment',
      'deleteClass',
      'deleteLesson',
      'deleteAssignment',
      'withdrawSubmission',
    ].includes(String(input.action)) &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    ['removeEnrollment', 'leaveClass'].includes(String(input.action)) &&
    typeof input.expectedJoinedAt !== 'string'
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
      await consumeSharedRateLimit(
        `class-code:${id}`,
        30,
        15 * 60 * 1000,
        'Bạn đã thử mã lớp quá nhiều lần. Vui lòng thử lại sau 15 phút.',
      );
    if (input.action === 'comment')
      await consumeSharedRateLimit(
        `comment:${id}`,
        20,
        60 * 1000,
        'Bạn gửi bình luận quá nhanh. Vui lòng thử lại sau.',
      );
    const execute = () =>
      withClassScope(
        id,
        async (tx) => ({
          ...(await actionScope(tx, input)),
          notifications: {
            action: String(input.action),
            ids: Array.isArray(input.ids)
              ? input.ids.filter((id): id is string => typeof id === 'string').slice(0, 2000)
              : undefined,
            assignmentId: typeof input.assignmentId === 'string' ? input.assignmentId : undefined,
          },
        }),
        (db) => {
          const user = requireUser(db, id);
          requireEditVersion(input);
          return runAction(db, user, input);
        },
        true,
      );
    let result;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await execute();
        break;
      } catch (error) {
        const prismaError = error as { code?: string; meta?: { target?: unknown } } | null;
        const target = prismaError?.meta?.target;
        const codeConflict =
          prismaError?.code === 'P2002' &&
          (Array.isArray(target)
            ? target.includes('code')
            : target === 'Classroom_code_key' || target === 'code');
        if (
          !codeConflict ||
          !['createClass', 'regenerateCode'].includes(String(input.action)) ||
          attempt >= 2
        )
          throw error;
      }
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    return errorResponse(e);
  }
}
