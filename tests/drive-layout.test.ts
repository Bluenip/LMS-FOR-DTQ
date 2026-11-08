import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlacement } from '../src/lib/server/drive-service';
import type { Database, DriveUpload } from '../src/lib/types';

const job = (over: Partial<DriveUpload>): DriveUpload =>
  ({
    id: 'j',
    ownerId: 'u1',
    classId: 'c1',
    kind: 'video',
    name: 'raw.mp4',
    mimeType: 'video/mp4',
    size: 1,
    title: '',
    description: '',
    status: 'COMPLETED',
    bytesUploaded: 1,
    driveFileId: 'drive-j',
    shared: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as DriveUpload;
const db = (uploads: DriveUpload[]) =>
  ({
    users: [{ id: 'u1', name: 'An', email: 'an@x.vn' }],
    classes: [{ id: 'c1', title: 'Lớp Sơ cấp' }],
    lessons: [{ id: 'l1', classId: 'c1', order: 1, title: 'Bài 1: Hiếu kính', documents: [] }],
    assignments: [{ id: 'a1', classId: 'c1', lessonId: 'l1', title: 'Chia sẻ tâm đắc' }],
    driveConnections: [{ id: 'google-drive', folderId: 'root' }],
    driveUploads: uploads,
  }) as unknown as Database;

test('learner video: assignment - lesson number - Video n, in the learner folder of the lesson', () => {
  const plan = planPlacement(db([job({ assignmentId: 'a1' })]), 'j')!;
  assert.equal(plan.name, 'Chia sẻ tâm đắc - Bài 1 - Video 1.mp4');
  assert.deepEqual(
    plan.path.map((p) => p.name),
    ['Lớp Sơ cấp', 'Bài 1 - Hiếu kính', 'An - an@x.vn'],
  );
});

test('numbers continue after the highest existing one, per kind', () => {
  const earlier = [
    job({ id: 'e1', assignmentId: 'a1', name: 'Chia sẻ tâm đắc - Bài 1 - Video 1.mp4' }),
    job({ id: 'e3', assignmentId: 'a1', name: 'Chia sẻ tâm đắc - Bài 1 - Video 3.mp4' }),
  ];
  const plan = planPlacement(db([...earlier, job({ assignmentId: 'a1' })]), 'j')!;
  assert.equal(plan.name, 'Chia sẻ tâm đắc - Bài 1 - Video 4.mp4');
  const image = job({ assignmentId: 'a1', kind: 'document', mimeType: 'image/png', name: 'x.png' });
  assert.equal(
    planPlacement(db([...earlier, image]), 'j')!.name,
    'Chia sẻ tâm đắc - Bài 1 - Ảnh 1.png',
  );
});

test('slides, other files and lesson materials', () => {
  const slide = job({
    kind: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    name: 'deck.pptx',
    lessonId: 'l1',
  });
  const plan = planPlacement(db([slide]), 'j')!;
  assert.equal(plan.name, 'Hiếu kính - Bài 1 - Slide.pptx');
  assert.deepEqual(
    plan.path.map((p) => p.name),
    ['Lớp Sơ cấp', 'Bài 1 - Hiếu kính'],
  );
  const doc = job({ kind: 'document', mimeType: 'application/pdf', name: 'a.pdf', lessonId: 'l1' });
  assert.equal(planPlacement(db([doc]), 'j')!.name, 'Hiếu kính - Bài 1 - File 1.pdf');
});

test('an upload with no lesson or assignment yet is left alone', () => {
  assert.equal(planPlacement(db([job({})]), 'j'), null);
});
