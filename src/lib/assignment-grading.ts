import type { AppState, Assignment, Classroom, Submission, User } from './types';

export type AssignmentRow = { user?: User; studentId: string; submission?: Submission };

/** The gradebook is limited to students currently approved in this assignment's class. */
export function assignmentRows(state: AppState, assignment: Assignment): AssignmentRow[] {
  const submissions = new Map(
    state.submissions
      .filter((s) => s.assignmentId === assignment.id && s.status !== 'DRAFT')
      .map((s) => [s.studentId, s]),
  );
  const users = new Map(state.users.map((user) => [user.id, user]));
  return state.enrollments
    .filter((e) => e.classId === assignment.classId && e.status === 'APPROVED')
    .map((e) => ({
      studentId: e.userId,
      user: users.get(e.userId),
      submission: submissions.get(e.userId),
    }));
}

export function assignmentStats(rows: AssignmentRow[]) {
  const pending = rows.filter((row) => row.submission?.status === 'SUBMITTED').length;
  const gradedRows = rows.filter((row) => row.submission?.status === 'GRADED');
  const scores = gradedRows
    .map((row) => row.submission?.score)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  const submitted = pending + gradedRows.length;
  return {
    total: rows.length,
    submitted,
    pending,
    graded: gradedRows.length,
    missing: rows.length - submitted,
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
  };
}

export function submissionStatus(submission?: Submission) {
  if (!submission || submission.status === 'DRAFT') return 'Chưa nộp';
  if (submission.status === 'GRADED') return 'Đã chấm';
  return submission.score != null ? 'Chờ chấm · Có điểm nháp' : 'Chờ chấm';
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  // A leading whitespace/control character must not bypass spreadsheet formula protection.
  const protectedText = /^[\s\u0000-\u001f]*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
};

export function assignmentCsv(
  rows: AssignmentRow[],
  classroom: Classroom,
  assignment: Assignment,
  formatDate: (date: string) => string,
) {
  return (
    '\uFEFF' +
    [
      ['Học viên', 'Email', 'Trạng thái', 'Điểm', 'Nộp lúc', 'Lớp', 'Bài tập'],
      ...rows.map(({ user, submission }) => [
        user?.name ?? '',
        user?.email ?? '',
        submissionStatus(submission),
        submission?.status === 'GRADED' ? (submission.score ?? '') : '',
        submission?.submittedAt ? formatDate(submission.submittedAt) : '',
        classroom.code,
        assignment.title,
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}

export function assignmentCsvFilename(classroom: Classroom, assignment: Assignment) {
  const safe = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'bai-tap';
  return `bang-diem-${safe(classroom.code)}-${safe(assignment.title)}-${safe(assignment.id)}.csv`;
}
