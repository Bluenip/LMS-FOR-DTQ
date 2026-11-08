import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessDriveDocument, runAction, stateFor } from '../src/lib/server/actions';
import { encryptSecret, rememberAccessToken } from '../src/lib/server/google-drive';
import {
  completeUpload,
  deleteFile,
  serveDocument,
  initUpload,
} from '../src/lib/server/drive-service';
import { withDatabase } from '../src/lib/server/repository';
import type { Assignment, DriveFile } from '../src/lib/types';

process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-value';
process.env.DRIVE_ENCRYPTION_KEY = 'test-drive-encryption-key-0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.DATABASE_URL;

test('every upload goes to Drive; learner files stay private and in-app access is class-scoped', async (t) => {
  const original = globalThis.fetch;
  const cwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'drive-upload-test-')));
  t.after(() => {
    globalThis.fetch = original;
    process.chdir(cwd);
  });
  const pdf = Buffer.from('%PDF-1.7 hello');
  const files = new Map<string, { jobId: string; name: string; size: number }>();
  let sessions = 0;
  let permissionCalls = 0;
  let sessionFor = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    if (url.includes('uploadType=resumable')) {
      const meta = JSON.parse(init.body as string);
      sessions++;
      sessionFor = `drive-doc-${sessions}-abcdef`;
      files.set(sessionFor, {
        jobId: meta.appProperties.lmsJobId,
        name: meta.name,
        size: pdf.length,
      });
      return new Response(null, {
        status: 200,
        headers: { Location: `https://upload.example/${sessionFor}` },
      });
    }
    if (url.startsWith('https://upload.example/')) {
      const id = url.split('/').pop()!;
      const f = files.get(id)!;
      return Response.json(
        {
          id,
          name: f.name,
          mimeType: 'application/pdf',
          size: String(f.size),
          appProperties: { lmsJobId: f.jobId },
        },
        { status: 200 },
      );
    }
    if (url.endsWith('/drive/v3/files?fields=id')) return Response.json({ id: 'folder-1' });
    if (url.includes('/permissions')) {
      permissionCalls++;
      return Response.json({ permissions: [] });
    }
    if (url.includes('alt=media'))
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: { 'content-length': String(pdf.length) },
      });
    const id = /files\/([\w-]+)\?/.exec(url)?.[1];
    if (id && files.has(id)) {
      const f = files.get(id)!;
      return Response.json({
        id,
        name: f.name,
        mimeType: 'application/pdf',
        size: String(f.size),
        appProperties: { lmsJobId: f.jobId },
      });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
  rememberAccessToken('access-token', 3600);

  const { classId, outsider } = await withDatabase((db) => {
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
      title: 'Lớp Drive',
      autoApprove: true,
    }) as { id: string; code: string };
    const student = db.users.find((u) => u.id === 'student-1')!;
    runAction(db, student, { action: 'joinClass', code: created.code });
    // A second learner who joined nothing in this class.
    return { classId: created.id, outsider: db.users.find((u) => u.id === 'student-2')!.id };
  }, true);
  const state = (id: string) =>
    withDatabase((db) =>
      stateFor(
        db,
        db.users.find((u) => u.id === id)!,
      ),
    );
  assert.equal(
    (await state('student-1')).storageConfigured,
    true,
    'uploads are enabled once Drive is connected',
  );

  const doc = {
    classId,
    name: 'bai-lam.pdf',
    size: pdf.length,
    mimeType: 'application/pdf',
    kind: 'document',
  };
  // Learners may not upload lesson materials; outsiders may not upload at all.
  // (Learner videos are covered by drive-learner-video.test.ts.)
  await assert.rejects(
    initUpload('student-1', 'http://localhost:3000', { ...doc, lessonId: 'whatever' }),
    { status: 403 },
  );
  await assert.rejects(initUpload(outsider, 'http://localhost:3000', doc), { status: 403 });

  const started = await initUpload('student-1', 'http://localhost:3000', doc);
  const done = (await completeUpload('student-1', started.job.id, { driveFileId: sessionFor }))
    .job as DriveFile;
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.shared, false, 'a learner file is never shared by link');
  assert.equal(permissionCalls, 0, 'no permission was requested at Google');
  assert.equal(done.previewUrl !== undefined, true);

  // Attach to an assignment draft, then submit.
  const submissionFile = await withDatabase((db) => {
    const teacher = db.users.find((u) => u.id === 'teacher-1')!;
    const student = db.users.find((u) => u.id === 'student-1')!;
    const assignment = runAction(db, teacher, {
      action: 'createAssignment',
      classId,
      title: 'Bài thử Drive',
      instructions: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      minWords: 0,
    }) as Assignment;
    runAction(db, student, {
      action: 'saveSubmission',
      assignmentId: assignment.id,
      attachments: [{ id: done.id, name: 'x', size: 1, mimeType: 'x' }],
    });
    // The record, not the client payload, decides name/size/url.
    const draft = db.submissions.find((s) => s.assignmentId === assignment.id)!;
    return { assignment, attachment: draft.attachments[0] };
  }, true);
  assert.equal(submissionFile.attachment.url, `/api/drive/files/${done.id}/download`);
  assert.equal(submissionFile.attachment.name, 'bai-lam.pdf');

  const canRead = (userId: string) =>
    withDatabase((db) =>
      accessDriveDocument(
        db,
        db.users.find((u) => u.id === userId)!,
        done.id,
      ),
    );
  await canRead('student-1'); // owner
  await assert.rejects(
    canRead('teacher-1'),
    { status: 403 },
    'teachers cannot read unsubmitted drafts',
  );
  await withDatabase((db) => {
    runAction(
      db,
      db.users.find((u) => u.id === 'student-1')!,
      {
        action: 'submitAssignment',
        assignmentId: submissionFile.assignment.id,
        attachments: [{ id: done.id, name: 'x', size: 1, mimeType: 'x' }],
        pledge: true,
      },
    );
  }, true);
  await canRead('teacher-1'); // class teacher, once submitted
  await assert.rejects(canRead(outsider), { status: 403 });

  // A different learner cannot attach someone else's file to their own submission.
  await assert.rejects(
    withDatabase((db) => {
      runAction(
        db,
        db.users.find((u) => u.id === 'student-2')!,
        {
          action: 'joinClass',
          code: db.classes.find((c) => c.id === classId)!.code,
        },
      );
      runAction(
        db,
        db.users.find((u) => u.id === 'student-2')!,
        {
          action: 'saveSubmission',
          assignmentId: submissionFile.assignment.id,
          attachments: [{ id: done.id, name: 'x', size: 1, mimeType: 'x' }],
        },
      );
    }, true),
    { status: 404 },
  );

  // The download is streamed through the server with attachment headers.
  const response = await serveDocument('teacher-1', done.id, null, false);
  assert.equal(
    response.headers.get('content-disposition'),
    "attachment; filename*=UTF-8''bai-lam.pdf",
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), pdf.toString());
  await assert.rejects(serveDocument(outsider, done.id, null, false), { status: 403 });

  // A file used by a submission cannot be deleted.
  await assert.rejects(deleteFile('student-1', done.id), { status: 409 });
});
