import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import {
  authorizationUrl,
  decryptSecret,
  encryptSecret,
  googleError,
  matchesSignature,
  queryResumable,
  rememberAccessToken,
  statesMatch,
} from '../src/lib/server/google-drive';
import {
  cancelUpload,
  completeUpload,
  deleteFile,
  driveFileDto,
  initUpload,
  resumeUpload,
  validateDriveUpload,
} from '../src/lib/server/drive-service';
import { withDatabase } from '../src/lib/server/repository';
import type { DriveUpload } from '../src/lib/types';

process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-value';
process.env.DRIVE_ENCRYPTION_KEY = 'test-drive-encryption-key-0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.DATABASE_URL;

test('refresh tokens are encrypted, authenticated and never stored in clear', () => {
  const sealed = encryptSecret('1//refresh-token');
  assert(!sealed.includes('refresh-token'));
  assert.equal(decryptSecret(sealed), '1//refresh-token');
  assert.notEqual(encryptSecret('1//refresh-token'), sealed, 'a fresh IV is used per encryption');
  const [v, iv, tag, body] = sealed.split('.');
  assert.throws(() => decryptSecret([v, iv, tag, `${body}A`].join('.')));
  assert.throws(() => decryptSecret('garbage'));
});

test('OAuth request asks for drive.file offline access and carries the CSRF state', () => {
  const url = new URL(
    authorizationUrl(new Request('http://localhost:3000/api/drive/connect'), 'abc'),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/drive/callback');
  assert(!url.toString().includes('client-secret-value'));
  assert(statesMatch('abc', 'abc'));
  assert(!statesMatch('abc', 'abd'));
  assert(!statesMatch(undefined, 'abc'));
  assert(!statesMatch('abc', null));
});

test('upload validation rejects spoofed types, oversize files and odd names', () => {
  const ok = { classId: 'c', name: 'bai.mp4', size: 10, mimeType: 'video/mp4', kind: 'video' };
  assert.equal(validateDriveUpload(ok).name, 'bai.mp4');
  assert.throws(() => validateDriveUpload({ ...ok, mimeType: 'application/pdf' }));
  assert.throws(() => validateDriveUpload({ ...ok, name: 'bai.exe' }));
  assert.throws(() => validateDriveUpload({ ...ok, kind: 'document' }));
  assert.throws(() => validateDriveUpload({ ...ok, size: 6 * 1024 * 1024 * 1024 }), /5 GB/);
  assert.throws(() => validateDriveUpload({ ...ok, name: '../bai.mp4' }));
  assert.equal(
    validateDriveUpload({
      classId: 'c',
      name: 'slide.pptx',
      size: 5,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      kind: 'document',
    }).kind,
    'document',
  );
});

test('content signatures are checked against the declared MIME type', () => {
  assert(matchesSignature('application/pdf', Buffer.from('%PDF-1.7')));
  assert(!matchesSignature('application/pdf', Buffer.from('MZ\x90\x00')));
  assert(matchesSignature('video/mp4', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')])));
  assert(!matchesSignature('video/mp4', Buffer.from('<html>not a video</html>')));
  assert(matchesSignature('video/webm', Buffer.from([26, 69, 223, 163, 1])));
  assert(!matchesSignature('video/x-unknown', Buffer.from('anything')));
});

test('Google errors are classified into retryable and user-actionable failures', async () => {
  const make = (status: number, reason = '') =>
    googleError(new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status }));
  const quiet = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await make(404)).status, 404);
    assert.equal((await make(429)).status, 429);
    assert.equal((await make(403, 'userRateLimitExceeded')).status, 429);
    assert.equal((await make(403, 'storageQuotaExceeded')).status, 507);
    assert.equal((await make(403, 'forbidden')).status, 502);
    assert.equal((await make(500)).status, 503);
    assert.equal((await make(400)).status, 400);
  } finally {
    console.error = quiet;
  }
});

test('resumable status query understands 308 ranges, completion and expiry', async () => {
  const original = globalThis.fetch;
  const reply = (response: Response) => {
    globalThis.fetch = (async () => response) as typeof fetch;
  };
  try {
    reply(new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } }));
    assert.deepEqual(await queryResumable('https://upload.example/s', 1000000), {
      state: 'partial',
      offset: 262144,
    });
    reply(new Response(null, { status: 308 }));
    assert.deepEqual(await queryResumable('https://upload.example/s', 1000000), {
      state: 'partial',
      offset: 0,
    });
    reply(Response.json({ id: 'abcdefghij' }, { status: 200 }));
    assert.equal(
      ((await queryResumable('https://upload.example/s', 1)) as { file: { id: string } }).file.id,
      'abcdefghij',
    );
    reply(new Response(null, { status: 404 }));
    assert.deepEqual(await queryResumable('https://upload.example/s', 1), { state: 'expired' });
  } finally {
    globalThis.fetch = original;
  }
});

test('Drive videos attach to lessons only after the upload job completed in the same class', () => {
  const db = seedData();
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const classroom = db.classes.find((c) => c.teacherId === teacher.id)!;
  const job: DriveUpload = {
    id: 'job-1',
    ownerId: teacher.id,
    classId: classroom.id,
    kind: 'video',
    name: 'bai.mp4',
    mimeType: 'video/mp4',
    size: 10,
    title: 'bai',
    description: '',
    status: 'COMPLETED',
    bytesUploaded: 10,
    driveFileId: 'drive-file-12345',
    shared: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.driveUploads.push(job);
  const save = (extra: Record<string, unknown>) =>
    runAction(db, teacher, {
      action: 'saveLesson',
      classId: classroom.id,
      title: 'Bài Drive',
      order: 90,
      videoType: 'DRIVE',
      ...extra,
    }) as { id: string; videoUrl: string; driveFileId?: string };
  assert.throws(() => save({ driveFileId: 'unknown-file-123' }), /Google Drive/);
  const lesson = save({ driveFileId: 'drive-file-12345' });
  assert.equal(lesson.videoUrl, 'https://drive.google.com/file/d/drive-file-12345/preview');
  assert.equal(job.lessonId, lesson.id);
  job.status = 'FAILED';
  assert.throws(() => save({ driveFileId: 'drive-file-12345' }), /Google Drive/);
  job.status = 'COMPLETED';
  // A video of another class cannot be attached.
  job.classId = 'another-class';
  assert.throws(() => save({ driveFileId: 'drive-file-12345' }), /Google Drive/);
  job.classId = classroom.id;
  runAction(db, teacher, { action: 'deleteLesson', lessonId: lesson.id });
  assert.equal(job.lessonId, undefined);
  assert.equal(
    driveFileDto(job).previewUrl,
    'https://drive.google.com/file/d/drive-file-12345/preview',
  );
  assert(!('encryptedSessionUri' in driveFileDto({ ...job, encryptedSessionUri: 'secret' })));
});

test('resumable upload lifecycle against a mocked Google API', async (t) => {
  const original = globalThis.fetch;
  const cwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'drive-test-')));
  t.after(() => {
    globalThis.fetch = original;
    process.chdir(cwd);
  });
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] =
    [];
  let sessionState: 'partial' | 'done' = 'partial';
  let remote = {
    name: 'bai.mp4',
    mimeType: 'video/mp4',
    size: '1048576',
    appProperties: {} as Record<string, string>,
  };
  let head: Buffer = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]);
  let permissions: { id: string; type: string; role: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({
      method,
      url,
      headers: (init.headers || {}) as Record<string, string>,
      body: init.body,
    });
    if (url.includes('uploadType=resumable'))
      return new Response(null, {
        status: 200,
        headers: { Location: 'https://upload.example/session-1' },
      });
    if (url.startsWith('https://upload.example/session-1')) {
      if (method === 'DELETE') return new Response(null, { status: 499 });
      return sessionState === 'done'
        ? Response.json({ id: 'drive-file-12345', ...remote }, { status: 200 })
        : new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } });
    }
    if (url.endsWith('/drive/v3/files?fields=id')) return Response.json({ id: 'folder-1' });
    if (url.includes('alt=media')) return new Response(new Uint8Array(head), { status: 206 });
    if (url.includes('/permissions')) {
      if (method === 'POST') {
        permissions = [{ id: 'perm-1', type: 'anyone', role: 'reader' }];
        return Response.json({ id: 'perm-1' });
      }
      return Response.json({ permissions });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (url.includes('/drive/v3/files/drive-file-12345'))
      return Response.json({ id: 'drive-file-12345', ...remote });
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
  rememberAccessToken('access-token', 3600);

  const classId = await withDatabase((db) => {
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
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
    return db.classes.find((c) => c.teacherId === teacher.id)!.id;
  }, true);
  const body = { classId, name: 'bai.mp4', size: 1048576, mimeType: 'video/mp4', kind: 'video' };

  const started = await initUpload('teacher-1', 'http://localhost:3000', body);
  assert.equal(started.uploadUrl, 'https://upload.example/session-1');
  assert.equal(started.job.status, 'PENDING');
  assert(
    !JSON.stringify(started.job).includes('session-1'),
    'session URI is not part of the job DTO',
  );
  const initCall = calls.find((c) => c.url.includes('uploadType=resumable'))!;
  assert.equal(initCall.headers.Origin, 'http://localhost:3000');
  assert.equal(initCall.headers['X-Upload-Content-Length'], '1048576');
  assert.equal(JSON.parse(initCall.body as string).appProperties.lmsJobId, started.job.id);
  assert.deepEqual(JSON.parse(initCall.body as string).parents, ['folder-1']);
  const stored = await withDatabase((db) => db.driveUploads[0]);
  assert(
    !stored.encryptedSessionUri!.includes('upload.example'),
    'session URI is stored encrypted',
  );

  // Selecting the same file again resumes instead of creating a duplicate job.
  const again = await initUpload('teacher-1', 'http://localhost:3000', body);
  assert.equal(again.job.id, started.job.id);
  assert.equal(again.offset, 262144);
  assert.equal(await withDatabase((db) => db.driveUploads.length), 1);

  // Another user cannot touch the job (IDOR).
  await assert.rejects(resumeUpload('student-1', started.job.id), { status: 403 });
  await assert.rejects(cancelUpload('student-1', started.job.id), { status: 403 });

  // Completion must be bound to this job: a foreign file id is refused.
  sessionState = 'done';
  await assert.rejects(
    completeUpload('teacher-1', started.job.id, { driveFileId: 'drive-file-12345' }),
    { status: 409 },
  );
  remote = { ...remote, appProperties: { lmsJobId: started.job.id } };

  // Wrong real content: the file is deleted from Drive and the job fails.
  head = Buffer.from('<html>pretending to be a video</html>');
  await assert.rejects(
    completeUpload('teacher-1', started.job.id, { driveFileId: 'drive-file-12345' }),
    { status: 400 },
  );
  assert(calls.some((c) => c.method === 'DELETE' && c.url.includes('/files/drive-file-12345')));
  assert.equal(await withDatabase((db) => db.driveUploads[0].status), 'FAILED');

  // A fresh job completes, e.g. when the browser never reported the final response (reconcile on resume).
  calls.length = 0;
  sessionState = 'partial';
  head = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]);
  const second = await initUpload('teacher-1', 'http://localhost:3000', body);
  remote = { ...remote, appProperties: { lmsJobId: second.job.id } };
  sessionState = 'done';
  const resumed = await resumeUpload('teacher-1', second.job.id);
  assert.equal(resumed.done, true);
  const finished = (resumed as { job: { status: string; shared: boolean; previewUrl?: string } })
    .job;
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.shared, true);
  assert.equal(finished.previewUrl, 'https://drive.google.com/file/d/drive-file-12345/preview');
  assert(
    calls.some((c) => c.method === 'POST' && c.url.includes('/permissions')),
    'anyone/reader permission created',
  );
  // Idempotent: completing again changes nothing.
  assert.equal((await completeUpload('teacher-1', second.job.id, {})).job.status, 'COMPLETED');
  const row = await withDatabase((db) => db.driveUploads.find((u) => u.id === second.job.id)!);
  assert.equal(row.encryptedSessionUri, undefined);

  // A video used by a lesson cannot be deleted from Drive.
  await withDatabase((db) => {
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    runAction(db, teacher, {
      action: 'saveLesson',
      classId,
      title: 'Dùng video',
      order: 91,
      videoType: 'DRIVE',
      driveFileId: 'drive-file-12345',
    });
  }, true);
  await assert.rejects(deleteFile('teacher-1', second.job.id), { status: 409 });
  await withDatabase((db) => {
    const lesson = db.lessons.find((l) => l.driveFileId === 'drive-file-12345')!;
    runAction(
      db,
      db.users.find((u) => u.id === 'teacher-1')!,
      { action: 'deleteLesson', lessonId: lesson.id },
    );
  }, true);
  await deleteFile('teacher-1', second.job.id);
  assert.equal(
    await withDatabase((db) => db.driveUploads.some((u) => u.id === second.job.id)),
    false,
  );
});
