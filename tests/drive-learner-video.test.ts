import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessDriveDocument, runAction } from '../src/lib/server/actions';
import { encryptSecret, rememberAccessToken } from '../src/lib/server/google-drive';
import {
  completeUpload,
  initUpload,
  listFiles,
  serveDocument,
} from '../src/lib/server/drive-service';
import { withDatabase } from '../src/lib/server/repository';
import type { Assignment, DriveFile } from '../src/lib/types';

process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-value';
process.env.DRIVE_ENCRYPTION_KEY = 'test-drive-encryption-key-0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.DATABASE_URL;

test('learners may submit videos; they are public by policy but never become class material', async (t) => {
  const original = globalThis.fetch;
  const cwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'drive-learner-video-')));
  t.after(() => {
    globalThis.fetch = original;
    process.chdir(cwd);
  });
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]);
  const files = new Map<string, { jobId: string; name: string; size: number; mime: string }>();
  let count = 0;
  let lastId = '';
  let publicGrants = 0;
  let rangeSeen: string | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    if (url.includes('uploadType=resumable')) {
      const meta = JSON.parse(init.body as string);
      lastId = `drive-video-${++count}-abcdefg`;
      files.set(lastId, {
        jobId: meta.appProperties.lmsJobId,
        name: meta.name,
        size: Number((init.headers as Record<string, string>)['X-Upload-Content-Length']),
        mime: meta.mimeType,
      });
      return new Response(null, {
        status: 200,
        headers: { Location: `https://upload.example/${lastId}` },
      });
    }
    if (url.startsWith('https://upload.example/')) {
      const id = url.split('/').pop()!;
      const f = files.get(id)!;
      return Response.json({
        id,
        name: f.name,
        mimeType: f.mime,
        size: String(f.size),
        appProperties: { lmsJobId: f.jobId },
      });
    }
    if (url.endsWith('/drive/v3/files?fields=id')) return Response.json({ id: 'folder-1' });
    if (url.includes('/permissions')) {
      if (method === 'POST') publicGrants++;
      return Response.json({ permissions: [], id: 'perm' });
    }
    if (url.includes('alt=media')) {
      rangeSeen = (init.headers as Record<string, string>).Range;
      return new Response(new Uint8Array(mp4), {
        status: 206,
        headers: {
          'content-range': `bytes 0-${mp4.length - 1}/${mp4.length}`,
          'content-length': String(mp4.length),
        },
      });
    }
    const id = /files\/([\w-]+)\?/.exec(url)?.[1];
    if (id && files.has(id)) {
      const f = files.get(id)!;
      return Response.json({
        id,
        name: f.name,
        mimeType: f.mime,
        size: String(f.size),
        appProperties: { lmsJobId: f.jobId },
      });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
  rememberAccessToken('access-token', 3600);

  const classId = await withDatabase((db) => {
    db.driveConnections.push({
      id: 'shared',
      connectedById: 'teacher-1',
      email: 'drive@example.com',
      encryptedRefreshToken: encryptSecret('refresh'),
      scope: 'https://www.googleapis.com/auth/drive.file',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    const created = runAction(db, teacher, {
      action: 'createClass',
      title: 'Lớp video',
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
    return created.id;
  }, true);
  const video = (name: string) => ({
    classId,
    name,
    size: mp4.length,
    mimeType: 'video/mp4',
    kind: 'video',
  });

  // The learner uploads a video: allowed, completed, and NOT shared with anyone.
  const mine = await initUpload('student-1', 'http://localhost:3000', video('bai-nop.mp4'));
  const mineDone = (await completeUpload('student-1', mine.job.id, { driveFileId: lastId }))
    .job as DriveFile;
  assert.equal(mineDone.status, 'COMPLETED');
  assert.equal(mineDone.shared, true, 'every upload is public by policy');
  assert.equal(publicGrants, 1, 'the anyone/reader permission was created for the learner video');

  // A teacher's lesson video is still shared for the preview player.
  const lessonVideo = await initUpload(
    'teacher-1',
    'http://localhost:3000',
    video('bai-giang.mp4'),
  );
  const lessonDone = (
    await completeUpload('teacher-1', lessonVideo.job.id, { driveFileId: lastId })
  ).job as DriveFile;
  assert.equal(lessonDone.shared, true);
  assert.equal(publicGrants, 2);

  // The teacher's library lists class material only, not the learner's submission video.
  const library = (await listFiles('teacher-1', new URLSearchParams({ classId, kind: 'video' })))
    .files;
  assert.deepEqual(
    library.map((f) => f.id),
    [lessonDone.id],
  );

  // A learner video can be attached to a submission but can never become the lesson video.
  await withDatabase((db) => {
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    const lesson = (driveFileId: string) =>
      runAction(db, teacher, {
        action: 'saveLesson',
        classId,
        title: 'Bài Drive',
        order: 5,
        videoType: 'DRIVE',
        driveFileId,
      });
    assert.throws(() => lesson(mineDone.driveFileId!), /Google Drive/);
    assert.doesNotThrow(() => lesson(lessonDone.driveFileId!));

    const assignment = runAction(db, teacher, {
      action: 'createAssignment',
      classId,
      title: 'Nộp video',
      instructions: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      minWords: 0,
    }) as Assignment;
    const student = db.users.find((u) => u.id === 'student-1')!;
    runAction(db, student, {
      action: 'submitAssignment',
      assignmentId: assignment.id,
      attachments: [{ id: mineDone.id, name: 'x', size: 1, mimeType: 'x' }],
      pledge: true,
    });
    assert.equal(accessDriveDocument(db, teacher, mineDone.id).id, mineDone.id);
  }, true);
  // In-page viewing: inline disposition, Range forwarded (seeking), script-proof sandbox for video.
  const view = await serveDocument('teacher-1', mineDone.id, 'bytes=0-3', true);
  assert.equal(view.status, 206);
  assert.equal(rangeSeen, 'bytes=0-3');
  assert.match(view.headers.get('content-disposition')!, /^inline;/);
  assert.equal(view.headers.get('accept-ranges'), 'bytes');
  assert.match(view.headers.get('content-range')!, /^bytes 0-/);
  assert.match(view.headers.get('content-security-policy')!, /sandbox/);
  assert.match(
    (await serveDocument('teacher-1', mineDone.id, null, false)).headers.get(
      'content-disposition',
    )!,
    /^attachment;/,
  );
  // The owner can watch their own upload; an unrelated learner cannot; an administrator can.
  await serveDocument('student-1', mineDone.id, null, true);
  await assert.rejects(serveDocument('student-2', mineDone.id, null, true), { status: 403 });
  await withDatabase((db) => {
    db.users.find((u) => u.id === 'student-2')!.isAdmin = true;
  }, true);
  await serveDocument('student-2', mineDone.id, null, true);
});
