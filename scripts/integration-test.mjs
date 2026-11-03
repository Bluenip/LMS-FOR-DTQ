/**
 * Exercises the app through HTTP against a disposable PostgreSQL database with test accounts
 * and a configured private S3-compatible bucket. Never point this at production.
 * See docs/INTEGRATION.md for the full setup and environment variables.
 */
import assert from 'node:assert/strict';
const configured = process.env.INTEGRATION_BASE_URL;
if (!configured)
  throw new Error(
    'Set INTEGRATION_BASE_URL to a disposable test app URL; see docs/INTEGRATION.md.',
  );
const base = new URL(configured).origin;
let checks = 0;
const teacher = {},
  student = {};
async function request(path, { who, body, method = 'GET', raw = false, form } = {}) {
  const headers = { Origin: base };
  if (who?.cookie) headers.Cookie = who.cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: form || (body && JSON.stringify(body)),
    redirect: 'manual',
  });
  if (raw) return response;
  const data = await response.json();
  return { status: response.status, data, response };
}
async function login(who, email, password) {
  const r = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  who.cookie = r.response.headers.get('set-cookie').split(';')[0];
  checks++;
}
async function action(who, name, payload = {}) {
  if (
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
    ].includes(name) ||
    (name === 'saveLesson' && (payload.id || payload.lessonId))
  ) {
    const current = await state(who);
    if (name === 'updateClass' || name === 'deleteClass') {
      payload = {
        expectedRevision:
          current.classes.find((entry) => entry.id === payload.classId)?.revision || '',
        ...payload,
      };
    } else if (name === 'updateAssignment' || name === 'deleteAssignment') {
      payload = {
        expectedRevision:
          current.assignments.find((entry) => entry.id === payload.assignmentId)?.revision || '',
        ...payload,
      };
    } else if (
      name === 'saveSubmission' ||
      name === 'submitAssignment' ||
      name === 'withdrawSubmission'
    ) {
      const submission = current.submissions.find(
        (s) => s.assignmentId === payload.assignmentId && s.studentId === current.user.id,
      );
      payload = { expectedRevision: submission?.revision || '', ...payload };
    } else if (name === 'saveNote') {
      const note = current.notes.find(
        (n) => n.lessonId === payload.lessonId && n.userId === current.user.id,
      );
      payload = { expectedUpdatedAt: note?.updatedAt || null, ...payload };
    } else if (name === 'saveLesson' || name === 'deleteLesson') {
      const lesson = current.lessons.find((entry) => entry.id === (payload.id || payload.lessonId));
      payload = { expectedRevision: lesson?.revision || '', ...payload };
    } else if (name === 'removeEnrollment' || name === 'leaveClass') {
      const enrollment = current.enrollments.find((e) =>
        name === 'removeEnrollment'
          ? e.id === payload.enrollmentId
          : e.classId === payload.classId && e.userId === current.user.id,
      );
      payload = { expectedJoinedAt: enrollment?.joinedAt || '', ...payload };
    } else {
      const submission = current.submissions.find((entry) => entry.id === payload.submissionId);
      payload = {
        expectedGradeRevision: submission?.gradeRevision || '',
        expectedAttempt: submission?.attempt || 1,
        expectedSubmittedAt: submission?.submittedAt || null,
        ...payload,
      };
    }
  }
  const r = await request('/api/actions', {
    who,
    method: 'POST',
    body: { action: name, ...payload },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  checks++;
  return r.data.result;
}
async function state(who) {
  const r = await request('/api/state', { who });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.demo, false);
  checks++;
  return r.data;
}
const health = await request('/api/health');
assert.equal(health.status, 200);
assert.equal(health.data.status, 'ok');
checks++;
await login(
  teacher,
  process.env.INTEGRATION_TEACHER_EMAIL || 'teacher@detuquy.vn',
  process.env.INTEGRATION_TEACHER_PASSWORD || 'Demo@2026',
);
await login(
  student,
  process.env.INTEGRATION_STUDENT_EMAIL || 'student@detuquy.vn',
  process.env.INTEGRATION_STUDENT_PASSWORD || 'Demo@2026',
);
let st = await state(teacher);
const initialClassCount = st.classes.length;
assert.equal(st.user.role, 'TEACHER');
assert(st.users.length >= 1);
checks++;
const denied = await request('/api/actions', {
  who: student,
  method: 'POST',
  body: { action: 'createClass', title: 'Unauthorized' },
});
assert.equal(denied.status, 403);
checks++;
const c = await action(teacher, 'createClass', {
  title: 'PostgreSQL integration class',
  capacity: 2,
  autoApprove: true,
  contentAuthor: 'Integration content instructor',
});
await action(student, 'joinClass', { code: c.code });
await action(teacher, 'updateClass', {
  classId: c.id,
  description: 'Updated through real PostgreSQL transaction',
});
st = await state(student);
assert(st.classes.some((x) => x.id === c.id && x.description.startsWith('Updated')));
assert.equal(st.classes.find((x) => x.id === c.id).contentAuthor, 'Integration content instructor');
checks++;
const l = await action(teacher, 'saveLesson', {
  classId: c.id,
  title: 'Video integration lesson',
  chapter: 'Test',
  order: 1,
  published: true,
  videoUrl: 'https://youtu.be/abcdefghijk',
  videoType: 'YOUTUBE',
});
const unverifiedLesson = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'saveLesson',
    classId: c.id,
    title: 'Unverified uploaded lesson',
    order: 2,
    published: true,
    videoType: 'UPLOAD',
    videoUrl: 'https://example.invalid/unverified.mp4',
  },
});
assert.equal(unverifiedLesson.status, 400);
checks++;
await action(student, 'completeLesson', { lessonId: l.id });
await action(student, 'saveNote', { lessonId: l.id, content: 'Persisted note' });
const discussion = await action(student, 'comment', {
  lessonId: l.id,
  content: 'Persisted discussion',
});
const editedDiscussion = await action(student, 'updateComment', {
  discussionId: discussion.id,
  expectedContent: discussion.content,
  content: 'Edited discussion persisted in PostgreSQL',
});
st = await state(teacher);
assert.equal(st.discussions.find((d) => d.id === discussion.id).content, editedDiscussion.content);
assert.equal(editedDiscussion.createdAt, discussion.createdAt);
assert(st.discussions.find((d) => d.id === discussion.id).updatedAt);
checks++;
const deniedEdit = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'updateComment',
    discussionId: discussion.id,
    expectedContent: editedDiscussion.content,
    content: 'Unauthorized teacher edit',
  },
});
assert.equal(deniedEdit.status, 403);
checks++;
const staleEdit = await request('/api/actions', {
  who: student,
  method: 'POST',
  body: {
    action: 'updateComment',
    discussionId: discussion.id,
    expectedContent: discussion.content,
    content: 'Stale edit',
  },
});
assert.equal(staleEdit.status, 409);
checks++;
const staleDelete = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'deleteComment',
    discussionId: discussion.id,
    expectedContent: discussion.content,
  },
});
assert.equal(staleDelete.status, 409);
checks++;
const teacherReply = await action(teacher, 'comment', {
  lessonId: l.id,
  content: 'Teacher discussion reply',
});
const deniedDelete = await request('/api/actions', {
  who: student,
  method: 'POST',
  body: {
    action: 'deleteComment',
    discussionId: teacherReply.id,
    expectedContent: teacherReply.content,
  },
});
assert.equal(deniedDelete.status, 403);
checks++;
const temporaryDiscussion = await action(student, 'comment', {
  lessonId: l.id,
  content: 'Student deletes their own discussion',
});
await action(student, 'deleteComment', {
  discussionId: temporaryDiscussion.id,
  expectedContent: temporaryDiscussion.content,
});
st = await state(student);
assert(!st.discussions.some((d) => d.id === temporaryDiscussion.id));
assert(st.discussions.some((d) => d.id === discussion.id));
checks++;
await action(teacher, 'deleteComment', {
  discussionId: discussion.id,
  expectedContent: editedDiscussion.content,
});
st = await state(student);
assert(!st.discussions.some((d) => d.id === discussion.id));
assert(st.discussions.some((d) => d.id === teacherReply.id));
checks++;
const updatedReply = await action(teacher, 'updateComment', {
  discussionId: teacherReply.id,
  expectedContent: teacherReply.content,
  content: 'Teacher edited their own reply',
});
st = await state(student);
assert.equal(st.discussions.find((d) => d.id === teacherReply.id).content, updatedReply.content);
assert(st.discussions.find((d) => d.id === teacherReply.id).updatedAt);
checks++;
const a = await action(teacher, 'createAssignment', {
  classId: c.id,
  lessonId: l.id,
  title: 'Integration assignment',
  instructions: 'Write a note',
  minWords: 1,
  maxWords: 50,
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  allowResubmit: true,
  allowLate: true,
});
assert.deepEqual(await action(teacher, 'remindStudents', { assignmentId: a.id }), { count: 1 });
st = await state(student);
const reminder = st.notifications.find(
  (n) => n.assignmentId === a.id && n.content.startsWith('Nhắc nộp bài:'),
);
assert(reminder && !reminder.read);
checks++;
await action(student, 'markNotificationsRead', { ids: [reminder.id] });
st = await state(student);
assert.equal(st.notifications.find((n) => n.id === reminder.id).read, true);
checks++;
await action(teacher, 'updateAssignment', { assignmentId: a.id, minWords: 1, maxWords: 2 });
const overLimit = await request('/api/actions', {
  who: student,
  method: 'POST',
  body: {
    action: 'submitAssignment',
    assignmentId: a.id,
    content: 'Three separate words',
    pledge: true,
    expectedRevision: '',
  },
});
assert.equal(overLimit.status, 400);
checks++;
await action(teacher, 'updateAssignment', { assignmentId: a.id, maxWords: null });
st = await state(student);
assert.equal(st.assignments.find((x) => x.id === a.id).maxWords, null);
checks++;
const badForm = new FormData();
badForm.append('classId', c.id);
badForm.append('file', new Blob(['MZnotpdf'], { type: 'application/pdf' }), 'renamed.pdf');
const bad = await request('/api/uploads', { who: student, method: 'POST', form: badForm });
assert.equal(bad.status, 400, JSON.stringify(bad.data));
checks++;
const pdf = '%PDF-1.4\n% LMS integration fixture\n%%EOF';
const goodForm = new FormData();
goodForm.append('classId', c.id);
goodForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'homework.pdf');
const uploaded = await request('/api/uploads', { who: student, method: 'POST', form: goodForm });
assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
checks++;
const file = uploaded.data;
const redirect = await request(`/api/files/${file.id}`, { who: student, raw: true });
assert.equal(redirect.status, 302);
const bytes = await fetch(redirect.headers.get('location'));
assert.equal(await bytes.text(), pdf);
checks++;
const draft = await action(student, 'saveSubmission', {
  assignmentId: a.id,
  content: 'Private integration draft.',
  attachments: [file],
});
st = await state(teacher);
assert(!st.submissions.some((x) => x.id === draft.id), 'unsubmitted drafts must stay private');
checks++;
const privateDownload = await request(`/api/files/${file.id}`, { who: teacher, raw: true });
assert.equal(privateDownload.status, 403, 'a teacher must not download an unsubmitted attachment');
checks++;
const s = await action(student, 'submitAssignment', {
  assignmentId: a.id,
  content: 'An integration homework submission.',
  attachments: [file],
  pledge: true,
});
await action(teacher, 'gradeSubmission', {
  submissionId: s.id,
  rubric: { understanding: 35, application: 37, presentation: 18 },
  feedback: 'Private draft',
  returnGrade: false,
});
st = await state(student);
assert.equal(st.submissions.find((x) => x.id === s.id).score, undefined);
checks++;
const withdrawn = await action(student, 'withdrawSubmission', { assignmentId: a.id });
assert.equal(withdrawn.status, 'DRAFT');
for (const field of ['score', 'rubric', 'gradedAt']) assert(!(field in withdrawn));
assert.equal(withdrawn.feedback, '');
checks++;
st = await state(teacher);
assert(!st.submissions.some((x) => x.id === s.id), 'withdrawn drafts must stay private');
checks++;
const withdrawnDownload = await request(`/api/files/${file.id}`, { who: teacher, raw: true });
assert.equal(withdrawnDownload.status, 403);
checks++;
const resubmitted = await action(student, 'submitAssignment', {
  assignmentId: a.id,
  content: 'Updated integration homework.',
  attachments: [file],
  pledge: true,
});
assert.equal(resubmitted.attempt, 2);
assert(!('score' in resubmitted));
st = await state(teacher);
const freshSubmission = st.submissions.find((x) => x.id === s.id);
assert(freshSubmission);
assert(!('score' in freshSubmission));
assert(!('rubric' in freshSubmission));
assert.equal(freshSubmission.feedback, '');
checks++;
const staleGrade = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'gradeSubmission',
    submissionId: s.id,
    rubric: { understanding: 35, application: 37, presentation: 18 },
    returnGrade: true,
    expectedAttempt: s.attempt,
    expectedSubmittedAt: s.submittedAt,
    expectedGradeRevision: '',
  },
});
assert.equal(staleGrade.status, 409, 'a stale form must not grade a newer submission');
checks++;
const submittedDownload = await request(`/api/files/${file.id}`, { who: teacher, raw: true });
assert.equal(submittedDownload.status, 302);
checks++;
await action(teacher, 'gradeSubmission', {
  submissionId: s.id,
  rubric: { understanding: 35, application: 37, presentation: 18 },
  feedback: 'Returned grade',
  returnGrade: true,
});
st = await state(student);
assert.equal(st.submissions.find((x) => x.id === s.id).score, 90);
assert(st.notes.some((n) => n.content === 'Persisted note'));
checks++;
const video = Buffer.from([
  0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111,
  109,
]);
const p = await request('/api/uploads/presign', {
  who: teacher,
  method: 'POST',
  body: {
    classId: c.id,
    name: 'lesson.mp4',
    size: video.length,
    mimeType: 'video/mp4',
    kind: 'video',
  },
});
assert.equal(p.status, 200, JSON.stringify(p.data));
checks++;
const put = await fetch(p.data.uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: video,
});
assert.equal(put.status, 200, await put.text());
checks++;
const complete = await request('/api/uploads/complete', {
  who: teacher,
  method: 'POST',
  body: { fileId: p.data.fileId },
});
assert.equal(complete.status, 200, JSON.stringify(complete.data));
checks++;
await action(teacher, 'saveLesson', {
  id: l.id,
  classId: c.id,
  title: l.title,
  chapter: l.chapter,
  order: l.order,
  published: true,
  videoType: 'UPLOAD',
  videoFileId: complete.data.id,
  videoUrl: complete.data.url,
});
const vr = await request(`/api/files/${complete.data.id}`, { who: student, raw: true });
assert.equal(vr.status, 302);
const actual = Buffer.from(await (await fetch(vr.headers.get('location'))).arrayBuffer());
assert(actual.equals(video));
checks++;
const overwrite = await fetch(p.data.uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: Buffer.alloc(video.length, 0),
});
assert.equal(overwrite.status, 200);
const still = Buffer.from(await (await fetch(vr.headers.get('location'))).arrayBuffer());
assert(still.equals(video), 'final verified key must resist presigned overwrite');
checks++;
const changedTitle = 'Edited integration assignment';
await action(teacher, 'updateAssignment', {
  assignmentId: a.id,
  title: changedTitle,
  minWords: 150,
});
st = await state(student);
assert.equal(
  st.submissions.find((s) => s.assignmentId === a.id).score,
  90,
  'editing requirements preserves returned grades',
);
checks++;
const other = await action(teacher, 'createAssignment', {
  classId: c.id,
  title: 'Another assignment to preserve',
  instructions: 'Keep this assignment.',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
});
assert.equal(other.minWords, 150);
assert.equal(other.maxWords, null);
await action(teacher, 'remindStudents', { assignmentId: other.id });
const invalidDelete = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: { action: 'deleteAssignment', assignmentId: a.id, confirmTitle: 'Wrong assignment' },
});
assert.equal(invalidDelete.status, 409);
checks++;
await action(teacher, 'deleteAssignment', { assignmentId: a.id, confirmTitle: changedTitle });
st = await state(student);
assert(!st.assignments.some((x) => x.id === a.id));
assert(!st.submissions.some((x) => x.assignmentId === a.id));
assert(!st.notifications.some((x) => x.assignmentId === a.id));
assert(st.notifications.some((x) => x.assignmentId === other.id));
assert(st.assignments.some((x) => x.id === other.id));
assert(st.lessons.some((x) => x.id === l.id));
checks++;
await action(teacher, 'archiveClass', { classId: c.id, archived: true });
await action(teacher, 'archiveClass', { classId: c.id, archived: false });
// Regression coverage from the 03/11 report, on this disposable class only.
const hiddenLesson = await action(teacher, 'saveLesson', {
  classId: c.id,
  title: 'Hidden regression lesson',
  description: 'Draft text',
  order: 10,
});
const hiddenAssignment = await action(teacher, 'createAssignment', {
  classId: c.id,
  lessonId: hiddenLesson.id,
  title: 'Hidden regression assignment',
  instructions: 'Keep private until publication',
  minWords: 0,
  maxAttempts: 5,
  dueAt: new Date(Date.now() + 86400000).toISOString(),
});
assert(!(await state(student)).assignments.some((entry) => entry.id === hiddenAssignment.id));
checks++;
await action(teacher, 'saveLesson', { ...hiddenLesson, description: 'Edited draft' });
const staleLessonDelete = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'deleteLesson',
    lessonId: hiddenLesson.id,
    expectedRevision: hiddenLesson.revision,
  },
});
assert.equal(staleLessonDelete.status, 409);
checks++;
await action(teacher, 'deleteLesson', { lessonId: hiddenLesson.id });
st = await state(teacher);
assert.equal(st.assignments.find((entry) => entry.id === hiddenAssignment.id).published, false);
assert(!(await state(student)).assignments.some((entry) => entry.id === hiddenAssignment.id));
checks++;
await action(teacher, 'updateAssignment', { assignmentId: hiddenAssignment.id, published: true });
await action(teacher, 'updateAssignment', { assignmentId: hiddenAssignment.id, published: false });
await action(teacher, 'updateAssignment', { assignmentId: hiddenAssignment.id, published: true });
st = await state(student);
assert.equal(
  st.notifications.filter(
    (n) => n.assignmentId === hiddenAssignment.id && n.content.startsWith('Lớp có bài tập mới:'),
  ).length,
  1,
);
checks++;
const staleAssignmentDelete = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'deleteAssignment',
    assignmentId: hiddenAssignment.id,
    confirmTitle: hiddenAssignment.title,
    expectedRevision: hiddenAssignment.revision,
  },
});
assert.equal(staleAssignmentDelete.status, 409);
checks++;
const protectedSubmission = await action(student, 'submitAssignment', {
  assignmentId: hiddenAssignment.id,
  content: 'Keep submitted history',
  pledge: true,
});
await action(teacher, 'gradeSubmission', {
  submissionId: protectedSubmission.id,
  rubric: { understanding: 30, application: 30, presentation: 10 },
  feedback: 'Concurrent draft grade',
});
const staleWithdrawal = await request('/api/actions', {
  who: student,
  method: 'POST',
  body: {
    action: 'withdrawSubmission',
    assignmentId: hiddenAssignment.id,
    expectedRevision: protectedSubmission.revision,
  },
});
assert.equal(staleWithdrawal.status, 409);
assert.equal(
  (await state(teacher)).submissions.find((entry) => entry.id === protectedSubmission.id).score,
  70,
);
checks++;
const secondHiddenLesson = await action(teacher, 'saveLesson', {
  classId: c.id,
  title: 'Second hidden lesson',
  description: 'Draft',
  order: 11,
});
await action(teacher, 'updateAssignment', {
  assignmentId: hiddenAssignment.id,
  lessonId: secondHiddenLesson.id,
});
st = await state(student);
assert.equal(st.assignments.find((entry) => entry.id === hiddenAssignment.id).published, false);
assert.equal(
  st.submissions.find((entry) => entry.id === protectedSubmission.id).content,
  'Keep submitted history',
);
const hiddenReminder = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: { action: 'remindStudents', assignmentId: hiddenAssignment.id },
});
assert.equal(hiddenReminder.status, 409);
checks++;
await action(teacher, 'gradeSubmission', {
  submissionId: protectedSubmission.id,
  rubric: { understanding: 30, application: 30, presentation: 10 },
  returnGrade: true,
});
assert.equal(
  (await state(student)).submissions.find((entry) => entry.id === protectedSubmission.id).score,
  70,
);
checks++;
const enrollmentBefore = (await state(teacher)).enrollments.find(
  (entry) => entry.classId === c.id && entry.userId === protectedSubmission.studentId,
);
await action(student, 'leaveClass', { classId: c.id });
await action(student, 'joinClass', { code: c.code });
const staleRemoval = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: {
    action: 'removeEnrollment',
    enrollmentId: enrollmentBefore.id,
    expectedJoinedAt: enrollmentBefore.joinedAt,
  },
});
assert.equal(staleRemoval.status, 409);
checks++;
const staleClassDelete = await request('/api/actions', {
  who: teacher,
  method: 'POST',
  body: { action: 'deleteClass', classId: c.id, code: c.code, expectedRevision: c.revision },
});
assert.equal(staleClassDelete.status, 409);
checks++;
const repeatedComplete = await request('/api/uploads/complete', {
  who: teacher,
  method: 'POST',
  body: { fileId: p.data.fileId },
});
assert.equal(repeatedComplete.status, 200);
assert.equal(repeatedComplete.data.id, complete.data.id);
checks++;
const loggedOut = await request('/api/auth/logout', { who: student, method: 'POST', body: {} });
assert.equal(loggedOut.status, 200);
const replay = await request('/api/state', { who: student });
assert.equal(replay.status, 401, 'a copied cookie must be invalid after logout');
checks++;
await action(teacher, 'deleteClass', { classId: c.id, code: c.code });
st = await state(teacher);
assert(!st.classes.some((x) => x.id === c.id));
assert.equal(st.classes.length, initialClassCount);
assert(!st.lessons.some((x) => x.id === l.id));
checks++;
console.log(
  JSON.stringify({
    checks,
    result: 'PASS',
    database: 'configured PostgreSQL server',
    objectStorage: 'configured S3-compatible server',
  }),
);
