import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction, stateFor } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import type { Discussion } from '../src/lib/types';

const initial = seedData();
function fixture() {
  const db = structuredClone(initial);
  const teacher = db.users[0],
    student = db.users[1],
    peer = db.users[2];
  const comment = runAction(db, student, {
    action: 'comment',
    lessonId: 'lesson-1',
    content: 'Nội dung ban đầu',
  }) as Discussion;
  const payload = { discussionId: comment.id, expectedContent: comment.content };
  return { db, teacher, student, peer, comment, payload };
}

test('authors edit their own legacy discussion without changing authorship, lesson or original date', () => {
  const { db, student, comment, payload } = fixture();
  const original = { ...comment };
  const edited = runAction(db, student, {
    action: 'updateComment',
    ...payload,
    content: '  Nội dung đã sửa  ',
    userId: 'teacher-1',
    lessonId: 'lesson-2',
  }) as Discussion;
  assert.equal(edited.content, 'Nội dung đã sửa');
  assert(edited.updatedAt);
  assert.equal(edited.id, original.id);
  assert.equal(edited.userId, original.userId);
  assert.equal(edited.lessonId, original.lessonId);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(
    stateFor(db, student).discussions.find((d) => d.id === comment.id)?.updatedAt,
    edited.updatedAt,
  );
});

test('authors can delete their discussion while other discussions remain intact', () => {
  const { db, student, peer, payload } = fixture();
  const other = runAction(db, peer, {
    action: 'comment',
    lessonId: 'lesson-1',
    content: 'Thảo luận cần giữ',
  }) as Discussion;
  runAction(db, student, { action: 'deleteComment', ...payload });
  assert(!db.discussions.some((d) => d.id === payload.discussionId));
  assert(db.discussions.some((d) => d.id === other.id));
});

test('class teachers delete student discussions but cannot rewrite their words', () => {
  const { db, teacher, comment, payload } = fixture();
  assert.throws(
    () =>
      runAction(db, teacher, { action: 'updateComment', ...payload, content: 'Giáo viên sửa hộ' }),
    /chỉ có thể sửa/,
  );
  assert.equal(comment.content, payload.expectedContent);
  runAction(db, teacher, { action: 'deleteComment', ...payload });
  assert(!db.discussions.some((d) => d.id === comment.id));
});

test('teachers also edit and delete their own discussions', () => {
  const { db, teacher } = fixture();
  const d = runAction(db, teacher, {
    action: 'comment',
    lessonId: 'lesson-1',
    content: 'Lời nhắn của giáo viên',
  }) as Discussion;
  runAction(db, teacher, {
    action: 'updateComment',
    discussionId: d.id,
    expectedContent: d.content,
    content: 'Lời nhắn đã sửa',
  });
  runAction(db, teacher, {
    action: 'deleteComment',
    discussionId: d.id,
    expectedContent: d.content,
  });
  assert(!db.discussions.some((x) => x.id === d.id));
});

test('other students cannot edit or delete a peer discussion', () => {
  const { db, peer, payload } = fixture();
  for (const action of ['updateComment', 'deleteComment'])
    assert.throws(
      () => runAction(db, peer, { action, ...payload, content: 'Không được ghi' }),
      /403|chỉ có thể sửa|giáo viên phụ trách/,
    );
  assert(db.discussions.some((d) => d.id === payload.discussionId));
});

test('a teacher or administrator enrolled in a different teacher class gets no moderation rights', () => {
  const { db, teacher, payload } = fixture();
  const outsider = { ...teacher, id: 'different-teacher', isAdmin: true };
  db.users.push(outsider);
  db.enrollments.push({
    id: 'guest-teacher',
    classId: 'dtq-2026',
    userId: outsider.id,
    status: 'APPROVED',
    group: 1,
    joinedAt: new Date().toISOString(),
  });
  assert.throws(
    () => runAction(db, outsider, { action: 'deleteComment', ...payload }),
    /giáo viên phụ trách/,
  );
  assert.throws(
    () =>
      runAction(db, outsider, { action: 'updateComment', ...payload, content: 'Không được sửa' }),
    /chỉ có thể sửa/,
  );
});

test('revoked membership and unpublished lessons block author mutations', () => {
  const { db, student, teacher, payload } = fixture();
  db.lessons.find((l) => l.id === 'lesson-1')!.published = false;
  assert.throws(
    () =>
      runAction(db, student, { action: 'updateComment', ...payload, content: 'Không được sửa' }),
    /chưa xuất bản/,
  );
  db.lessons.find((l) => l.id === 'lesson-1')!.published = true;
  db.enrollments = db.enrollments.filter((e) => e.userId !== student.id);
  assert.throws(
    () => runAction(db, student, { action: 'deleteComment', ...payload }),
    /chưa được duyệt/,
  );
  runAction(db, teacher, { action: 'deleteComment', ...payload });
  assert.throws(
    () => runAction(db, teacher, { action: 'deleteComment', ...payload }),
    /không còn tồn tại/,
  );
});

test('stale edit and delete requests never overwrite or delete a newer revision', () => {
  const { db, student, teacher, comment, payload } = fixture();
  runAction(db, student, { action: 'updateComment', ...payload, content: 'Phiên bản mới cần giữ' });
  assert.throws(
    () => runAction(db, student, { action: 'updateComment', ...payload, content: 'Cửa sổ cũ' }),
    /đã được thay đổi/,
  );
  assert.throws(
    () => runAction(db, teacher, { action: 'deleteComment', ...payload }),
    /đã được thay đổi/,
  );
  assert.equal(comment.content, 'Phiên bản mới cần giữ');
  assert(db.discussions.some((d) => d.id === comment.id));
});

test('empty and oversized edits are rejected and unchanged content is not marked edited', () => {
  const { db, student, comment, payload } = fixture();
  for (const content of ['   ', 'x'.repeat(5001)])
    assert.throws(() => runAction(db, student, { action: 'updateComment', ...payload, content }));
  assert.equal(comment.updatedAt, undefined);
  runAction(db, student, { action: 'updateComment', ...payload, content: comment.content });
  assert.equal(comment.updatedAt, undefined);
});
