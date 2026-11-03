import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction, stateFor } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Classroom, Submission } from '../src/lib/types';

const initial = seedData();
function fixture() {
  const db = structuredClone(initial);
  const teacher = db.users[0];
  const student = db.users[1];
  const create = (extra: Record<string, unknown> = {}) =>
    runAction(db, teacher, {
      action: 'createAssignment',
      classId: 'dtq-2026',
      title: 'Bài cảm ngộ tự chọn',
      instructions: 'Viết cảm nhận của bạn.',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      ...extra,
    }) as Assignment;
  return { db, teacher, student, create };
}
const essay = (count: number) => Array(count).fill('hiếu').join(' ');

test('new assignments default to 150 words minimum and accept essays longer than 500 words', () => {
  const { db, student, create } = fixture();
  const a = create();
  assert.equal(a.minWords, 150);
  assert.equal(a.maxWords, null);
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'submitAssignment',
        assignmentId: a.id,
        content: essay(149),
        pledge: true,
      }),
    /tối thiểu 150/,
  );
  const s = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: essay(800),
    pledge: true,
  }) as Submission;
  assert.equal(s.content, essay(800));
  assert.equal(s.status, 'SUBMITTED');
});

test('teachers can set different word ranges and remove either word restriction per assignment', () => {
  const { db, teacher, student, create } = fixture();
  const a = create({ minWords: 25, maxWords: 40 });
  for (const count of [24, 41])
    assert.throws(
      () =>
        runAction(db, student, {
          action: 'submitAssignment',
          assignmentId: a.id,
          content: essay(count),
          pledge: true,
        }),
      /25 đến 40/,
    );
  runAction(db, teacher, {
    action: 'updateAssignment',
    assignmentId: a.id,
    minWords: 0,
    maxWords: null,
  });
  const s = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: essay(1),
    pledge: true,
  }) as Submission;
  assert.equal(s.status, 'SUBMITTED');
  assert.throws(() => create({ minWords: 200, maxWords: 100 }), /tối đa/);
  assert.throws(() => create({ minWords: -1 }));
});

test('editing an assignment preserves existing submissions and grades and can detach its lesson', () => {
  const { db, teacher } = fixture();
  const a = db.assignments.find((a) => a.id === 'assignment-1')!;
  const before = structuredClone(db.submissions);
  const updated = runAction(db, teacher, {
    action: 'updateAssignment',
    assignmentId: a.id,
    title: 'Tên bài đã sửa',
    minWords: 150,
    maxWords: null,
    lessonId: null,
  }) as Assignment;
  assert.equal(updated.id, a.id);
  assert.equal(updated.maxWords, null);
  assert.equal(updated.lessonId, undefined);
  assert.deepEqual(db.submissions, before);
  const snapshot = structuredClone(a);
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'updateAssignment',
        assignmentId: a.id,
        minWords: 500,
        maxWords: 100,
      }),
    /tối đa/,
  );
  assert.deepEqual(a, snapshot);
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'updateAssignment',
        assignmentId: a.id,
        classId: 'dtq-tin',
      }),
    /chuyển/,
  );
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'updateAssignment',
        assignmentId: a.id,
        lessonId: 'unknown-lesson',
      }),
    /không thuộc/,
  );
});

test('only the class owner can edit or delete assignments and archived classes reject changes', () => {
  const { db, teacher, student, create } = fixture();
  const a = create();
  const otherTeacher = { ...teacher, id: 'other-teacher' };
  for (const actor of [student, otherTeacher]) {
    assert.throws(
      () =>
        runAction(db, actor, {
          action: 'updateAssignment',
          assignmentId: a.id,
          title: 'Unauthorized',
        }),
      /quyền/,
    );
    assert.throws(
      () =>
        runAction(db, actor, {
          action: 'deleteAssignment',
          assignmentId: a.id,
          confirmTitle: a.title,
        }),
      /quyền/,
    );
  }
  runAction(db, teacher, { action: 'archiveClass', classId: a.classId, archived: true });
  assert.throws(
    () =>
      runAction(db, teacher, { action: 'updateAssignment', assignmentId: a.id, maxWords: 5000 }),
    /lưu trữ/,
  );
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'deleteAssignment',
        assignmentId: a.id,
        confirmTitle: a.title,
      }),
    /lưu trữ/,
  );
});

test('deletion confirms the exact assignment and removes only its submissions and linked notifications', () => {
  const { db, teacher, student, create } = fixture();
  const a = create();
  const other = create({ title: 'Bài cần giữ' });
  runAction(db, teacher, { action: 'remindStudents', assignmentId: a.id, userId: student.id });
  runAction(db, teacher, { action: 'remindStudents', assignmentId: other.id, userId: student.id });
  runAction(db, student, { action: 'saveSubmission', assignmentId: a.id, content: 'Bản nháp' });
  const lessons = structuredClone(db.lessons);
  const others = db.submissions.filter((s) => s.assignmentId !== a.id);
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'deleteAssignment',
        assignmentId: a.id,
        confirmTitle: 'Sai tên',
      }),
    /không khớp/,
  );
  assert(db.assignments.some((x) => x.id === a.id));
  runAction(db, teacher, { action: 'deleteAssignment', assignmentId: a.id, confirmTitle: a.title });
  assert(!db.assignments.some((x) => x.id === a.id));
  assert(!db.notifications.some((n) => n.assignmentId === a.id));
  assert(db.notifications.some((n) => n.assignmentId === other.id));
  assert.deepEqual(db.submissions, others);
  assert.deepEqual(db.lessons, lessons);
});

test('class deletion also removes linked assignment notifications without leaving foreign keys', () => {
  const { db, teacher, student, create } = fixture();
  const a = create();
  runAction(db, teacher, { action: 'remindStudents', assignmentId: a.id, userId: student.id });
  const c = db.classes.find((c) => c.id === a.classId)!;
  runAction(db, teacher, { action: 'deleteClass', classId: c.id, code: c.code });
  assert(!db.notifications.some((n) => n.assignmentId === a.id));
});

test('reminders reach only the chosen student who has not submitted and remain unread', () => {
  const { db, teacher, student, create } = fixture();
  const a = create();
  runAction(db, student, { action: 'saveSubmission', assignmentId: a.id, content: 'Nháp riêng' });
  const result = runAction(db, teacher, {
    action: 'remindStudents',
    assignmentId: a.id,
    userId: student.id,
  });
  assert.deepEqual(result, { count: 1 });
  const n = stateFor(db, student).notifications.find((n) => n.assignmentId === a.id)!;
  assert(n);
  assert.equal(n.read, false);
  assert(n.content.includes(a.title));
  assert(!stateFor(db, teacher).notifications.some((x) => x.id === n.id));
  assert(!stateFor(db, db.users[2]).notifications.some((x) => x.id === n.id));
  runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: essay(160),
    pledge: true,
  });
  assert.deepEqual(
    runAction(db, teacher, { action: 'remindStudents', assignmentId: a.id, userId: student.id }),
    { count: 0 },
  );
  assert.throws(
    () => runAction(db, student, { action: 'remindStudents', assignmentId: a.id }),
    /quyền/,
  );
});

test('reading displayed notification IDs does not consume another user notification or a newly arrived reminder', () => {
  const { db, teacher, student, create } = fixture();
  const a = create();
  const remind = () =>
    runAction(db, teacher, { action: 'remindStudents', assignmentId: a.id, userId: student.id });
  remind();
  const first = db.notifications.at(-1)!;
  remind();
  const second = db.notifications.at(-1)!;
  runAction(db, teacher, { action: 'markNotificationsRead', ids: [first.id] });
  assert.equal(first.read, false);
  runAction(db, student, { action: 'markNotificationsRead', ids: [first.id] });
  assert.equal(first.read, true);
  assert.equal(second.read, false);
});

test('content attribution is configured per class and can be cleared by its teacher', () => {
  const { db, teacher, student } = fixture();
  const a = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp của cô An',
    contentAuthor: ' Cô An ',
  }) as Classroom;
  const b = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp không gắn tác giả',
  }) as Classroom;
  assert.equal(a.contentAuthor, 'Cô An');
  assert.equal(b.contentAuthor, '');
  runAction(db, teacher, { action: 'updateClass', classId: a.id, contentAuthor: 'Thầy Bình' });
  assert.equal(a.contentAuthor, 'Thầy Bình');
  assert.equal(b.contentAuthor, '');
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'updateClass',
        classId: a.id,
        contentAuthor: 'Unauthorized',
      }),
    /quyền/,
  );
  runAction(db, teacher, { action: 'updateClass', classId: a.id, contentAuthor: '' });
  assert.equal(a.contentAuthor, '');
});
