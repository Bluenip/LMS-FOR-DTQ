import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFile, runAction, stateFor } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Classroom, Enrollment, Lesson, Submission } from '../src/lib/types';

function fixture() {
  const db = seedData();
  const teacher = db.users[0];
  const student = db.users[1];
  const create = (values: Record<string, unknown> = {}) =>
    runAction(db, teacher, {
      action: 'createAssignment',
      classId: 'dtq-2026',
      title: 'Kiểm tra công bố',
      instructions: 'Hướng dẫn',
      dueAt: '2099-01-01T00:00:00.000Z',
      minWords: 0,
      maxAttempts: 5,
      ...values,
    }) as Assignment;
  const visible = (a: Assignment) => stateFor(db, student).assignments.some((x) => x.id === a.id);
  const announced = (a: Assignment) =>
    db.notifications.filter(
      (n) =>
        n.assignmentId === a.id &&
        n.userId === student.id &&
        n.content.startsWith('Lớp có bài tập mới:'),
    ).length;
  const submit = (a: Assignment) =>
    runAction(db, student, {
      action: 'submitAssignment',
      assignmentId: a.id,
      content: 'Nội dung bài làm',
      pledge: true,
    }) as Submission;
  return { db, teacher, student, create, visible, announced, submit };
}

test('deleting a draft lesson preserves hidden assignments until explicit publication', () => {
  const { db, teacher, create, visible, announced } = fixture();
  const a = create({ lessonId: 'lesson-5' });
  assert(!visible(a));
  runAction(db, teacher, {
    action: 'deleteLesson',
    lessonId: 'lesson-5',
    expectedRevision: db.lessons.find((l) => l.id === 'lesson-5')?.revision || '',
  });
  assert.equal(a.lessonId, undefined);
  assert.equal(a.published, false);
  assert(!visible(a));
  assert.equal(announced(a), 0);
  runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, published: true });
  assert(visible(a));
  assert.equal(announced(a), 1);
  runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, published: false });
  runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, published: true });
  assert.equal(announced(a), 1);
});

test('detaching a draft does not publish implicitly and explicit detach publication announces once', () => {
  const { db, teacher, create, visible, announced } = fixture();
  const a = create({ lessonId: 'lesson-5' });
  runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, lessonId: null });
  assert(!visible(a));
  assert.equal(announced(a), 0);
  const b = create({ lessonId: 'lesson-5' });
  runAction(db, teacher, {
    action: 'updateAssignment',
    assignmentId: b.id,
    lessonId: null,
    published: true,
  });
  assert(visible(b));
  assert.equal(announced(b), 1);
});

test('publishing a linked lesson announces only once across repeated publication', () => {
  const { db, teacher, create, visible, announced } = fixture();
  const a = create({ lessonId: 'lesson-5' });
  const l = db.lessons.find((l) => l.id === 'lesson-5')!;
  const save = (published: boolean) =>
    runAction(db, teacher, { ...l, action: 'saveLesson', published, description: 'Nội dung' });
  save(true);
  assert(visible(a));
  assert.equal(announced(a), 1);
  save(false);
  assert(!visible(a));
  save(true);
  assert.equal(announced(a), 1);
});

test('hidden work keeps own submitted or graded history and files but blocks new submissions and reminders', () => {
  const { db, teacher, student, create, visible, submit } = fixture();
  const a = create();
  const s = submit(a);
  const stored = db.submissions.find((x) => x.id === s.id)!;
  db.files.push({
    id: 'own-file',
    ownerId: student.id,
    classId: a.classId,
    key: 'key',
    name: 'work.pdf',
    size: 10,
    mimeType: 'application/pdf',
    verified: true,
    createdAt: a.createdAt,
  });
  stored.attachments.push({
    id: 'own-file',
    name: 'work.pdf',
    size: 10,
    mimeType: 'application/pdf',
  });
  runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, lessonId: 'lesson-5' });
  assert(visible(a));
  assert.equal(stateFor(db, student).assignments.find((x) => x.id === a.id)?.published, false);
  assert.equal(stateFor(db, student).submissions.find((x) => x.id === s.id)?.content, s.content);
  assert.equal(accessFile(db, student, 'own-file').id, 'own-file');
  assert.throws(
    () => runAction(db, student, { action: 'saveSubmission', assignmentId: a.id, content: 'New' }),
    /chưa được công bố/,
  );
  assert.throws(
    () => runAction(db, teacher, { action: 'remindStudents', assignmentId: a.id }),
    /chưa được công bố/,
  );
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: s.id,
    rubric: { understanding: 20, application: 30, presentation: 10 },
    returnGrade: true,
  });
  assert.equal(stateFor(db, student).submissions.find((x) => x.id === s.id)?.score, 60);
  assert(!stateFor(db, db.users[2]).assignments.some((x) => x.id === a.id));
});

test('stale withdrawal cannot revoke a later attempt or concurrent draft grade', () => {
  const { db, teacher, student, create, submit } = fixture();
  const a = create();
  const first = submit(a);
  const old = {
    action: 'withdrawSubmission',
    assignmentId: a.id,
    expectedRevision: first.revision,
  };
  runAction(db, student, old);
  const second = submit(a);
  const beforeGrade = second.revision;
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: second.id,
    rubric: { understanding: 20, application: 30, presentation: 10 },
    feedback: 'Giữ điểm nháp',
  });
  for (const expectedRevision of [first.revision, beforeGrade])
    assert.throws(() => runAction(db, student, { ...old, expectedRevision }), /phiên khác/);
  const stored = db.submissions.find((s) => s.id === second.id)!;
  assert.equal(stored.status, 'SUBMITTED');
  assert.equal(stored.score, 60);
  assert.equal(stored.feedback, 'Giữ điểm nháp');
  runAction(db, student, { ...old, expectedRevision: stored.revision });
  assert.equal(stored.status, 'DRAFT');
});

test('stale lesson, assignment and class deletions preserve edited records and related data', () => {
  const { db, teacher, create, submit } = fixture();
  const l = runAction(db, teacher, {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'Bài mới',
    description: 'Nội dung',
    order: 20,
  }) as Lesson;
  const lessonRevision = l.revision;
  runAction(db, teacher, { ...l, action: 'saveLesson', description: 'Nội dung mới' });
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'deleteLesson',
        lessonId: l.id,
        expectedRevision: lessonRevision,
      }),
    /phiên khác/,
  );
  assert(db.lessons.some((x) => x.id === l.id));
  const a = create();
  const submission = submit(a);
  const assignmentRevision = a.revision;
  runAction(db, teacher, {
    action: 'updateAssignment',
    assignmentId: a.id,
    instructions: 'Đề mới cùng tên',
  });
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'deleteAssignment',
        assignmentId: a.id,
        confirmTitle: a.title,
        expectedRevision: assignmentRevision,
      }),
    /phiên khác/,
  );
  assert(db.submissions.some((s) => s.id === submission.id));
  const c = db.classes.find((c) => c.id === a.classId)!;
  const classRevision = c.revision || '';
  runAction(db, teacher, { action: 'updateClass', classId: c.id, description: 'Thông tin mới' });
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'deleteClass',
        classId: c.id,
        code: c.code,
        expectedRevision: classRevision,
      }),
    /phiên khác/,
  );
  assert(db.classes.some((x) => x.id === c.id));
});

test('stale removal cannot remove a new enrollment even when rejoining in the same millisecond', () => {
  const { db, teacher, student } = fixture();
  const c = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp tái tham gia',
    autoApprove: true,
  }) as Classroom;
  const e = runAction(db, student, { action: 'joinClass', code: c.code }) as Enrollment;
  const firstJoin = e.joinedAt;
  runAction(db, student, { action: 'leaveClass', classId: c.id, expectedJoinedAt: firstJoin });
  runAction(db, student, { action: 'joinClass', code: c.code });
  assert.notEqual(e.joinedAt, firstJoin);
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'removeEnrollment',
        enrollmentId: e.id,
        expectedJoinedAt: firstJoin,
      }),
    /tham gia lớp đã thay đổi/,
  );
  assert.equal(e.status, 'APPROVED');
});

test('teacher state retains publication intent when editing an assignment linked to a draft', () => {
  const { db, teacher, create, visible, announced } = fixture();
  const a = create({ lessonId: 'lesson-5' });
  const editor = stateFor(db, teacher).assignments.find((entry) => entry.id === a.id)!;
  assert.equal(editor.published, true);
  assert(!visible(a));
  runAction(db, teacher, {
    ...editor,
    action: 'updateAssignment',
    assignmentId: a.id,
    title: 'Chỉ sửa tiêu đề',
  });
  const lesson = db.lessons.find((l) => l.id === 'lesson-5')!;
  runAction(db, teacher, {
    ...lesson,
    action: 'saveLesson',
    description: 'Nội dung',
    published: true,
  });
  assert(visible(a));
  assert.equal(announced(a), 1);
});
