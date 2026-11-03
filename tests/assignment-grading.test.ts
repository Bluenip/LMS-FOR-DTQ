import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentCsv,
  assignmentCsvFilename,
  assignmentRows,
  assignmentStats,
  submissionStatus,
} from '../src/lib/assignment-grading';
import { seedData } from '../src/lib/server/seed-data';
import { stateFor } from '../src/lib/server/actions';
import type { Submission } from '../src/lib/types';

function csvRows(csv: string) {
  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"' && quoted && csv[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      rows.at(-1)!.push(cell);
      cell = '';
    } else if (c === '\r' && csv[i + 1] === '\n' && !quoted) {
      rows.at(-1)!.push(cell);
      rows.push([]);
      cell = '';
      i++;
    } else cell += c;
  }
  rows.at(-1)!.push(cell);
  return rows;
}

test('gradebook counts approved students, distinguishes zero drafts, and exports only returned grades', () => {
  const db = seedData();
  const teacher = db.users[0];
  const assignment = db.assignments[0];
  const classroom = db.classes[0];
  const studentIds = db.enrollments.filter((e) => e.classId === classroom.id).map((e) => e.userId);
  db.enrollments.filter((e) => e.classId === classroom.id).forEach((e) => (e.status = 'APPROVED'));
  const base: Omit<Submission, 'id' | 'studentId' | 'status'> = {
    assignmentId: assignment.id,
    content: '',
    link: '',
    attachments: [],
    attempt: 1,
    feedback: '',
    submittedAt: '2026-01-01T00:00:00.000Z',
  };
  db.submissions = [
    { ...base, id: 'one', studentId: studentIds[0], status: 'SUBMITTED' },
    { ...base, id: 'two', studentId: studentIds[1], status: 'SUBMITTED', score: 0 },
    { ...base, id: 'three', studentId: studentIds[2], status: 'GRADED', score: 90 },
    { ...base, id: 'four', studentId: studentIds[3], status: 'DRAFT', score: 50 },
    { ...base, id: 'outsider', studentId: 'outside', status: 'GRADED', score: 100 },
  ];
  const state = stateFor(db, teacher);
  // A draft is also ignored if supplied by a future data source.
  state.submissions.push(db.submissions[3]);
  const rows = assignmentRows(state, assignment);
  assert.deepEqual(assignmentStats(rows), {
    total: 4,
    submitted: 3,
    pending: 2,
    graded: 1,
    missing: 1,
    average: 90,
  });
  assert.equal(submissionStatus(rows[1].submission), 'Chờ chấm · Có điểm nháp');
  const csv = csvRows(assignmentCsv(rows, classroom, assignment, () => 'ngày nộp').slice(1));
  assert.deepEqual(csv[0], [
    'Học viên',
    'Email',
    'Trạng thái',
    'Điểm',
    'Nộp lúc',
    'Lớp',
    'Bài tập',
  ]);
  assert.deepEqual(
    csv.slice(1).map((r) => [r[2], r[3], r[4]]),
    [
      ['Chờ chấm', '', 'ngày nộp'],
      ['Chờ chấm · Có điểm nháp', '', 'ngày nộp'],
      ['Đã chấm', '90', 'ngày nộp'],
      ['Chưa nộp', '', ''],
    ],
  );
  rows[1].submission!.status = 'GRADED';
  assert.equal(assignmentStats(rows).average, 45);
  assert.equal(csvRows(assignmentCsv(rows, classroom, assignment, () => '').slice(1))[2][3], '0');
  rows[2].submission!.score = undefined;
  assert.equal(assignmentStats(rows).average, 0);
});

test('CSV handles Vietnamese, commas, quotes, newlines, formulas and distinct assignment IDs', () => {
  const db = seedData();
  const assignment = { ...db.assignments[0], title: 'Cảm ngộ, "bài"\n2' };
  const classroom = db.classes[0];
  const student = { ...db.users[1], name: '  =1+1, "Ngọc"\nMai' };
  const csv = assignmentCsv(
    [{ user: student, studentId: student.id }],
    classroom,
    assignment,
    () => '',
  );
  assert.equal(csv[0], '\uFEFF');
  const parsed = csvRows(csv.slice(1));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1][0], `'${student.name}`);
  assert.equal(parsed[1][6], assignment.title);
  assert.match(assignmentCsvFilename(classroom, assignment), new RegExp(classroom.code));
  assert.notEqual(
    assignmentCsvFilename(classroom, assignment),
    assignmentCsvFilename(classroom, { ...assignment, id: 'another-id' }),
  );
  assert.equal(csvRows(assignmentCsv([], classroom, assignment, () => '').slice(1)).length, 1);
});
