import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteManagedUser } from '../src/lib/server/admin';
import { runAction } from '../src/lib/server/actions';
import { hashPassword } from '../src/lib/server/auth';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Database, DriveUpload, StoredUser } from '../src/lib/types';

const status = (code: number) => (error: unknown) =>
  !!error && typeof error === 'object' && 'status' in error && error.status === code;

function upload(over: Partial<DriveUpload>): DriveUpload {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    ownerId: 'x',
    classId: 'x',
    kind: 'document',
    name: 'f.pdf',
    mimeType: 'application/pdf',
    size: 5,
    title: 'f',
    description: '',
    status: 'COMPLETED',
    bytesUploaded: 5,
    driveFileId: `drive-${Math.random().toString(36).slice(2)}-0123456789`,
    shared: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

/** A class owned by teacher-1, co-taught by a second teacher, with student-1 enrolled. */
function fixture() {
  const db: Database = seedData();
  const admin: StoredUser = {
    id: 'admin-test',
    name: 'Quản trị viên',
    email: 'admin@example.com',
    role: 'TEACHER',
    passwordHash: hashPassword('Admin-2026'),
    emailVerified: true,
    isAdmin: true,
    isDemo: false,
    sessionVersion: 0,
  };
  const coTeacher: StoredUser = {
    ...admin,
    id: 'co-teacher',
    name: 'Giáo viên phụ',
    email: 'co@example.com',
    isAdmin: false,
  };
  db.users.push(admin, coTeacher);
  const owner = db.users.find((u) => u.id === 'teacher-1')!;
  const student = db.users.find((u) => u.id === 'student-1')!;
  const classroom = runAction(db, owner, {
    action: 'createClass',
    title: 'Lớp xóa tài khoản',
    autoApprove: true,
  }) as { id: string; code: string };
  db.classes.find((c) => c.id === classroom.id)!.teacherIds = [coTeacher.id];
  runAction(db, student, { action: 'joinClass', code: classroom.code });
  const assignment = runAction(db, owner, {
    action: 'createAssignment',
    classId: classroom.id,
    title: 'Bài',
    instructions: '',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    minWords: 0,
  }) as Assignment;
  return { db, admin, owner, coTeacher, student, classId: classroom.id, assignment };
}

test('only an administrator deletes, and never itself, an administrator or a class owner', () => {
  const { db, admin, owner, student } = fixture();
  assert.throws(
    () => deleteManagedUser(db, 'teacher-1', student.id, { confirmEmail: student.email }),
    status(403),
  );
  assert.throws(
    () => deleteManagedUser(db, admin.id, admin.id, { confirmEmail: admin.email }),
    status(403),
  );
  const otherAdmin = { ...admin, id: 'admin-2', email: 'admin2@example.com' };
  db.users.push(otherAdmin);
  assert.throws(
    () => deleteManagedUser(db, admin.id, otherAdmin.id, { confirmEmail: otherAdmin.email }),
    /thu hồi quyền quản trị/,
  );
  assert.throws(
    () => deleteManagedUser(db, admin.id, owner.id, { confirmEmail: owner.email }),
    /chuyển quyền quản lý lớp/,
  );
  assert.throws(
    () => deleteManagedUser(db, admin.id, student.id, { confirmEmail: 'sai@example.com' }),
    status(409),
  );
  assert.throws(
    () => deleteManagedUser(db, admin.id, 'missing', { confirmEmail: 'x' }),
    status(404),
  );
  assert.ok(
    db.users.some((u) => u.id === student.id),
    'nothing was deleted',
  );
});

test('deleting a learner removes their records and queues their Drive files', () => {
  const { db, admin, student, classId, assignment } = fixture();
  const file = upload({ ownerId: student.id, classId });
  db.driveUploads.push(file);
  runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: assignment.id,
    content: 'bài làm',
    attachments: [{ id: file.id, name: 'x', size: 1, mimeType: 'x' }],
    pledge: true,
  });
  db.notes.push({
    id: 'n1',
    userId: student.id,
    lessonId: 'l',
    content: 'ghi chép',
    updatedAt: new Date().toISOString(),
  });
  const result = deleteManagedUser(db, admin.id, student.id, {
    confirmEmail: student.email.toUpperCase(),
  });
  assert.equal(result.deleted.submissions, 1);
  assert.ok(!db.users.some((u) => u.id === student.id));
  for (const rows of [db.enrollments, db.progress, db.notes, db.discussions, db.notifications])
    assert.ok(!rows.some((row) => row.userId === student.id));
  assert.ok(!db.submissions.some((s) => s.studentId === student.id));
  assert.ok(!db.driveUploads.some((u) => u.id === file.id));
  assert.ok(
    db.driveTrash.some((t) => t.id === file.driveFileId),
    'Drive file queued for removal',
  );
});

test('deleting a co-teacher keeps their lesson material for the class owner', () => {
  const { db, admin, owner, coTeacher, classId } = fixture();
  const material = upload({ ownerId: coTeacher.id, classId });
  const video = upload({
    ownerId: coTeacher.id,
    classId,
    kind: 'video',
    mimeType: 'video/mp4',
    shared: true,
  });
  const spare = upload({ ownerId: coTeacher.id, classId });
  db.driveUploads.push(material, video, spare);
  runAction(db, coTeacher, {
    action: 'saveLesson',
    classId,
    title: 'Bài giảng',
    order: 1,
    description: '',
    videoType: 'DRIVE',
    driveFileId: video.driveFileId,
    documents: [{ id: material.id, name: 'x', size: 1, mimeType: 'x' }],
  });
  db.driveConnections.push({
    id: 'shared',
    connectedById: coTeacher.id,
    email: 'drive@example.com',
    encryptedRefreshToken: 'x',
    scope: 'drive.file',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  deleteManagedUser(db, admin.id, coTeacher.id, { confirmEmail: coTeacher.email });
  const classroom = db.classes.find((c) => c.id === classId)!;
  assert.deepEqual(classroom.teacherIds, [], 'co-teaching assignment removed');
  for (const kept of [material, video])
    assert.equal(db.driveUploads.find((u) => u.id === kept.id)?.ownerId, owner.id);
  assert.ok(!db.driveUploads.some((u) => u.id === spare.id), 'unused file removed');
  assert.ok(db.driveTrash.some((t) => t.id === spare.driveFileId));
  assert.ok(!db.driveTrash.some((t) => t.id === video.driveFileId), 'lesson video kept');
  assert.equal(db.driveConnections[0].connectedById, admin.id, 'Drive connection survives');
});
