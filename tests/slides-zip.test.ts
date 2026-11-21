import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/lib/server/actions';
import { safeName, slidesPlan } from '../src/lib/server/drive-service';
import { seedData } from '../src/lib/server/seed-data';
import { dosTime } from '../src/lib/server/zip';
import type { Assignment, Database, DriveUpload, StoredUser } from '../src/lib/types';

function fixture() {
  const db = structuredClone(seedData()) as Database;
  const teacher = db.users[0];
  const approved = db.enrollments.filter(
    (e) => e.classId === 'dtq-2026' && e.status === 'APPROVED',
  );
  const learners = approved.map((e) => db.users.find((u) => u.id === e.userId)!);
  const assignment = runAction(db, teacher, {
    action: 'createAssignment',
    classId: 'dtq-2026',
    title: "Báo cáo 'tâm đắc'",
    instructions: 'Nộp slide.',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  }) as Assignment;
  /** Hands in the given files for a learner, as completed Drive uploads. */
  const handIn = (learner: StoredUser, ...names: string[]) => {
    const files = names.map((name, i) => {
      const job: DriveUpload = {
        id: `job-${learner.id}-${i}`,
        ownerId: learner.id,
        classId: 'dtq-2026',
        assignmentId: assignment.id,
        kind: 'document',
        name,
        mimeType: 'application/octet-stream',
        size: 10,
        title: name,
        description: '',
        status: 'COMPLETED',
        bytesUploaded: 10,
        driveFileId: `drive-${learner.id}-${i}`,
        shared: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.driveUploads.push(job);
      return { id: job.id, name, size: 10, mimeType: job.mimeType, url: '' };
    });
    db.submissions.push({
      id: `sub-${learner.id}`,
      assignmentId: assignment.id,
      studentId: learner.id,
      content: '',
      link: '',
      attachments: files,
      status: 'SUBMITTED',
      attempt: 1,
      feedback: '',
      submittedAt: new Date().toISOString(),
    });
  };
  return { db, teacher, learners, approved, assignment, handIn };
}

test('slide ZIP plan: one folder per student, slides only, namesakes kept apart', () => {
  const { db, teacher, learners, assignment, handIn } = fixture();
  const [a, b, c] = learners;
  b.name = a.name; // two students with the same name
  handIn(a, 'Bài 3.pptx', 'Bài 3.pptx', 'ảnh.png');
  handIn(b, 'Bài 3.pptx');
  handIn(c, 'trình bày.pdf');
  const plan = slidesPlan(db, teacher, assignment.id, null);
  const paths = plan.files.map((f) => f.path);
  assert.deepEqual(paths.slice(0, 2), [`${a.name}/Bài 3.pptx`, `${a.name}/Bài 3 (2).pptx`]);
  assert.ok(!paths.some((p) => p.endsWith('.png')), 'only slide and PDF files');
  const folders = new Set(paths.map((p) => p.split('/')[0]));
  assert.equal(folders.size, 3, 'namesakes get separate folders');
  assert.ok(paths.includes(`${a.name} (${b.email.split('@')[0]})/Bài 3.pptx`));
  assert.equal(plan.students, 3);

  // Only the chosen students.
  const one = slidesPlan(db, teacher, assignment.id, [c.id]);
  assert.deepEqual(
    one.files.map((f) => f.path),
    [`${c.name}/trình bày.pdf`],
  );
});

test('slide ZIP plan: nothing to download, outsiders and group leaders', () => {
  const { db, teacher, learners, approved, assignment, handIn } = fixture();
  const [a, b, c] = learners;
  assert.throws(() => slidesPlan(db, teacher, assignment.id, null), /Chưa có tệp slide/);
  assert.throws(() => slidesPlan(db, teacher, 'no-such-assignment', null), /Không tìm thấy/);
  handIn(a, 'a.pptx');
  handIn(b, 'b.pptx');
  handIn(c, 'c.pptx');
  assert.throws(() => slidesPlan(db, a, assignment.id, null), /trưởng nhóm/);
  // a leads group 1 with b; c is in group 2.
  approved[0].group = 1;
  approved[0].leader = true;
  approved[1].group = 1;
  approved[2].group = 2;
  const plan = slidesPlan(db, a, assignment.id, null);
  assert.deepEqual(
    plan.files.map((f) => f.path),
    [`${b.name}/b.pptx`],
  );
});

test('safe file names keep their extension and never start with dots', () => {
  assert.equal(safeName('a/b:c*.pptx'), 'a b c .pptx');
  assert.equal(safeName('..'), 'file');
  assert.equal(safeName('../../etc'), 'etc');
  const long = `${'x'.repeat(200)}.pptx`;
  assert.equal(safeName(long).length, 120);
  assert.ok(safeName(long).endsWith('.pptx'));
});

test('ZIP entry times are Vietnam time', () => {
  // 2026-11-21 15:30:10 UTC is 22:30:10 in Vietnam.
  const { time, day } = dosTime(new Date('2026-11-21T15:30:10Z'));
  assert.equal(time >> 11, 22);
  assert.equal((time >> 5) & 63, 30);
  assert.equal(day & 31, 21);
  assert.equal((day >> 5) & 15, 11);
  assert.equal((day >> 9) + 1980, 2026);
});
