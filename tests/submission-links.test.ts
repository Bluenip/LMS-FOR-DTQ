import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../src/lib/server/actions';
import { seedData } from '../src/lib/server/seed-data';
import {
  canvaEmbedUrl,
  isCanvaEditLink,
  linkKind,
  parseSubmissionLinks,
} from '../src/lib/submission-links';
import type { Assignment, Submission } from '../src/lib/types';

process.env.LMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'submission-links-'));
delete process.env.DATABASE_URL;

function fixture() {
  const db = seedData();
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const student = db.users.find((u) => u.id === 'student-1')!;
  const classroom = runAction(db, teacher, {
    action: 'createClass',
    title: 'Lớp liên kết',
    autoApprove: true,
  }) as { id: string; code: string };
  runAction(db, student, { action: 'joinClass', code: classroom.code });
  const a = runAction(db, teacher, {
    action: 'createAssignment',
    classId: classroom.id,
    title: 'Thuyết trình',
    instructions: '',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    minWords: 150,
  }) as Assignment;
  const submit = (link: string) =>
    runAction(db, student, {
      action: 'submitAssignment',
      assignmentId: a.id,
      link,
      pledge: true,
    }) as Submission;
  return { submit };
}

test('several links are stored one per line, blank lines dropped, and count as evidence', () => {
  const { submit } = fixture();
  const s = submit(
    ' https://www.canva.com/design/DAF1/abc/view \n\nhttps://youtu.be/abcdefghijk\n',
  );
  assert.equal(s.status, 'SUBMITTED');
  assert.deepEqual(parseSubmissionLinks(s.link), [
    'https://www.canva.com/design/DAF1/abc/view',
    'https://youtu.be/abcdefghijk',
  ]);
});

test('every link must be a web address and at most five are accepted', () => {
  const { submit } = fixture();
  assert.throws(() => submit('https://example.com\njavascript:alert(1)'), /http/);
  assert.throws(
    () => submit(Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`).join('\n')),
    /tối đa 5/,
  );
});

test('Canva links are recognised and only shared view links are embedded', () => {
  assert.equal(linkKind('https://www.canva.com/design/DAF1/abc/edit'), 'canva');
  assert.equal(linkKind('https://canva.link/xyz'), 'canva');
  assert.equal(linkKind('https://docs.google.com/presentation/d/1/edit'), 'slides');
  assert.equal(linkKind('https://example.com'), 'other');
  assert.equal(
    canvaEmbedUrl('https://www.canva.com/design/DAF1/abc/view?utm_content=x'),
    'https://www.canva.com/design/DAF1/abc/view?embed',
  );
  assert.equal(canvaEmbedUrl('https://www.canva.com/design/DAF1/abc/edit'), null);
  assert.equal(canvaEmbedUrl('https://evil.example/design/DAF1/abc/view'), null);
  assert(isCanvaEditLink('https://www.canva.com/design/DAF1/abc/edit?utm=1'));
  assert(!isCanvaEditLink('https://www.canva.com/design/DAF1/abc/view'));
});
