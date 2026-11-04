import type { APIRequestContext } from '@playwright/test';
import type { AppState } from '../src/lib/types';

/** Mirror the version token a browser editor receives when it opens a form. */
export async function versionedAction(
  api: APIRequestContext,
  action: string,
  payload: Record<string, unknown>,
) {
  const needsState =
    [
      'saveSubmission',
      'submitAssignment',
      'saveNote',
      'gradeSubmission',
      'updateClass',
      'updateAssignment',
      'deleteClass',
      'deleteLesson',
      'deleteAssignment',
      'withdrawSubmission',
      'removeEnrollment',
      'leaveClass',
    ].includes(action) ||
    (action === 'saveLesson' && (payload.id || payload.lessonId));
  if (!needsState) return payload;
  const response = await api.get('/api/state');
  if (!response.ok()) throw new Error(`Cannot load test state: ${response.status()}`);
  const state: AppState = await response.json();
  if (action === 'updateClass' || action === 'deleteClass')
    return {
      expectedRevision: state.classes.find((c) => c.id === payload.classId)?.revision || '',
      ...payload,
    };
  if (action === 'updateAssignment' || action === 'deleteAssignment')
    return {
      expectedRevision:
        state.assignments.find((a) => a.id === payload.assignmentId)?.revision || '',
      ...payload,
    };
  if (
    action === 'saveSubmission' ||
    action === 'submitAssignment' ||
    action === 'withdrawSubmission'
  ) {
    const submission = state.submissions.find(
      (s) => s.assignmentId === payload.assignmentId && s.studentId === state.user.id,
    );
    return { expectedRevision: submission?.revision || '', ...payload };
  }
  if (action === 'saveNote') {
    const note = state.notes.find(
      (n) => n.lessonId === payload.lessonId && n.userId === state.user.id,
    );
    return { expectedUpdatedAt: note?.updatedAt || null, ...payload };
  }
  if (action === 'saveLesson' || action === 'deleteLesson') {
    const lesson = state.lessons.find((l) => l.id === (payload.id || payload.lessonId));
    return { expectedRevision: lesson?.revision || '', ...payload };
  }
  if (action === 'removeEnrollment' || action === 'leaveClass') {
    const enrollment = state.enrollments.find((e) =>
      action === 'removeEnrollment'
        ? e.id === payload.enrollmentId
        : e.classId === payload.classId && e.userId === state.user.id,
    );
    return { expectedJoinedAt: enrollment?.joinedAt || '', ...payload };
  }
  const submission = state.submissions.find((s) => s.id === payload.submissionId);
  return {
    expectedGradeRevision: submission?.gradeRevision || '',
    expectedAttempt: submission?.attempt || 1,
    expectedSubmittedAt: submission?.submittedAt || null,
    ...payload,
  };
}
