import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFile, classTeacherOptions, runAction, stateFor } from '../src/lib/server/actions';
import { assignedTeacherIds, classTeacherNames, managesClass } from '../src/lib/class-teachers';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Classroom, Discussion, StoredUser, Submission } from '../src/lib/types';

function fixture() {
  const db = seedData();
  const owner = db.users[0];
  const teachers = ['teacher-a', 'teacher-b', 'teacher-outside'].map((id, index): StoredUser => ({
    ...owner,
    id,
    name: `Giáo viên ${index + 1}`,
    email: `${id}@example.invalid`,
    isDemo: false,
  }));
  db.users.push(...teachers);
  const classroom = runAction(db, owner, {
    action: 'createClass',
    title: 'Lớp có nhiều giáo viên',
    autoApprove: true,
  }) as Classroom;
  const student = db.users[1];
  runAction(db, student, { action: 'joinClass', code: classroom.code });
  const set = (teacherIds: string[], expectedTeacherIds = assignedTeacherIds(classroom)) =>
    runAction(db, owner, {
      action: 'setClassTeachers',
      classId: classroom.id,
      teacherIds,
      expectedTeacherIds,
    });
  return { db, owner, teachers, classroom, student, set };
}

test('a class creator can assign multiple teachers without being displayed as one', () => {
  const { db, owner, teachers, classroom, student, set } = fixture();
  assert.deepEqual(assignedTeacherIds(classroom), []);
  assert.equal(
    classTeacherNames(classroom, stateFor(db, student).users),
    'Chưa phân công giáo viên',
  );
  set([teachers[0].id, teachers[1].id]);
  assert.equal(
    classTeacherNames(classroom, stateFor(db, student).users),
    'Giáo viên 1, Giáo viên 2',
  );
  assert(managesClass(classroom, owner));
  for (const teacher of teachers.slice(0, 2)) {
    assert(managesClass(classroom, teacher));
    assert(stateFor(db, teacher).classes.some((c) => c.id === classroom.id));
    runAction(db, teacher, {
      action: 'createAssignment',
      classId: classroom.id,
      title: 'Bài giảng viên giao',
      instructions: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
  }
  assert(!stateFor(db, teachers[2]).classes.some((c) => c.id === classroom.id));
  assert(classTeacherOptions(db, owner, classroom.id).some((u) => u.id === teachers[0].id));
  assert.throws(() => classTeacherOptions(db, teachers[0], classroom.id), /Chỉ người quản lý lớp/);
  assert.throws(
    () =>
      runAction(db, teachers[0], {
        action: 'setClassTeachers',
        classId: classroom.id,
        teacherIds: [],
        expectedTeacherIds: [teachers[0].id, teachers[1].id],
      }),
    /Chỉ người quản lý lớp/,
  );
  assert.throws(
    () =>
      runAction(db, teachers[0], {
        action: 'deleteClass',
        classId: classroom.id,
        code: classroom.code,
      }),
    /Chỉ người quản lý lớp/,
  );
  set([teachers[1].id]);
  assert(!stateFor(db, teachers[0]).classes.some((c) => c.id === classroom.id));
  assert.throws(
    () =>
      runAction(db, teachers[0], {
        action: 'createAssignment',
        classId: classroom.id,
        title: 'Không được giao',
        instructions: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    /quyền/,
  );
  assert(managesClass(classroom, owner));
});

test('teacher assignment validates identities, account status, and concurrent changes', () => {
  const { db, teachers, classroom, student, set } = fixture();
  for (const invalid of [[student.id], ['unknown-id'], [teachers[0].id, teachers[0].id]])
    assert.throws(() => set(invalid));
  teachers[0].disabled = true;
  assert.throws(() => set([teachers[0].id]), /đang hoạt động/);
  teachers[0].disabled = false;
  set([teachers[0].id]);
  teachers[0].disabled = true;
  set([teachers[0].id, teachers[1].id]);
  assert.throws(() => set([], []), /đã thay đổi/);
  assert.deepEqual(assignedTeacherIds(classroom), [teachers[0].id, teachers[1].id]);
});

test('assigned teachers can grade and moderate; a teacher enrolled elsewhere gains no private access', () => {
  const { db, owner, teachers, classroom, student, set } = fixture();
  const [teacher, , outsider] = teachers;
  set([teacher.id]);
  const lesson = runAction(db, owner, {
    action: 'saveLesson',
    classId: classroom.id,
    title: 'Bài giảng nháp',
    order: 1,
  }) as { id: string };
  const assignment = runAction(db, owner, {
    action: 'createAssignment',
    classId: classroom.id,
    title: 'Bài tập chung',
    instructions: '',
    minWords: 0,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  }) as Assignment;
  const submission = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: assignment.id,
    content: 'Bài làm',
    pledge: true,
  }) as Submission;
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: submission.id,
    rubric: { understanding: 0, application: 0, presentation: 0 },
    feedback: 'Nháp',
    returnGrade: false,
  });
  assert.equal(stateFor(db, teacher).submissions.find((s) => s.id === submission.id)?.score, 0);
  assert.equal(
    stateFor(db, student).submissions.find((s) => s.id === submission.id)?.score,
    undefined,
  );
  assert(stateFor(db, teacher).lessons.some((entry) => entry.id === lesson.id));
  db.enrollments.push({
    id: 'outsider-enrollment',
    userId: outsider.id,
    classId: classroom.id,
    status: 'APPROVED',
    group: 1,
    joinedAt: new Date().toISOString(),
  });
  assert(!stateFor(db, outsider).lessons.some((entry) => entry.id === lesson.id));
  assert(!stateFor(db, outsider).submissions.some((entry) => entry.id === submission.id));
  assert.throws(
    () =>
      runAction(db, outsider, {
        action: 'gradeSubmission',
        submissionId: submission.id,
        rubric: { understanding: 0, application: 0, presentation: 0 },
        returnGrade: true,
      }),
    /quyền/,
  );
  const published = runAction(db, owner, {
    action: 'saveLesson',
    classId: classroom.id,
    title: 'Bài giảng công khai',
    order: 2,
    published: true,
    videoUrl: 'https://youtu.be/abcdefghijk',
  }) as { id: string };
  const comment = runAction(db, student, {
    action: 'comment',
    lessonId: published.id,
    content: 'Câu hỏi học viên',
  }) as Discussion;
  assert.throws(
    () =>
      runAction(db, outsider, {
        action: 'deleteComment',
        discussionId: comment.id,
        expectedContent: comment.content,
      }),
    /giáo viên phụ trách/,
  );
  runAction(db, teacher, {
    action: 'deleteComment',
    discussionId: comment.id,
    expectedContent: comment.content,
  });
});

test('teachers can keep existing shared lesson files while editing, without attaching unrelated files', () => {
  const { db, owner, teachers, classroom, set } = fixture();
  const teacher = teachers[0];
  set([teacher.id]);
  const file = {
    id: 'shared-file',
    ownerId: owner.id,
    classId: classroom.id,
    key: 'shared',
    name: 'bai-hoc.pdf',
    size: 5,
    mimeType: 'application/pdf',
    verified: true,
    createdAt: new Date().toISOString(),
  };
  const unrelated = { ...file, id: 'unrelated-file', key: 'unrelated' };
  db.files.push(file, unrelated);
  const document = { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType };
  const lesson = runAction(db, owner, {
    action: 'saveLesson',
    classId: classroom.id,
    title: 'Tài liệu chung',
    order: 1,
    documents: [document],
  }) as { id: string };
  assert.equal(accessFile(db, teacher, file.id).id, file.id);
  runAction(db, teacher, {
    action: 'saveLesson',
    id: lesson.id,
    classId: classroom.id,
    title: 'Tài liệu đã sửa',
    order: 1,
    documents: [document],
  });
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'saveLesson',
        id: lesson.id,
        classId: classroom.id,
        title: 'Không được gắn',
        order: 1,
        documents: [{ ...document, id: unrelated.id }],
      }),
    /không có quyền/,
  );
});
