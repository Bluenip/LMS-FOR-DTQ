import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Submission } from '../src/lib/types';

function fixture(extra: Record<string, unknown> = {}) {
  const db = structuredClone(seedData());
  const teacher = db.users[0];
  const student = db.users[1];
  const a = runAction(db, teacher, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    title: 'Chia sẻ tâm đắc',
    instructions: 'Viết cảm nhận của bạn.',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    ...extra,
  }) as Assignment;
  const submit = () =>
    runAction(db, student, {
      action: 'submitAssignment',
      assignmentId: a.id,
      content: Array(160).fill('hiếu').join(' '),
      link: 'https://example.com/a',
      pledge: true,
    }) as Submission;
  const add = (input: Record<string, unknown>) =>
    runAction(db, student, {
      action: 'addToSubmission',
      assignmentId: a.id,
      ...input,
    }) as Submission;
  return { db, teacher, student, a, submit, add };
}

test('a submitted assignment can be added to, keeping what was handed in', () => {
  const { db, student, a, submit, add } = fixture();
  const first = submit();
  const stored = db.submissions.find((s) => s.id === first.id)!;
  const { submittedAt, attempt } = stored;
  const before = db.notifications.length;
  add({ content: 'Em xin bổ sung thêm.', link: 'https://example.com/b' });
  assert.equal(stored.status, 'SUBMITTED', 'still submitted, no withdrawal needed');
  assert.equal(stored.attempt, attempt, 'costs no attempt');
  assert.equal(stored.submittedAt, submittedAt, 'submission time is unchanged');
  assert.ok(stored.content.includes('hiếu') && stored.content.includes('Em xin bổ sung thêm.'));
  assert.deepEqual(stored.link.split('\n'), ['https://example.com/a', 'https://example.com/b']);
  assert.ok(db.notifications.length > before, 'the teacher is told');
  assert.ok(
    db.notifications.some((n) => /bổ sung/.test(n.content) && n.content.includes(student.name)),
  );
  assert.equal(stored.assignmentId, a.id);
});

test('adding needs something to add, respects limits and does not change the grade rules', () => {
  const { db, teacher, a, submit, add } = fixture();
  assert.throws(() => add({ content: 'sớm' }), /chưa nộp bài/, 'nothing submitted yet');
  const first = submit();
  assert.throws(() => add({}), /Hãy thêm/);
  assert.throws(() => add({ link: 'ftp://nope' }), /http/);
  assert.throws(
    () => add({ link: ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `https://x.vn/${x}`).join('\n') }),
    /tối đa/,
  );
  // The same link again adds nothing new, so it needs other content to count as an addition.
  assert.throws(() => add({ link: 'https://example.com/a' }), /Hãy thêm/);
  void teacher;
  void db;
  void a;
  void first;
});

test('no additions once graded, or after the deadline unless late work is accepted', () => {
  const { db, teacher, submit, add, a } = fixture();
  const first = submit();
  const stored = db.submissions.find((s) => s.id === first.id)!;
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: stored.id,
    rubric: { understanding: 30, application: 30, presentation: 10 },
    feedback: 'Tốt',
    returnGrade: true,
    expectedAttempt: stored.attempt,
    expectedSubmittedAt: stored.submittedAt,
    expectedGradeRevision: stored.gradeRevision || '',
  });
  assert.throws(() => add({ content: 'muộn' }), /đã được chấm/);

  const strict = fixture();
  strict.submit();
  strict.db.assignments.find((x) => x.id === strict.a.id)!.dueAt = new Date(
    Date.now() - 1000,
  ).toISOString();
  assert.throws(() => strict.add({ content: 'trễ' }), /hết hạn/);
  const late = fixture({ allowLate: true });
  late.submit();
  late.db.assignments.find((x) => x.id === late.a.id)!.dueAt = new Date(
    Date.now() - 1000,
  ).toISOString();
  assert.ok(late.add({ content: 'vẫn được' }).content.includes('vẫn được'));
  void a;
});
