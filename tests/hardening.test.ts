import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import { matchesOfficeTail } from '../src/lib/server/google-drive';
import { listAudit, recordAudit } from '../src/lib/server/repository';
import type { Assignment, Database, DriveUpload } from '../src/lib/types';

process.env.LMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'hardening-'));
delete process.env.DATABASE_URL;

function fixture(minWords = 150) {
  const db = seedData();
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const student = db.users.find((u) => u.id === 'student-1')!;
  const classroom = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp kiểm thử',
    autoApprove: true,
  }) as { id: string; code: string };
  runAction(db, student, { action: 'joinClass', code: classroom.code });
  const assign = (extra: Record<string, unknown> = {}) =>
    runAction(db, teacher, {
      action: 'createAssignment',
      classId: classroom.id,
      title: 'Bài kiểm thử',
      instructions: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      minWords,
      ...extra,
    }) as Assignment;
  return { db, teacher, student, classroom, assign };
}

test('a link alone is valid evidence even when the assignment has a minimum word count', () => {
  const { db, student, assign } = fixture(150);
  const a = assign();
  const submitted = runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    link: 'https://example.com/work',
    pledge: true,
  }) as { status: string };
  assert.equal(submitted.status, 'SUBMITTED');
});

test('plain text must still respect the word range when there is no file or link', () => {
  const { db, student, assign } = fixture(150);
  const a = assign();
  assert.throws(
    () =>
      runAction(db, student, {
        action: 'submitAssignment',
        assignmentId: a.id,
        content: 'quá ngắn',
        pledge: true,
      }),
    /tối thiểu 150 từ/,
  );
});

test('republishing a lesson does not announce its assignments a second time', () => {
  const { db, teacher, classroom, assign } = fixture();
  const lesson = runAction(db, teacher, {
    action: 'saveLesson',
    classId: classroom.id,
    title: 'Bài giảng',
    order: 1,
    description: 'Nội dung',
    published: false,
  }) as { id: string };
  const a = assign({ lessonId: lesson.id });
  const announcements = () => db.notifications.filter((n) => n.assignmentId === a.id).length;
  assert.equal(announcements(), 0, 'hidden while the lesson is a draft');
  const save = (published: boolean) =>
    runAction(db, teacher, {
      action: 'saveLesson',
      id: lesson.id,
      classId: classroom.id,
      title: 'Bài giảng',
      order: 1,
      description: 'Nội dung',
      published,
      expectedRevision: db.lessons.find((l) => l.id === lesson.id)!.revision,
    });
  save(true);
  assert.equal(announcements(), 1);
  assert.ok(db.assignments.find((x) => x.id === a.id)!.announcedAt);
  save(false);
  save(true);
  assert.equal(announcements(), 1, 'no duplicate announcement after unpublish/publish');
});

function driveJob(db: Database, over: Partial<DriveUpload>): DriveUpload {
  const job: DriveUpload = {
    id: `job-${Math.random().toString(36).slice(2)}`,
    ownerId: 'teacher-1',
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
    shared: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
  db.driveUploads.push(job);
  return job;
}

test('deleting an assignment, lesson or class queues the Drive files for removal', () => {
  const { db, teacher, student, classroom, assign } = fixture();
  const a = assign();
  const submissionFile = driveJob(db, { ownerId: student.id, classId: classroom.id });
  runAction(db, student, {
    action: 'submitAssignment',
    assignmentId: a.id,
    attachments: [{ id: submissionFile.id, name: 'x', size: 1, mimeType: 'x' }],
    pledge: true,
  });
  runAction(db, teacher, { action: 'deleteAssignment', assignmentId: a.id, confirmTitle: a.title });
  assert.ok(db.driveTrash.some((t) => t.id === submissionFile.driveFileId));
  assert.equal(
    db.driveUploads.some((u) => u.id === submissionFile.id),
    false,
  );

  const material = driveJob(db, { ownerId: teacher.id, classId: classroom.id });
  const lesson = runAction(db, teacher, {
    action: 'saveLesson',
    classId: classroom.id,
    title: 'Có tài liệu',
    order: 2,
    description: 'x',
    documents: [{ id: material.id, name: 'x', size: 1, mimeType: 'x' }],
  }) as { id: string };
  runAction(db, teacher, { action: 'deleteLesson', lessonId: lesson.id });
  assert.ok(db.driveTrash.some((t) => t.id === material.driveFileId));

  const leftover = driveJob(db, { ownerId: teacher.id, classId: classroom.id, kind: 'video' });
  const code = db.classes.find((c) => c.id === classroom.id)!.code;
  runAction(db, teacher, { action: 'deleteClass', classId: classroom.id, code });
  assert.ok(db.driveTrash.some((t) => t.id === leftover.driveFileId));
  assert.equal(db.driveUploads.filter((u) => u.classId === classroom.id).length, 0);
});

test('Office files must really be DOCX/PPTX, not another ZIP renamed', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const word = Buffer.from('....word/document.xml....PK');
  const slides = Buffer.from('....ppt/presentation.xml....PK');
  const excel = Buffer.from('....xl/workbook.xml....PK');
  assert.ok(matchesOfficeTail(docx, word));
  assert.ok(matchesOfficeTail(pptx, slides));
  assert.ok(!matchesOfficeTail(docx, excel));
  assert.ok(!matchesOfficeTail(pptx, word));
  assert.ok(matchesOfficeTail('application/pdf', excel), 'non-Office types are not affected');
});

test('administrative actions are written to an append-only audit trail', async () => {
  await recordAudit('admin-1', 'user.create', 'user-9', 'role=TEACHER');
  await recordAudit('admin-1', 'drive.connect', undefined, 'account=x@example.com');
  const entries = await listAudit(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action, 'drive.connect', 'newest first');
  assert.equal(entries[1].targetId, 'user-9');
});
