import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../src/lib/server/actions';
import { encryptSecret, rememberAccessToken } from '../src/lib/server/google-drive';
import {
  deleteFile,
  disconnect,
  initUpload,
  pruneDrive,
  setSharing,
  updateFile,
} from '../src/lib/server/drive-service';
import { withDatabase } from '../src/lib/server/repository';
import type { DriveUpload } from '../src/lib/types';

process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-value';
process.env.DRIVE_ENCRYPTION_KEY = 'test-drive-encryption-key-0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
process.env.LMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'drive-maint-'));
delete process.env.DATABASE_URL;

const HOUR = 3600000;
const old = () => new Date(Date.now() - 48 * HOUR).toISOString();

test('Drive maintenance: orphans are removed, reusable material is kept, learners are protected', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const deleted: string[] = [];
  const revoked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      revoked.push('x');
      return new Response('{}', { status: 200 });
    }
    if (method === 'DELETE' && url.includes('/drive/v3/files/')) {
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      deleted.push(id);
      return new Response(null, { status: id.startsWith('gone-') ? 404 : 204 });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
  rememberAccessToken('access-token', 3600);

  const ctx = await withDatabase((db) => {
    db.driveConnections.push({
      id: 'shared',
      connectedById: 'teacher-1',
      email: 'drive@example.com',
      encryptedRefreshToken: encryptSecret('refresh'),
      scope: 'https://www.googleapis.com/auth/drive.file',
      status: 'ACTIVE',
      folderId: 'folder-keep',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    teacher.isAdmin = true;
    const created = runAction(db, teacher, {
      action: 'createClass',
      title: 'Lớp dọn dẹp',
      autoApprove: true,
    }) as { id: string; code: string };
    runAction(
      db,
      db.users.find((u) => u.id === 'student-1')!,
      {
        action: 'joinClass',
        code: created.code,
      },
    );
    const job = (over: Partial<DriveUpload>): DriveUpload => {
      const j: DriveUpload = {
        id: `job-${db.driveUploads.length}`,
        ownerId: 'student-1',
        classId: created.id,
        kind: 'document',
        name: 'bai.pdf',
        mimeType: 'application/pdf',
        size: 5,
        title: 'bai',
        description: '',
        status: 'COMPLETED',
        bytesUploaded: 5,
        driveFileId: `drive-${db.driveUploads.length}-0123456789`,
        shared: true,
        createdAt: old(),
        updatedAt: old(),
        ...over,
      };
      db.driveUploads.push(j);
      return j;
    };
    const orphan = job({});
    const recent = job({ createdAt: new Date().toISOString() });
    const attached = job({});
    runAction(
      db,
      db.users.find((u) => u.id === 'student-1')!,
      {
        action: 'saveSubmission',
        assignmentId: (
          runAction(db, teacher, {
            action: 'createAssignment',
            classId: created.id,
            title: 'Bài',
            instructions: '',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
          }) as { id: string }
        ).id,
        attachments: [{ id: attached.id, name: 'x', size: 1, mimeType: 'x' }],
      },
    );
    const failed = job({ status: 'FAILED', driveFileId: undefined });
    const libraryVideo = job({
      ownerId: 'teacher-1',
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'v.mp4',
    });
    const teacherMaterial = job({ ownerId: 'teacher-1' });
    db.driveTrash.push(
      { id: 'trash-1-0123456789', createdAt: old() },
      { id: 'gone-2-0123456789', createdAt: old() },
    );
    return {
      classId: created.id,
      orphan,
      recent,
      attached,
      failed,
      libraryVideo,
      teacherMaterial,
    };
  }, true);

  const result = await pruneDrive(24);
  assert.equal(result.failed, 0);
  assert.equal(result.skippedNoConnection, false);
  // Deleted: trash entries, the learner's never-attached file, the teacher's unattached document.
  for (const id of [
    'trash-1-0123456789',
    'gone-2-0123456789',
    ctx.orphan.driveFileId!,
    ctx.teacherMaterial.driveFileId!,
  ])
    assert.ok(deleted.includes(id), `${id} should be deleted`);
  // Kept: recent upload, attached file, library video (reusable), unreferenced-but-fresh nothing else.
  for (const kept of [ctx.recent, ctx.attached, ctx.libraryVideo])
    assert.ok(!deleted.includes(kept.driveFileId!), `${kept.id} must be kept`);
  const state = await withDatabase((db) => ({
    jobs: db.driveUploads.map((u) => u.id),
    trash: db.driveTrash.length,
  }));
  assert.equal(state.trash, 0);
  assert.ok(!state.jobs.includes(ctx.orphan.id));
  assert.ok(!state.jobs.includes(ctx.failed.id), 'old failed records are dropped');
  for (const kept of [ctx.recent, ctx.attached, ctx.libraryVideo])
    assert.ok(state.jobs.includes(kept.id));

  // Running it again finds nothing to do (idempotent).
  deleted.length = 0;
  assert.equal((await pruneDrive(24)).removedRecords, 0);
  assert.equal(deleted.length, 0);

  // A teacher cannot rename, unshare or delete a learner's file; the owner and an admin can.
  const learnerFile = ctx.recent;
  // (An administrator may; the teacher below is demoted first.)
  await withDatabase((db) => {
    db.users.find((u) => u.id === 'teacher-1')!.isAdmin = false;
  }, true);
  await assert.rejects(updateFile('teacher-1', learnerFile.id, { title: 'đổi' }), { status: 403 });
  await assert.rejects(setSharing('teacher-1', learnerFile.id, { public: false }), { status: 403 });
  await assert.rejects(deleteFile('teacher-1', learnerFile.id), { status: 403 });
  assert.equal(
    (
      (await updateFile('student-1', learnerFile.id, { title: 'của tôi' })) as {
        file: { title: string };
      }
    ).file.title,
    'của tôi',
  );
  // …but a teacher still manages class material.
  assert.equal(
    (
      (await updateFile('teacher-1', ctx.libraryVideo.id, { title: 'video thư viện' })) as {
        file: { title: string };
      }
    ).file.title,
    'video thư viện',
  );

  // Disconnecting keeps the folder so reconnecting the same account does not create a duplicate.
  await withDatabase((db) => {
    db.users.find((u) => u.id === 'teacher-1')!.isAdmin = true;
  }, true);
  await disconnect('teacher-1');
  const row = await withDatabase((db) => ({ ...db.driveConnections[0] }));
  assert.equal(row.status, 'DISCONNECTED');
  assert.equal(row.encryptedRefreshToken, '', 'the secret is dropped');
  assert.equal(row.folderId, 'folder-keep', 'the folder is remembered');
  assert.equal(revoked.length, 1, 'the grant was revoked at Google');
  await assert.rejects(
    initUpload('teacher-1', 'http://localhost:3000', {
      classId: ctx.classId,
      name: 'a.mp4',
      size: 10,
      mimeType: 'video/mp4',
      kind: 'video',
    }),
    { status: 409 },
  );
  assert.equal((await disconnect('teacher-1')).message, 'Google Drive chưa được kết nối.');
  // Without a connection the clean-up only touches records it can resolve locally.
  await withDatabase((db) => {
    db.driveTrash.push({ id: 'late-trash-0123456789', createdAt: old() });
  }, true);
  const offline = await pruneDrive(24);
  assert.equal(offline.skippedNoConnection, true);
  assert.equal(await withDatabase((db) => db.driveTrash.length), 1, 'kept for the next run');
});
