import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFile, runAction, stateFor } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import { assertOrigin, hashPassword, verifyPassword } from '../src/lib/server/auth';
import { validateUpload, putDocument, fileRecord } from '../src/lib/server/storage';
import type { Classroom, Database, Lesson, Submission } from '../src/lib/types';
const initial = seedData();
function fixture() {
  const db = structuredClone(initial);
  return { db, teacher: db.users[0], student: db.users[1] };
}
test('password hash uses a random salt and rejects wrong passwords', () => {
  const a = hashPassword('a password');
  const b = hashPassword('a password');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('a password', a), true);
  assert.equal(verifyPassword('wrong', a), false);
});
test('student cannot create or manage a class or approve enrollment', () => {
  const { db, student } = fixture();
  assert.throws(
    () => runAction(db, student, { action: 'createClass', title: 'Unauthorized' }),
    /giáo viên/,
  );
  assert.throws(
    () =>
      runAction(db, student, { action: 'updateClass', classId: 'dtq-2026', title: 'Unauthorized' }),
    /quyền/,
  );
  assert.throws(
    () => runAction(db, student, { action: 'approveEnrollment', enrollmentId: 'enrollment-4' }),
    /quyền/,
  );
});
test('student cannot read unpublished lessons, another student drafts or private notes', () => {
  const { db, student } = fixture();
  db.notes.push({
    id: 'secret',
    userId: 'student-2',
    lessonId: 'lesson-1',
    content: 'private',
    updatedAt: new Date().toISOString(),
  });
  const state = stateFor(db, student);
  assert.equal(state.lessons.length, 4);
  assert.equal(state.notes.length, 0);
  assert.equal(state.submissions.length, 0);
  assert.throws(
    () => runAction(db, student, { action: 'saveNote', lessonId: 'lesson-8', content: 'secret' }),
    /chưa xuất bản/,
  );
  assert.equal('passwordHash' in state.users[0], false);
});
test('new class approval, capacity and archived status are enforced', () => {
  const { db, teacher, student } = fixture();
  const c = runAction(db, teacher, {
    action: 'createClass',
    title: 'New class',
    capacity: 1,
    autoApprove: true,
  }) as Classroom;
  runAction(db, student, { action: 'joinClass', code: c.code });
  assert.equal(db.enrollments.find((e) => e.classId === c.id)?.status, 'APPROVED');
  assert.throws(() => runAction(db, db.users[2], { action: 'joinClass', code: c.code }), /sĩ số/);
  runAction(db, teacher, { action: 'archiveClass', classId: c.id, archived: true });
  assert.throws(() => runAction(db, db.users[2], { action: 'joinClass', code: c.code }), /lưu trữ/);
});
test('class deletion requires exact code and removes its related data', () => {
  const { db, teacher } = fixture();
  assert.throws(
    () => runAction(db, teacher, { action: 'deleteClass', classId: 'dtq-2026', code: 'WRONG' }),
    /không khớp/,
  );
  runAction(db, teacher, { action: 'deleteClass', classId: 'dtq-2026', code: 'DTQ-2026' });
  assert.equal(db.lessons.length, 0);
  assert.equal(db.assignments.length, 0);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.enrollments.length, 0);
});
test('publishing requires video and validates actual YouTube hosts', () => {
  const { db, teacher } = fixture();
  const input = {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'A lesson',
    order: 9,
    published: true,
  };
  assert.throws(() => runAction(db, teacher, input), /video/);
  assert.throws(
    () =>
      runAction(db, teacher, {
        ...input,
        videoUrl: 'https://youtube.com.evil.example/watch?v=abcdefghijk',
      }),
    /YouTube/,
  );
  const l = runAction(db, teacher, { ...input, videoUrl: 'https://youtu.be/abcdefghijk' }) as {
    published: boolean;
  };
  assert.equal(l.published, true);
});
test('submission requires pledge, word count and verified file ownership', () => {
  const { db, student } = fixture();
  const input = { action: 'submitAssignment', assignmentId: 'assignment-1', content: 'short' };
  assert.throws(() => runAction(db, student, input), /xác nhận/);
  assert.throws(() => runAction(db, student, { ...input, pledge: true }), /300/);
  assert.throws(
    () =>
      runAction(db, student, {
        ...input,
        pledge: true,
        attachments: [{ id: 'forged', name: 'proof.pdf', size: 10, mimeType: 'application/pdf' }],
      }),
    /Tệp chưa/,
  );
});
test('submission can be withdrawn and resubmitted only within configured attempt limit', () => {
  const { db, student } = fixture();
  const input = {
    action: 'submitAssignment',
    assignmentId: 'assignment-1',
    content: Array(301).fill('hiếu').join(' '),
    pledge: true,
  };
  const s = runAction(db, student, input) as Submission;
  assert.equal(s.attempt, 1);
  runAction(db, student, { action: 'withdrawSubmission', assignmentId: 'assignment-1' });
  const resubmitted = runAction(db, student, input) as Submission;
  assert.equal(resubmitted.attempt, 2);
  assert.throws(
    () => runAction(db, student, { action: 'withdrawSubmission', assignmentId: 'assignment-1' }),
    /hết lượt/,
  );
});
test('unreturned grades stay private and returned grades are visible', () => {
  const { db, teacher } = fixture();
  const student = db.users[2];
  const input = {
    action: 'gradeSubmission',
    submissionId: 'submission-chau',
    rubric: { understanding: 35, application: 30, presentation: 18 },
    feedback: 'Draft teacher feedback',
    returnGrade: false,
  };
  runAction(db, teacher, input);
  const hidden = stateFor(db, student).submissions[0];
  assert.equal(hidden.score, undefined);
  assert.equal(hidden.feedback, '');
  runAction(db, teacher, { ...input, returnGrade: true });
  const visible = stateFor(db, student).submissions[0];
  assert.equal(visible.score, 83);
  assert.equal(visible.status, 'GRADED');
  assert.equal(stateFor(db, student).notifications.length, 1);
  assert.throws(() =>
    runAction(db, teacher, {
      ...input,
      rubric: { understanding: 45, application: 30, presentation: 18 },
    }),
  );
});
test('withdrawing, saving and resubmitting never expose or reuse a previous draft grade', () => {
  const { db, teacher } = fixture();
  const student = db.users[2];
  const submission = db.submissions.find((s) => s.id === 'submission-chau')!;
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: submission.id,
    rubric: { understanding: 35, application: 30, presentation: 18 },
    feedback: 'Private grading draft',
    returnGrade: false,
  });
  const assertNoGrade = (value: Submission) => {
    for (const field of ['score', 'rubric', 'gradedAt']) assert.equal(field in value, false);
    assert.equal(value.feedback, '');
  };
  const withdrawn = runAction(db, student, {
    action: 'withdrawSubmission',
    assignmentId: submission.assignmentId,
  }) as Submission;
  assertNoGrade(withdrawn);
  assertNoGrade(submission);
  assert.equal(withdrawn.status, 'DRAFT');

  // A draft written by an older version must also lose stale grading data when edited.
  Object.assign(submission, {
    score: 83,
    rubric: { understanding: 35, application: 30, presentation: 18 },
    feedback: 'Legacy private grading draft',
    gradedAt: new Date().toISOString(),
  });
  const input = {
    assignmentId: submission.assignmentId,
    content: Array(301).fill('hiếu').join(' '),
    pledge: true,
  };
  assertNoGrade(runAction(db, student, { action: 'saveSubmission', ...input }) as Submission);
  const resubmitted = runAction(db, student, {
    action: 'submitAssignment',
    ...input,
  }) as Submission;
  assertNoGrade(resubmitted);
  assertNoGrade(submission);
  assert.equal(resubmitted.attempt, 2);
  assert.equal(resubmitted.status, 'SUBMITTED');

  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: submission.id,
    rubric: { understanding: 40, application: 38, presentation: 17 },
    feedback: 'Feedback for the new attempt',
    returnGrade: true,
  });
  const returned = stateFor(db, student).submissions.find((s) => s.id === submission.id)!;
  assert.equal(returned.score, 95);
  assert.equal(returned.feedback, 'Feedback for the new attempt');
});
test('student drafts stay private until submission and become private again on withdrawal', () => {
  const { db, teacher, student } = fixture();
  const input = {
    assignmentId: 'assignment-1',
    content: Array(301).fill('private').join(' '),
    pledge: true,
  };
  const draft = runAction(db, student, { action: 'saveSubmission', ...input }) as Submission;
  assert.equal(
    stateFor(db, student).submissions.find((s) => s.id === draft.id)?.content,
    input.content,
  );
  assert.equal(
    stateFor(db, teacher).submissions.some((s) => s.id === draft.id),
    false,
  );

  runAction(db, student, { action: 'submitAssignment', ...input });
  assert.equal(
    stateFor(db, teacher).submissions.find((s) => s.id === draft.id)?.content,
    input.content,
  );
  runAction(db, student, { action: 'withdrawSubmission', assignmentId: input.assignmentId });
  assert.equal(
    stateFor(db, teacher).submissions.some((s) => s.id === draft.id),
    false,
  );
  assert.equal(stateFor(db, student).submissions.find((s) => s.id === draft.id)?.status, 'DRAFT');
});
test('teachers can download submitted attachments but cannot read draft or unattached student files', () => {
  const { db, teacher, student } = fixture();
  const file = {
    ...fileRecord(
      student.id,
      validateUpload({
        classId: 'dtq-2026',
        name: 'private.pdf',
        size: 20,
        mimeType: 'application/pdf',
      }),
    ),
    verified: true,
  };
  db.files.push(file);
  assert.equal(accessFile(db, student, file.id).id, file.id);
  assert.throws(() => accessFile(db, teacher, file.id), { status: 403 });
  const input = { assignmentId: 'assignment-1', attachments: [file], pledge: true };
  runAction(db, student, { action: 'saveSubmission', ...input });
  assert.throws(() => accessFile(db, teacher, file.id), { status: 403 });

  runAction(db, student, { action: 'submitAssignment', ...input });
  assert.equal(accessFile(db, teacher, file.id).id, file.id);
  assert.throws(() => accessFile(db, db.users[2], file.id), { status: 403 });
  const enrollment = db.enrollments.find(
    (e) => e.userId === student.id && e.classId === 'dtq-2026',
  )!;
  const status = enrollment.status;
  enrollment.status = 'REMOVED';
  assert.equal(accessFile(db, student, file.id).id, file.id);
  enrollment.status = status;
  runAction(db, student, { action: 'withdrawSubmission', assignmentId: input.assignmentId });
  assert.throws(() => accessFile(db, teacher, file.id), { status: 403 });
  assert.equal(accessFile(db, student, file.id).id, file.id);
});
test('published lesson files remain available to approved members and unverified files stay inaccessible', () => {
  const { db, teacher, student } = fixture();
  const file = {
    ...fileRecord(
      teacher.id,
      validateUpload({
        classId: 'dtq-2026',
        name: 'lesson.pdf',
        size: 20,
        mimeType: 'application/pdf',
      }),
    ),
    verified: true,
  };
  db.files.push(file);
  const lesson = db.lessons[0];
  lesson.documents = [file];
  lesson.published = false;
  assert.throws(() => accessFile(db, student, file.id), { status: 403 });
  assert.equal(accessFile(db, teacher, file.id).id, file.id);
  lesson.published = true;
  assert.equal(accessFile(db, student, file.id).id, file.id);
  assert.throws(() => accessFile(db, db.users[4], file.id), { status: 403 });
  file.verified = false;
  assert.throws(() => accessFile(db, teacher, file.id), { status: 404 });
});
test('publishing an uploaded video requires a verified video owned by its class teacher', () => {
  const { db, teacher } = fixture();
  const input = {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'Uploaded lesson',
    order: 9,
    published: true,
    videoType: 'UPLOAD',
    videoUrl: 'https://example.invalid/untrusted.mp4',
  };
  assert.throws(() => runAction(db, teacher, input), { status: 400 });
  const file = {
    ...fileRecord(
      teacher.id,
      validateUpload({
        classId: input.classId,
        name: 'video.mp4',
        size: 24,
        mimeType: 'video/mp4',
        kind: 'video',
      }),
    ),
    verified: true,
  };
  for (const changes of [
    { verified: false },
    { ownerId: 'student-1' },
    { classId: 'dtq-tin' },
    { mimeType: 'application/pdf' },
  ]) {
    db.files = [{ ...file, ...changes }];
    assert.throws(() => runAction(db, teacher, { ...input, videoFileId: file.id }), {
      status: 404,
    });
  }
  db.files = [file];
  const lesson = runAction(db, teacher, { ...input, videoFileId: file.id }) as Lesson;
  assert.equal(lesson.published, true);
  assert.equal(lesson.videoFileId, file.id);
  assert.equal(lesson.videoUrl, `/api/files/${file.id}`);
});
test('an uploaded-video draft can omit its file and discards caller-supplied video URLs', () => {
  const { db, teacher } = fixture();
  const lesson = runAction(db, teacher, {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'Video draft',
    order: 9,
    published: false,
    videoType: 'UPLOAD',
    videoUrl: 'https://example.invalid/untrusted.mp4',
  }) as Lesson;
  assert.equal(lesson.published, false);
  assert.equal(lesson.videoUrl, '');
  assert.equal(lesson.videoFileId, undefined);
});
test('late submission permission never extends the withdrawal deadline', () => {
  for (const allowLate of [false, true]) {
    const { db } = fixture();
    db.assignments[0].dueAt = new Date(Date.now() - 60_000).toISOString();
    db.assignments[0].allowLate = allowLate;
    assert.throws(
      () =>
        runAction(db, db.users[2], {
          action: 'withdrawSubmission',
          assignmentId: 'assignment-1',
        }),
      { status: 409, message: 'Đã hết hạn thu hồi bài làm.' },
    );
    assert.equal(db.submissions[0].status, 'SUBMITTED');
  }
});
test('a stale grading form cannot grade a later submission attempt', () => {
  const { db, teacher } = fixture();
  const student = db.users[2];
  const submission = db.submissions[0];
  const opened = {
    expectedAttempt: submission.attempt,
    expectedSubmittedAt: submission.submittedAt,
  };
  runAction(db, student, { action: 'withdrawSubmission', assignmentId: submission.assignmentId });
  runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: submission.assignmentId,
    content: Array(301).fill('hiếu').join(' '),
    pledge: true,
  });
  const grade = {
    action: 'gradeSubmission',
    submissionId: submission.id,
    rubric: { understanding: 35, application: 37, presentation: 18 },
    returnGrade: true,
  };
  assert.throws(() => runAction(db, teacher, { ...grade, ...opened }), { status: 409 });
  assert.equal(submission.status, 'SUBMITTED');
  assert.equal(submission.score, undefined);
  runAction(db, teacher, {
    ...grade,
    expectedAttempt: submission.attempt,
    expectedSubmittedAt: submission.submittedAt,
  });
  assert.equal(submission.score, 90);
});
test('file metadata rejects extension spoofing and oversized documents', () => {
  assert.throws(
    () =>
      validateUpload({ classId: 'a', name: 'homework.exe', size: 10, mimeType: 'application/pdf' }),
    /Định dạng/,
  );
  assert.throws(
    () =>
      validateUpload({
        classId: 'a',
        name: 'homework.pdf',
        size: 30 * 1024 * 1024,
        mimeType: 'application/pdf',
      }),
    /25 MB/,
  );
});
test('missing or generic browser MIME is inferred from supported extension', () => {
  assert.equal(
    validateUpload({ classId: 'a', name: 'homework.DOCX', size: 10, mimeType: '' }).mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(
    validateUpload({
      classId: 'a',
      name: 'lesson.mp4',
      size: 10,
      mimeType: 'application/octet-stream',
      kind: 'video',
    }).mimeType,
    'video/mp4',
  );
  assert.throws(
    () => validateUpload({ classId: 'a', name: 'homework.pdf', size: 10, mimeType: 'image/png' }),
    /Định dạng/,
  );
});
test('file content signature rejects executable data renamed as PDF before any upload', async () => {
  const v = validateUpload({
    classId: 'dtq-2026',
    name: 'bad.pdf',
    size: 8,
    mimeType: 'application/pdf',
  });
  await assert.rejects(
    putDocument(fileRecord('student-1', v), Buffer.from('MZfakeEX')),
    /Nội dung tệp/,
  );
});
test('cross-origin mutations are rejected', () => {
  assert.throws(
    () =>
      assertOrigin(
        new Request('http://localhost:3000/api/actions', {
          headers: { Origin: 'https://evil.example' },
        }),
      ),
    /không hợp lệ/,
  );
  assertOrigin(
    new Request('http://localhost:3000/api/actions', {
      headers: { Origin: 'http://localhost:3000' },
    }),
  );
});

test('same-origin browser requests use public Host behind Next development bind address', () => {
  assertOrigin(
    new Request('http://0.0.0.0:3000/api/actions', {
      headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000' },
    }),
  );
  assert.throws(
    () =>
      assertOrigin(
        new Request('http://0.0.0.0:3000/api/actions', {
          headers: { Host: 'localhost:3000', Origin: 'https://evil.example' },
        }),
      ),
    /không hợp lệ/,
  );
});
