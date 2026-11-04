import type { Prisma } from '@prisma/client';
import { classOf, type DataScope } from './repository';

/**
 * Resolve which classes an action reads or writes, so the repository loads and
 * locks only those classes. An unknown id resolves to no class, and the action
 * then reports "not found" exactly as it would against the full snapshot.
 */
export async function actionScope(
  tx: Prisma.TransactionClient,
  input: Record<string, unknown>,
): Promise<DataScope> {
  const classIds = (value: unknown) => ({
    classIds: typeof value === 'string' && value ? [value] : [],
  });
  switch (input.action) {
    case 'createClass':
    case 'markNotificationsRead':
      return { classIds: [] };
    case 'setClassTeachers':
      return {
        ...classIds(input.classId),
        userIds: Array.isArray(input.teacherIds)
          ? input.teacherIds.filter((id): id is string => typeof id === 'string').slice(0, 100)
          : [],
      };
    case 'updateClass':
    case 'archiveClass':
    case 'regenerateCode':
    case 'deleteClass':
    case 'cancelEnrollment':
    case 'leaveClass':
    case 'saveLesson':
    case 'createAssignment':
      return classIds(input.classId);
    case 'previewClass':
    case 'joinClass':
      return { classIds: await classOf(tx, 'code', input.code) };
    case 'removeEnrollment':
    case 'setEnrollmentGroup':
    case 'approveEnrollment':
    case 'rejectEnrollment':
      return { classIds: await classOf(tx, 'enrollment', input.enrollmentId) };
    case 'deleteLesson':
    case 'completeLesson':
    case 'bookmarkLesson':
    case 'saveNote':
    case 'comment':
      return { classIds: await classOf(tx, 'lesson', input.lessonId) };
    case 'updateComment':
    case 'deleteComment':
      return { classIds: await classOf(tx, 'discussion', input.discussionId) };
    case 'updateAssignment':
    case 'deleteAssignment':
    case 'saveSubmission':
    case 'submitAssignment':
    case 'withdrawSubmission':
    case 'remindStudents':
      return { classIds: await classOf(tx, 'assignment', input.assignmentId) };
    case 'gradeSubmission':
      return { classIds: await classOf(tx, 'submission', input.submissionId) };
    default:
      return { classIds: [] };
  }
}
