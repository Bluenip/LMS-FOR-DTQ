import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../src/lib/server/actions';
import { encryptSecret } from '../src/lib/server/google-drive';
import { autoPublic, initUpload } from '../src/lib/server/drive-service';
import { withDatabase } from '../src/lib/server/repository';
import { seedData } from '../src/lib/server/seed-data';
import type { Assignment, Database, DriveUpload } from '../src/lib/types';

process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-value';
process.env.DRIVE_ENCRYPTION_KEY = 'test-drive-encryption-key-0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
process.env.LMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'drive-policy-'));
delete process.env.DATABASE_URL;

const MiB = 1024 * 1024;
function job(over: Partial<DriveUpload>): DriveUpload {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    ownerId: 'teacher-1',
    classId: 'x',
    kind: 'video',
    name: 'v.mp4',
    mimeType: 'video/mp4',
    size: 1,
    title: 'v',
    description: '',
    status: 'COMPLETED',
    bytesUploaded: 1,
    driveFileId: `drive-${Math.random().toString(36).slice(2)}-0123456789`,
    shared: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}
function classroomWithStudent(db: Database) {
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const student = db.users.find((u) => u.id === 'student-1')!;
  const classroom = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp chính sách',
    autoApprove: true,
  }) as { id: string; code: string };
  runAction(db, student, { action: 'joinClass', code: classroom.code });
  return { teacher, student, classId: classroom.id };
}

test('only a teacher lesson video is shared by link; learner files and materials stay private', () => {
  const db = seedData();
  const { classId } = classroomWithStudent(db);
  assert.equal(autoPublic(db, job({ classId })), true, 'teacher lesson video');
  assert.equal(
    autoPublic(db, job({ classId, kind: 'document', mimeType: 'application/pdf' })),
    false,
    'teacher material',
  );
  assert.equal(autoPublic(db, job({ classId, ownerId: 'student-1' })), false, 'learner video');
  assert.equal(
    autoPublic(db, job({ classId, ownerId: 'student-1', kind: 'document' })),
    false,
    'learner file',
  );
});

test('a lesson cannot use a Drive video whose link sharing was withdrawn', () => {
  const db = seedData();
  const { teacher, classId } = classroomWithStudent(db);
  const hidden = job({ classId, shared: false });
  const shared = job({ classId });
  db.driveUploads.push(hidden, shared);
  const save = (driveFileId: string) =>
    runAction(db, teacher, {
      action: 'saveLesson',
      classId,
      title: 'Bài giảng Drive',
      order: 1,
      description: '',
      videoType: 'DRIVE',
      driveFileId,
    });
  assert.throws(() => save(hidden.driveFileId!), /chưa bật chia sẻ/);
  assert.equal(
    (save(shared.driveFileId!) as { driveFileId: string }).driveFileId,
    shared.driveFileId,
  );
});

test('Drive uploads respect the account and class storage quotas', async (t) => {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.LMS_UPLOAD_USER_QUOTA_BYTES = String(30 * MiB);
  process.env.LMS_UPLOAD_CLASS_QUOTA_BYTES = String(50 * MiB);
  // Any call to Google means the quota check let the upload through.
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => {
    throw new Error('Google must not be called when the quota is exceeded');
  }) as typeof fetch;

  const classId = await withDatabase((db) => {
    db.driveConnections.push({
      id: 'shared',
      connectedById: 'teacher-1',
      email: 'drive@example.com',
      encryptedRefreshToken: encryptSecret('refresh'),
      scope: 'https://www.googleapis.com/auth/drive.file',
      status: 'ACTIVE',
      folderId: 'folder',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const { classId } = classroomWithStudent(db);
    db.driveUploads.push(
      job({ classId, ownerId: 'student-1', kind: 'document', size: 20 * MiB }),
      // Failed and cancelled uploads hold no space.
      job({ classId, ownerId: 'student-1', status: 'FAILED', size: 25 * MiB }),
      job({ classId, ownerId: 'student-1', status: 'CANCELLED', size: 25 * MiB }),
      job({ classId, ownerId: 'teacher-1', size: 25 * MiB }),
    );
    return classId;
  }, true);
  const pdf = (size: number) => ({
    classId,
    name: 'bai.pdf',
    size,
    mimeType: 'application/pdf',
    kind: 'document',
  });
  // 20 MiB used + 11 MiB > 30 MiB account quota.
  await assert.rejects(initUpload('student-1', 'http://localhost:3000', pdf(11 * MiB)), {
    status: 413,
    message: /hạn mức dung lượng tài khoản/,
  });
  // 45 MiB used in the class + 6 MiB > 50 MiB class quota, although the account has room.
  await assert.rejects(initUpload('student-1', 'http://localhost:3000', pdf(6 * MiB)), {
    status: 413,
    message: /hạn mức dung lượng lớp học/,
  });
  // Within both limits the upload proceeds to Google (the stub fails it, proving it got there).
  await assert.rejects(
    initUpload('student-1', 'http://localhost:3000', pdf(4 * MiB)),
    /Google must not be called/,
  );
});

test('due dates are stored as millisecond ISO strings so TIMESTAMPTZ reads them back unchanged', () => {
  const db = seedData();
  const { teacher, classId } = classroomWithStudent(db);
  const assign = (dueAt: string) =>
    runAction(db, teacher, {
      action: 'createAssignment',
      classId,
      title: 'Bài',
      instructions: '',
      dueAt,
    }) as Assignment;
  assert.equal(assign('2030-01-02T03:04:05Z').dueAt, '2030-01-02T03:04:05.000Z');
  assert.equal(assign('2030-01-02T03:04:05.123456Z').dueAt, '2030-01-02T03:04:05.123Z');
});
