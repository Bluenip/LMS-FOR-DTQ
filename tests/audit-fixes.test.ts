import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction, stateFor } from '../src/lib/server/actions';
import { createManagedUser, transferClassOwner, updateManagedUser } from '../src/lib/server/admin';
import { DEFAULT_ACCOUNT_PASSWORD } from '../src/lib/account-policy';
import {
  hashPassword,
  needsPasswordChange,
  requireUser,
  verifyPassword,
} from '../src/lib/server/auth';
import { updateProfile } from '../src/lib/server/profile';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Classroom, Lesson, StoredUser, Submission } from '../src/lib/types';

function fixture() {
  const db = seedData();
  const owner = db.users[0];
  const student = db.users[1];
  const teacher: StoredUser = {
    ...owner,
    id: 'another-teacher',
    email: 'other@example.invalid',
    isDemo: false,
  };
  db.users.push(teacher);
  return { db, owner, student, teacher };
}

test('teachers can study other classes without inheriting grading or draft access', () => {
  const { db, owner, student, teacher } = fixture();
  const c = runAction(db, owner, {
    action: 'createClass',
    title: 'Lớp có người học là giáo viên',
    autoApprove: true,
  }) as Classroom;
  runAction(db, teacher, { action: 'joinClass', code: c.code });
  runAction(db, student, { action: 'joinClass', code: c.code });
  const draft = runAction(db, owner, {
    action: 'saveLesson',
    classId: c.id,
    title: 'Bài chưa xuất bản',
    order: 1,
  }) as Lesson;
  const a = runAction(db, owner, {
    action: 'createAssignment',
    classId: c.id,
    title: 'Bài tập',
    instructions: '',
    minWords: 0,
    dueAt: '2099-01-01T00:00:00.000Z',
  }) as Assignment;
  runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: 'Bài của học viên',
    pledge: true,
  });
  const state = stateFor(db, teacher);
  assert(!state.lessons.some((l) => l.id === draft.id));
  assert(!state.submissions.some((s) => s.studentId === student.id && s.assignmentId === a.id));
  assert.equal(state.users.find((u) => u.id === student.id)?.email, '');
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'setClassTeachers',
        classId: c.id,
        teacherIds: [],
        expectedTeacherIds: [],
      }),
    /quyền/,
  );
  const own = runAction(db, teacher, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: 'Bài của tôi',
    pledge: true,
  }) as Submission;
  assert.equal(own.studentId, teacher.id);
  assert.throws(
    () =>
      runAction(db, owner, {
        action: 'setClassTeachers',
        classId: c.id,
        teacherIds: [teacher.id],
        expectedTeacherIds: [],
      }),
    /rời lớp/,
  );
  runAction(db, owner, {
    action: 'gradeSubmission',
    submissionId: own.id,
    rubric: { understanding: 20, application: 20, presentation: 10 },
    feedback: 'Điểm nháp',
    returnGrade: false,
  });
  runAction(db, teacher, { action: 'leaveClass', classId: c.id });
  runAction(db, owner, {
    action: 'setClassTeachers',
    classId: c.id,
    teacherIds: [teacher.id],
    expectedTeacherIds: [],
  });
  assert.equal(stateFor(db, teacher).submissions.find((s) => s.id === own.id)?.score, undefined);
  assert.throws(
    () =>
      runAction(db, teacher, {
        action: 'gradeSubmission',
        submissionId: own.id,
        rubric: { understanding: 0, application: 0, presentation: 0 },
      }),
    /tự chấm/,
  );
});

test('removed members lose access, can rejoin, and retain their historical submission', () => {
  const { db, owner, student } = fixture();
  const c = runAction(db, owner, {
    action: 'createClass',
    title: 'Lớp kiểm tra thành viên',
    autoApprove: true,
  }) as Classroom;
  const enrollment = runAction(db, student, { action: 'joinClass', code: c.code }) as {
    id: string;
  };
  runAction(db, owner, { action: 'setEnrollmentGroup', enrollmentId: enrollment.id, group: 3 });
  const a = runAction(db, owner, {
    action: 'createAssignment',
    classId: c.id,
    title: 'Bài tập',
    instructions: '',
    minWords: 0,
    dueAt: '2099-01-01T00:00:00.000Z',
  }) as Assignment;
  const submission = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: 'Đã nộp',
    pledge: true,
  }) as Submission;
  runAction(db, owner, { action: 'removeEnrollment', enrollmentId: enrollment.id });
  assert(!stateFor(db, student).classes.some((x) => x.id === c.id));
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'saveSubmission',
        assignmentId: a.id,
        content: 'Không có quyền',
      }),
    /chưa được duyệt/,
  );
  runAction(db, student, { action: 'joinClass', code: c.code });
  assert.equal(
    stateFor(db, student).submissions.find((s) => s.id === submission.id)?.content,
    'Đã nộp',
  );
  assert.equal(db.enrollments.find((e) => e.id === enrollment.id)?.group, 3);
});

test('concurrent grading, drafts, notes and lesson edits reject stale versions', () => {
  const { db, owner, student } = fixture();
  const a = runAction(db, owner, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    title: 'Bài kiểm tra',
    instructions: '',
    minWords: 0,
    dueAt: '2099-01-01T00:00:00.000Z',
  }) as Assignment;
  const first = runAction(db, student, {
    action: 'saveSubmission',
    assignmentId: a.id,
    content: 'Mới',
    expectedRevision: '',
  }) as Submission;
  const rev = first.revision;
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'saveSubmission',
        assignmentId: a.id,
        content: 'Cũ',
        expectedRevision: '',
      }),
    /phiên khác/,
  );
  const sent = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: 'Đã nộp',
    pledge: true,
    expectedRevision: rev,
  }) as Submission;
  const grade = {
    action: 'gradeSubmission',
    submissionId: sent.id,
    rubric: { understanding: 20, application: 20, presentation: 10 },
    returnGrade: true,
    expectedGradeRevision: '',
  };
  runAction(db, owner, grade);
  assert.throws(() => runAction(db, owner, grade), /phiên khác/);
  const note = runAction(db, student, {
    action: 'saveNote',
    lessonId: 'lesson-1',
    content: 'Mới',
    expectedUpdatedAt: null,
  }) as { updatedAt: string };
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'saveNote',
        lessonId: 'lesson-1',
        content: 'Cũ',
        expectedUpdatedAt: null,
      }),
    /phiên khác/,
  );
  assert(note.updatedAt);
  const lesson = runAction(db, owner, {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'Phiên bản mới',
    order: 10,
  }) as Lesson;
  const lessonRevision = lesson.revision;
  runAction(db, owner, {
    action: 'saveLesson',
    lessonId: lesson.id,
    classId: lesson.classId,
    title: 'Đã sửa',
    order: 10,
    expectedRevision: lessonRevision,
  });
  assert.throws(
    () =>
      runAction(db, owner, {
        action: 'saveLesson',
        lessonId: lesson.id,
        classId: lesson.classId,
        title: 'Bản cũ',
        order: 10,
        expectedRevision: lessonRevision,
      }),
    /phiên khác/,
  );
});

test('rejects empty submissions, preserves drafts after deadline, and makes archived classes read-only', () => {
  const { db, owner, student } = fixture();
  const a = runAction(db, owner, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    title: 'Bài kiểm tra',
    instructions: '',
    minWords: 0,
    dueAt: '2099-01-01T00:00:00.000Z',
  }) as Assignment;
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'submitAssignment',
        assignmentId: a.id,
        content: '',
        pledge: true,
      }),
    /nhập bài làm/,
  );
  a.dueAt = '2000-01-01T00:00:00.000Z';
  assert.doesNotThrow(() =>
    runAction(db, student, { action: 'saveSubmission', assignmentId: a.id, content: 'Giữ lại' }),
  );
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'submitAssignment',
        assignmentId: a.id,
        content: 'Quá hạn',
        pledge: true,
      }),
    /hết hạn/,
  );
  runAction(db, owner, { action: 'archiveClass', classId: 'dtq-2026', archived: true });
  for (const action of [
    { action: 'deleteLesson', lessonId: 'lesson-1' },
    { action: 'approveEnrollment', enrollmentId: 'enrollment-4' },
    { action: 'comment', lessonId: 'lesson-1', content: 'Không ghi' },
  ])
    assert.throws(
      () => runAction(db, action.action === 'comment' ? student : owner, action),
      /lưu trữ/,
    );
});

test('unpublished lesson hides its assignment; reminders use Vietnamese time', () => {
  const { db, owner, student } = fixture();
  const a = runAction(db, owner, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    lessonId: 'lesson-5',
    title: 'Bài nháp',
    instructions: '',
    dueAt: '2099-01-01T12:00:00.000Z',
  }) as Assignment;
  assert(!stateFor(db, student).assignments.some((x) => x.id === a.id));
  assert.throws(
    () => runAction(db, student, { action: 'saveSubmission', assignmentId: a.id, content: '' }),
    /chưa được công bố/,
  );
  a.lessonId = undefined;
  runAction(db, owner, { action: 'remindStudents', assignmentId: a.id, userId: student.id });
  const notification = db.notifications.find(
    (n) => n.userId === student.id && n.content.startsWith('Nhắc nộp bài'),
  )!;
  assert.match(notification.content, /19:00/);
});

test('a lesson with text can be published without fabricating a video', () => {
  const { db, owner, student } = fixture();
  const lesson = runAction(db, owner, {
    action: 'saveLesson',
    classId: 'dtq-2026',
    title: 'Bài học bằng chữ',
    order: 10,
    description: 'Nội dung bài học',
    published: true,
  }) as Lesson;
  assert.equal(lesson.videoUrl, '');
  assert(stateFor(db, student).lessons.some((entry) => entry.id === lesson.id));
  assert.throws(
    () =>
      runAction(db, owner, {
        action: 'saveLesson',
        classId: 'dtq-2026',
        title: 'Bài hoàn toàn trống',
        order: 11,
        published: true,
      }),
    /video/,
  );
});

test('temporary and legacy passwords are restricted until changed', () => {
  const { db, owner } = fixture();
  owner.isAdmin = true;
  const created = createManagedUser(db, owner.id, {
    name: 'Người học',
    email: 'new@example.invalid',
    role: 'STUDENT',
  });
  const user = db.users.find((u) => u.id === created.user.id)!;
  assert(needsPasswordChange(user));
  assert.throws(() => requireUser(db, user.id), /đổi mật khẩu/);
  assert.equal(stateFor(db, user).classes.length, 0);
  updateProfile(db, user.id, {
    currentPassword: created.temporaryPassword,
    newPassword: 'Another-Password-123',
    confirmPassword: 'Another-Password-123',
  });
  assert(!needsPasswordChange(user));
  assert(verifyPassword('Another-Password-123', user.passwordHash));
  user.passwordHash = hashPassword(DEFAULT_ACCOUNT_PASSWORD);
  assert(needsPasswordChange(user));
  assert.throws(() => requireUser(db, user.id), /đổi mật khẩu/);
  user.isAdmin = true;
  assert(
    needsPasswordChange(user),
    'administrators using the old shared password must also change it',
  );
  assert.throws(() => requireUser(db, user.id), /đổi mật khẩu/);
  assert.equal(requireUser(db, user.id, true).id, user.id);
});

test('admin transfers ownership and prevents demoting a teacher still assigned to a class', () => {
  const { db, owner, teacher } = fixture();
  owner.isAdmin = true;
  const c = runAction(db, owner, {
    action: 'createClass',
    title: 'Lớp chuyển quản lý',
  }) as Classroom;
  assert.throws(() =>
    updateManagedUser(db, owner.id, teacher.id, { role: 'STUDENT', isAdmin: true }),
  );
  transferClassOwner(db, owner.id, c.id, { teacherId: teacher.id, expectedTeacherId: owner.id });
  assert.equal(c.teacherId, teacher.id);
  assert.throws(
    () => updateManagedUser(db, owner.id, teacher.id, { role: 'STUDENT' }),
    /chuyển quyền/,
  );
});

test('storage cleanup only selects old, unreferenced objects in its own namespace', async () => {
  const { orphanedStorageKeys } = await import('../src/lib/storage-cleanup');
  const { db } = fixture();
  const old = new Date('2020-01-01T00:00:00.000Z');
  const recent = new Date('2099-01-01T00:00:00.000Z');
  const cutoff = Date.parse('2026-01-01T00:00:00.000Z');
  const id = '9d5f98ac-994b-4d67-809c-3452fbfe3200';
  const protectedId = '9d5f98ac-994b-4d67-809c-3452fbfe3201';
  const prefix = 'classes/class-check/user-check/';
  db.files.push({
    id: protectedId,
    ownerId: db.users[0].id,
    classId: 'dtq-2026',
    key: `${prefix}${protectedId}.pdf`,
    name: 'linked.pdf',
    size: 5,
    mimeType: 'application/pdf',
    verified: true,
    createdAt: old.toISOString(),
  });
  db.lessons[0].documents.push({
    id: protectedId,
    name: 'linked.pdf',
    size: 5,
    mimeType: 'application/pdf',
  });
  const objects = [
    { Key: `${prefix}${id}.pdf`, LastModified: old },
    { Key: `${prefix}${protectedId}.pdf`, LastModified: old },
    { Key: `elsewhere/${id}.pdf`, LastModified: old },
    { Key: `verified/${prefix}${id}.mp4`, LastModified: recent },
    { Key: `${prefix}${id}.docx` },
  ];
  assert.deepEqual(orphanedStorageKeys(db, objects, cutoff), [`${prefix}${id}.pdf`]);
});
