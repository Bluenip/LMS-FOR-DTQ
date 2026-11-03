import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTION_TABLES, runAction, tablesFor } from '../src/lib/server/actions';
import { requireUser } from '../src/lib/server/auth';
import { withDatabase } from '../src/lib/server/repository';
import type { DriveUpload } from '../src/lib/types';

process.env.LMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'action-tables-'));
delete process.env.DATABASE_URL;
// With TEST_DATABASE_URL (a local PostgreSQL with migrations applied) the same scenario runs against
// the real database, which also exercises the partial-table write path.
const pgUrl = process.env.TEST_DATABASE_URL;
const usePostgres = !!pgUrl && ['localhost', '127.0.0.1'].includes(new URL(pgUrl).hostname);
before(async () => {
  if (!usePostgres) return;
  process.env.DATABASE_URL = pgUrl;
  process.env.ALLOW_DEMO_ACCOUNTS = 'true'; // the seeded demo accounts stand in for real ones
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Classroom", "DriveTrash" CASCADE');
  await prisma.$disconnect();
  await (await import('../src/lib/server/repository')).seedPostgres();
});

/** Runs an action exactly like the API route: a write transaction that only loads its own tables. */
const called = new Set<string>();
async function act<T = Record<string, unknown>>(userId: string, input: Record<string, unknown>) {
  called.add(String(input.action));
  return (await withDatabase(
    (db) => runAction(db, requireUser(db, userId), input),
    true,
    tablesFor(input.action),
  )) as T;
}
const job = (over: Partial<DriveUpload>): DriveUpload => ({
  id: 'job',
  ownerId: 'teacher-1',
  classId: 'x',
  kind: 'document',
  name: 'f.pdf',
  mimeType: 'application/pdf',
  size: 5,
  title: 'f',
  description: '',
  status: 'COMPLETED',
  bytesUploaded: 5,
  driveFileId: 'drive-file-0123456789',
  shared: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

test('every action works with only the tables it declares', async () => {
  // A second teacher to assign to the class.
  await withDatabase((db) => {
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    db.users.push({
      ...teacher,
      id: 'teacher-2',
      email: 'teacher2@example.invalid',
      isDemo: false,
    });
  }, true);

  const t = 'teacher-1';
  const s1 = 'student-1';
  const s2 = 'student-2';
  const klass = await act<{ id: string; code: string; revision: string }>(t, {
    action: 'createClass',
    title: 'Lớp bảng',
    autoApprove: false,
  });
  const enrollmentOf = (userId: string) =>
    withDatabase(
      (db) => db.enrollments.find((e) => e.classId === klass.id && e.userId === userId)!.id,
    );

  // --- enrolment lifecycle
  await act(s1, { action: 'previewClass', code: klass.code });
  await act(s1, { action: 'joinClass', code: klass.code });
  await act(s1, { action: 'cancelEnrollment', classId: klass.id });
  await act(s1, { action: 'joinClass', code: klass.code });
  await act(t, { action: 'rejectEnrollment', enrollmentId: await enrollmentOf(s1) });
  await act(s1, { action: 'joinClass', code: klass.code });
  await act(t, { action: 'approveEnrollment', enrollmentId: await enrollmentOf(s1) });
  await act(s1, { action: 'leaveClass', classId: klass.id });
  await act(s1, { action: 'joinClass', code: klass.code });
  await act(t, { action: 'approveEnrollment', enrollmentId: await enrollmentOf(s1) });
  await act(t, { action: 'setEnrollmentGroup', enrollmentId: await enrollmentOf(s1), group: 2 });
  await act(s2, { action: 'joinClass', code: klass.code });
  await act(t, { action: 'approveEnrollment', enrollmentId: await enrollmentOf(s2) });
  await act(t, { action: 'removeEnrollment', enrollmentId: await enrollmentOf(s2) });

  // --- class settings
  await act(t, {
    action: 'updateClass',
    classId: klass.id,
    title: 'Lớp bảng 2',
    expectedRevision: klass.revision,
  });
  await act(t, {
    action: 'setClassTeachers',
    classId: klass.id,
    teacherIds: ['teacher-2'],
    expectedTeacherIds: [],
  });
  const regenerated = await act<{ code: string }>(t, {
    action: 'regenerateCode',
    classId: klass.id,
  });
  await act(t, { action: 'archiveClass', classId: klass.id, archived: true });
  await act(t, { action: 'archiveClass', classId: klass.id, archived: false });

  // --- lessons (with a Drive video and a Drive document attached)
  await withDatabase((db) => {
    db.driveUploads.push(
      job({
        id: 'video-job',
        classId: klass.id,
        kind: 'video',
        mimeType: 'video/mp4',
        name: 'v.mp4',
        driveFileId: 'drive-video-0123456789',
      }),
      job({ id: 'doc-job', classId: klass.id, ownerId: s1, driveFileId: 'drive-doc-0123456789' }),
    );
  }, true);
  const lesson = await act<{ id: string; revision: string }>(t, {
    action: 'saveLesson',
    classId: klass.id,
    title: 'Bài một',
    order: 1,
    description: 'Nội dung',
    published: true,
  });
  await act(t, {
    action: 'saveLesson',
    id: lesson.id,
    classId: klass.id,
    title: 'Bài một',
    order: 1,
    videoType: 'DRIVE',
    driveFileId: 'drive-video-0123456789',
    published: true,
    expectedRevision: lesson.revision,
  });
  await act(s1, { action: 'completeLesson', lessonId: lesson.id, completed: true });
  await act(s1, { action: 'bookmarkLesson', lessonId: lesson.id, bookmarked: true });
  await act(s1, {
    action: 'saveNote',
    lessonId: lesson.id,
    content: 'ghi chú',
    expectedUpdatedAt: null,
  });
  const comment = await act<{ id: string }>(s1, {
    action: 'comment',
    lessonId: lesson.id,
    content: 'Câu hỏi',
  });
  await act(s1, {
    action: 'updateComment',
    discussionId: comment.id,
    content: 'Câu hỏi 2',
    expectedContent: 'Câu hỏi',
  });
  await act(t, { action: 'deleteComment', discussionId: comment.id, expectedContent: 'Câu hỏi 2' });

  // --- assignments and submissions
  const due = new Date(Date.now() + 86400000).toISOString();
  const first = await act<{ id: string; revision: string; title: string }>(t, {
    action: 'createAssignment',
    classId: klass.id,
    title: 'Bài tập 1',
    instructions: '',
    dueAt: due,
    minWords: 0,
    lessonId: lesson.id,
  });
  await act(t, {
    action: 'updateAssignment',
    assignmentId: first.id,
    title: 'Bài tập 1',
    expectedRevision: first.revision,
  });
  const second = await act<{ id: string; title: string }>(t, {
    action: 'createAssignment',
    classId: klass.id,
    title: 'Bài tập 2',
    instructions: '',
    dueAt: due,
    minWords: 0,
  });
  await act(s1, {
    action: 'saveSubmission',
    assignmentId: first.id,
    content: 'nháp',
    attachments: [{ id: 'doc-job', name: 'x', size: 1, mimeType: 'x' }],
  });
  await act(s1, {
    action: 'submitAssignment',
    assignmentId: first.id,
    content: 'bài làm',
    attachments: [{ id: 'doc-job', name: 'x', size: 1, mimeType: 'x' }],
    pledge: true,
  });
  await act(s1, { action: 'withdrawSubmission', assignmentId: first.id });
  await act(s1, {
    action: 'submitAssignment',
    assignmentId: first.id,
    content: 'bài làm lại',
    pledge: true,
  });
  const submission = await withDatabase((db) =>
    db.submissions.find((x) => x.assignmentId === first.id)!,
  );
  await act(t, {
    action: 'gradeSubmission',
    submissionId: submission.id,
    rubric: { understanding: 30, application: 30, presentation: 15 },
    feedback: 'Tốt',
    returnGrade: true,
  });
  await act(t, { action: 'remindStudents', assignmentId: second.id });
  await act(s1, { action: 'markNotificationsRead' });

  // --- clean-up operations
  await act(t, { action: 'deleteAssignment', assignmentId: first.id, confirmTitle: first.title });
  await act(t, { action: 'deleteLesson', lessonId: lesson.id });
  await act(t, { action: 'deleteClass', classId: klass.id, code: regenerated.code });

  const missing = Object.keys(ACTION_TABLES).filter((name) => !called.has(name));
  assert.deepEqual(missing, [], 'every declared action is exercised by this test');
});

test('an action that touches a table it did not declare fails instead of reading an empty table', async () => {
  await assert.rejects(
    withDatabase(
      (db) => runAction(db, requireUser(db, 'student-1'), { action: 'joinClass', code: 'LH-NOPE' }),
      true,
      ['users'],
    ),
    /was not loaded/,
  );
});

test('actions without a table list (broad ones) load every table', async () => {
  assert.equal(tablesFor('deleteClass'), undefined);
  assert.equal(tablesFor('unknown-action'), undefined);
});
