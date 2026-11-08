import test from 'node:test';
import assert from 'node:assert/strict';
import { accessDriveDocument, runAction, stateFor } from '../src/lib/server/actions';
import { rankingFor } from '../src/lib/server/ranking';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment } from '../src/lib/types';

function fixture() {
  const db = structuredClone(seedData());
  const teacher = db.users[0];
  const approved = db.enrollments.filter(
    (e) => e.classId === 'dtq-2026' && e.status === 'APPROVED',
  );
  const [leaderEnrollment, mateEnrollment] = approved;
  // Put two learners in group 1 and a third in group 2.
  leaderEnrollment.group = 1;
  mateEnrollment.group = 1;
  const other = approved.find((e) => e !== leaderEnrollment && e !== mateEnrollment)!;
  other.group = 2;
  const user = (id: string) => db.users.find((u) => u.id === id)!;
  const assignment = runAction(db, teacher, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    title: 'Chia sẻ tâm đắc',
    instructions: 'Viết cảm nhận của bạn.',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  }) as Assignment;
  const submit = (e: typeof leaderEnrollment, attachmentId?: string) => {
    const s = runAction(db, user(e.userId), {
      action: 'submitAssignment',
      assignmentId: assignment.id,
      content: Array(160).fill('hiếu').join(' '),
      pledge: true,
      attachments: [],
    }) as { id: string };
    return db.submissions.find((x) => x.id === s.id)!;
  };
  return { db, teacher, user, leaderEnrollment, mateEnrollment, other, assignment, submit };
}

test('only a teacher of the class appoints a group leader, one per group', () => {
  const { db, teacher, user, leaderEnrollment, mateEnrollment } = fixture();
  assert.throws(() =>
    runAction(db, user(leaderEnrollment.userId), {
      action: 'setGroupLeader',
      enrollmentId: leaderEnrollment.id,
      leader: true,
    }),
  );
  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: leaderEnrollment.id,
    leader: true,
  });
  assert.equal(leaderEnrollment.leader, true);
  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: mateEnrollment.id,
    leader: true,
  });
  assert.equal(mateEnrollment.leader, true);
  assert.equal(leaderEnrollment.leader, false, 'a group has a single leader');
  runAction(db, teacher, {
    action: 'setEnrollmentGroup',
    enrollmentId: mateEnrollment.id,
    group: 3,
  });
  assert.equal(mateEnrollment.leader, false, 'moving to another group ends the leadership');
});

test('a leader sees the submitted work of their own group only, without grades', () => {
  const { db, teacher, user, leaderEnrollment, mateEnrollment, other, submit } = fixture();
  const mateWork = submit(mateEnrollment);
  const otherWork = submit(other);
  runAction(db, teacher, {
    action: 'gradeSubmission',
    submissionId: mateWork.id,
    rubric: { understanding: 3, application: 3, presentation: 3 },
    feedback: 'Tốt',
    returnGrade: true,
    expectedAttempt: mateWork.attempt,
    expectedSubmittedAt: mateWork.submittedAt,
    expectedGradeRevision: mateWork.gradeRevision || '',
  });
  const before = stateFor(db, user(leaderEnrollment.userId));
  assert.equal(
    before.submissions.some((s) => s.id === mateWork.id),
    false,
    'not a leader yet',
  );

  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: leaderEnrollment.id,
    leader: true,
  });
  const state = stateFor(db, user(leaderEnrollment.userId));
  const seen = state.submissions.find((s) => s.id === mateWork.id);
  assert.ok(seen, 'sees a groupmate');
  assert.equal(seen!.score, undefined, 'never a groupmate grade');
  assert.equal(seen!.feedback, '');
  assert.equal(
    state.submissions.some((s) => s.id === otherWork.id),
    false,
    'not another group',
  );
});

test('a leader reads a groupmate attachment but not another group', () => {
  const { db, teacher, user, leaderEnrollment, mateEnrollment, other, submit } = fixture();
  const job = (owner: string, id: string) =>
    db.driveUploads.push({
      id,
      ownerId: owner,
      classId: 'dtq-2026',
      kind: 'document',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 1,
      title: '',
      description: '',
      status: 'COMPLETED',
      bytesUploaded: 1,
      driveFileId: `drive-${id}-0123456789`,
      shared: false,
      createdAt: '',
      updatedAt: '',
    });
  job(mateEnrollment.userId, 'mate-file');
  job(other.userId, 'other-file');
  submit(mateEnrollment).attachments = [
    { id: 'mate-file', name: 'a.pdf', size: 1, mimeType: 'application/pdf' },
  ];
  submit(other).attachments = [
    { id: 'other-file', name: 'a.pdf', size: 1, mimeType: 'application/pdf' },
  ];
  const leader = user(leaderEnrollment.userId);
  assert.throws(() => accessDriveDocument(db, leader, 'mate-file'), /quyền/);
  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: leaderEnrollment.id,
    leader: true,
  });
  assert.equal(accessDriveDocument(db, leader, 'mate-file').id, 'mate-file');
  assert.throws(() => accessDriveDocument(db, leader, 'other-file'), /quyền/);
});

test('practice tick sheets: the group leader ticks members; a teacher only where there is no leader', () => {
  const { db, teacher, user, leaderEnrollment, mateEnrollment, other } = fixture();
  const lessonId = db.lessons.find((l) => l.classId === 'dtq-2026' && l.published)!.id;
  const save = (who: unknown, studentId: string, items: string[]) =>
    runAction(db, who as typeof teacher, {
      action: 'savePracticeCheck',
      lessonId,
      studentId,
      items,
      note: 'Tốt',
    }) as { items: string[]; checkedBy: string };

  // Nobody leads group 1 yet: the teacher fills in for them.
  const first = save(teacher, mateEnrollment.userId, ['study-listen', 'bogus-item']);
  assert.deepEqual(first.items, ['study-listen'], 'unknown items are dropped');

  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: leaderEnrollment.id,
    leader: true,
  });
  const leader = user(leaderEnrollment.userId);
  const ticked = save(leader, mateEnrollment.userId, ['study-listen', 'daily-write']);
  assert.equal(ticked.checkedBy, leader.id);
  assert.equal(db.practiceChecks.length, 1, 'one sheet per member and lesson');

  assert.throws(() => save(teacher, mateEnrollment.userId, []), /trưởng nhóm/, 'leader exists now');
  assert.throws(() => save(leader, other.userId, ['study-listen']), /trưởng nhóm/, 'other group');
  assert.throws(
    () => save(user(mateEnrollment.userId), leader.id, ['study-listen']),
    /trưởng nhóm/,
  );
  // Nobody ticks the leader, so a teacher does.
  save(teacher, leader.id, ['study-listen']);

  const seen = stateFor(db, leader)
    .practiceChecks.map((p) => p.studentId)
    .sort();
  assert.deepEqual(seen, [leader.id, mateEnrollment.userId].sort());
  const mateView = stateFor(db, user(mateEnrollment.userId)).practiceChecks;
  assert.deepEqual(
    mateView.map((p) => p.studentId),
    [mateEnrollment.userId],
    'members see only their own',
  );
  assert.equal(stateFor(db, teacher).practiceChecks.length, 2);
});

test('practice ranking: only teachers and administrators, ties share a place, per lesson and overall', () => {
  const { db, teacher, user, leaderEnrollment, mateEnrollment, other } = fixture();
  const lessons = db.lessons.filter((l) => l.classId === 'dtq-2026' && l.published);
  const tick = (studentId: string, lessonId: string, items: string[]) =>
    runAction(db, teacher, { action: 'savePracticeCheck', lessonId, studentId, items, note: '' });
  tick(mateEnrollment.userId, lessons[0].id, ['study-listen', 'daily-write', 'daily-tidy']);
  tick(other.userId, lessons[0].id, ['study-listen']);
  tick(leaderEnrollment.userId, lessons[0].id, ['study-listen']);
  if (lessons[1]) tick(other.userId, lessons[1].id, ['study-listen', 'study-reflect']);

  db.progress = []; // equal 'studied' counts, so only the practice score decides
  const ranking = rankingFor(db, teacher, 'dtq-2026');
  const first = ranking.byLesson[lessons[0].id];
  assert.equal(first[0].userId, mateEnrollment.userId);
  assert.equal(first[0].rank, 1);
  assert.equal(first[0].done, 3);
  assert.equal(first[1].rank, 2);
  assert.equal(first[2].rank, 2, 'equal scores share a place');
  assert.equal(first[2].done, 1);
  assert.equal(ranking.overall[0].rank, 1);
  assert.equal(
    ranking.overall.reduce((sum, r) => sum + r.done, 0),
    first.reduce((sum, r) => sum + r.done, 0) + (lessons[1] ? 2 : 0),
  );

  const admin = { ...user(leaderEnrollment.userId), isAdmin: true };
  assert.ok(rankingFor(db, admin, 'dtq-2026').overall.length > 0, 'an administrator may read it');
  assert.throws(() => rankingFor(db, user(mateEnrollment.userId), 'dtq-2026'), /quản trị viên/);
  runAction(db, teacher, {
    action: 'setGroupLeader',
    enrollmentId: leaderEnrollment.id,
    leader: true,
  });
  assert.throws(() => rankingFor(db, user(leaderEnrollment.userId), 'dtq-2026'), /quản trị viên/);
});
