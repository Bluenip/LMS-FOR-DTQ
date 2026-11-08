import { managesClass } from '@/lib/class-teachers';
import { PRACTICE_ITEM_IDS, PRACTICE_TOTAL } from '@/lib/practice';
import type { Assignment, Database, StoredUser } from '@/lib/types';
import { HttpError } from './auth';

/** Share of the total score: practice tick sheets and graded assignments count equally. */
export const PRACTICE_WEIGHT = 0.5;
export const ASSIGNMENT_WEIGHT = 0.5;
/** A graded assignment is out of 100 (40 + 40 + 20 rubric points). */
const ASSIGNMENT_MAX = 100;

export interface RankRow {
  userId: string;
  name: string;
  group: number;
  leader: boolean;
  /** Ticked practice items (of PRACTICE_TOTAL per lesson). */
  done: number;
  possible: number;
  /** Practice score, 0-100. */
  percent: number;
  /** Average of the graded assignments in scope, 0-100; null when none counts yet. */
  assignmentPercent: number | null;
  assignmentsCounted: number;
  /** Final score, 0-100: practice and assignments weighted equally (practice alone without any). */
  total: number;
  /** Lessons the learner marked as completed. */
  studied: number;
  rank: number;
}
export interface Ranking {
  classId: string;
  title: string;
  lessons: { id: string; order: number; title: string }[];
  /** Whole class: every published lesson and every assignment together. */
  overall: RankRow[];
  /** Per lesson: its practice sheets and the assignments attached to it. */
  byLesson: Record<string, RankRow[]>;
}

/** 1, 2, 2, 4: equal scores share a place. */
function place<T extends { total: number; studied: number }>(rows: T[]) {
  const ranked: (T & { rank: number })[] = [];
  rows.forEach((row, i) => {
    const before = ranked[i - 1];
    const tied = before && before.total === row.total && before.studied === row.studied;
    ranked.push({ ...row, rank: tied ? before.rank : i + 1 });
  });
  return ranked;
}

/**
 * Ranking of a class, for teachers of the class and administrators only. Learners never receive it
 * (not even their own place), so it cannot be used to compare individuals.
 *
 * Score = 50% practice (ticked items / 13 per lesson) + 50% assignments. An assignment counts once
 * it is published and past its deadline: its returned grade (0-100), or 0 if the learner has no
 * returned grade yet. Where nothing counts (a lesson without assignments, a class before the first
 * deadline) the score is the practice score alone, the same rule for every member.
 */
export function rankingFor(
  db: Database,
  user: StoredUser,
  classId: string,
  at = Date.now(),
): Ranking {
  const classroom = db.classes.find((c) => c.id === classId);
  if (!classroom) throw new HttpError(404, 'Không tìm thấy lớp học.');
  if (!user.isAdmin && !managesClass(classroom, user))
    throw new HttpError(403, 'Chỉ giáo viên của lớp và quản trị viên được xem bảng xếp hạng.');
  const lessons = db.lessons
    .filter((l) => l.classId === classId && l.published)
    .sort((a, b) => a.order - b.order);
  const members = db.enrollments.filter((e) => e.classId === classId && e.status === 'APPROVED');
  const name = (id: string) => db.users.find((u) => u.id === id)?.name || 'Học viên';
  // Index the sheets, progress and grades once: a class has members x lessons lookups to answer.
  const sheets = new Map(db.practiceChecks.map((p) => [`${p.lessonId}:${p.studentId}`, p]));
  const completed = new Set(
    db.progress.filter((p) => p.completed).map((p) => `${p.lessonId}:${p.userId}`),
  );
  const assignmentIds = new Set(
    db.assignments.filter((a) => a.classId === classId).map((a) => a.id),
  );
  const grades = new Map(
    db.submissions
      .filter(
        (s) =>
          assignmentIds.has(s.assignmentId) && s.status === 'GRADED' && typeof s.score === 'number',
      )
      .map((s) => [`${s.assignmentId}:${s.studentId}`, s.score as number]),
  );
  const counted = (a: Assignment) =>
    a.classId === classId && a.published !== false && Date.parse(a.dueAt) <= at;
  const classAssignments = db.assignments.filter(counted);
  const ticks = (lessonId: string, studentId: string) =>
    new Set(
      (sheets.get(`${lessonId}:${studentId}`)?.items ?? []).filter((i) => PRACTICE_ITEM_IDS.has(i)),
    ).size;
  const studiedIn = (lessonId: string, studentId: string) =>
    completed.has(`${lessonId}:${studentId}`);
  const assignmentPercent = (studentId: string, list: Assignment[]) =>
    list.length
      ? Math.round(
          (list.reduce((sum, a) => sum + (grades.get(`${a.id}:${studentId}`) ?? 0), 0) /
            (list.length * ASSIGNMENT_MAX)) *
            100,
        )
      : null;

  const row = (
    e: (typeof members)[number],
    done: number,
    studied: number,
    lessonCount: number,
    assignments: Assignment[],
  ): Omit<RankRow, 'rank'> => {
    const percent = lessonCount ? Math.round((done / (PRACTICE_TOTAL * lessonCount)) * 100) : 0;
    const graded = assignmentPercent(e.userId, assignments);
    return {
      userId: e.userId,
      name: name(e.userId),
      group: e.group,
      leader: e.leader === true,
      done,
      possible: PRACTICE_TOTAL * lessonCount,
      percent,
      assignmentPercent: graded,
      assignmentsCounted: assignments.length,
      total:
        graded === null
          ? percent
          : Math.round(percent * PRACTICE_WEIGHT + graded * ASSIGNMENT_WEIGHT),
      studied,
    };
  };
  const order = (rows: Omit<RankRow, 'rank'>[]) =>
    rows.sort(
      (a, b) => b.total - a.total || b.studied - a.studied || a.name.localeCompare(b.name, 'vi'),
    );

  const byLesson: Record<string, RankRow[]> = {};
  for (const lesson of lessons) {
    const own = classAssignments.filter((a) => a.lessonId === lesson.id);
    byLesson[lesson.id] = place(
      order(
        members.map((e) =>
          row(e, ticks(lesson.id, e.userId), studiedIn(lesson.id, e.userId) ? 1 : 0, 1, own),
        ),
      ),
    );
  }
  const overall = place(
    order(
      members.map((e) =>
        row(
          e,
          lessons.reduce((sum, l) => sum + ticks(l.id, e.userId), 0),
          lessons.filter((l) => studiedIn(l.id, e.userId)).length,
          lessons.length,
          classAssignments,
        ),
      ),
    ),
  );
  return {
    classId,
    title: classroom.title,
    lessons: lessons.map((l) => ({ id: l.id, order: l.order, title: l.title })),
    overall,
    byLesson,
  };
}
