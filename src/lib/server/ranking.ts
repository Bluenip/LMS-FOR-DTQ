import { managesClass } from '@/lib/class-teachers';
import { PRACTICE_ITEM_IDS, PRACTICE_TOTAL } from '@/lib/practice';
import type { Database, StoredUser } from '@/lib/types';
import { HttpError } from './auth';

export interface RankRow {
  userId: string;
  name: string;
  group: number;
  leader: boolean;
  /** Ticked practice items (of PRACTICE_TOTAL per lesson). */
  done: number;
  possible: number;
  percent: number;
  /** Lessons the learner marked as completed. */
  studied: number;
  rank: number;
}
export interface Ranking {
  classId: string;
  title: string;
  lessons: { id: string; order: number; title: string }[];
  /** Whole class: every published lesson together. */
  overall: RankRow[];
  /** Per lesson. */
  byLesson: Record<string, RankRow[]>;
}

/** 1, 2, 2, 4: equal scores share a place. */
function place<T extends { done: number; studied: number }>(rows: T[]) {
  const ranked: (T & { rank: number })[] = [];
  rows.forEach((row, i) => {
    const before = ranked[i - 1];
    const tied = before && before.done === row.done && before.studied === row.studied;
    ranked.push({ ...row, rank: tied ? before.rank : i + 1 });
  });
  return ranked;
}

/**
 * Practice ranking of a class, for teachers of the class and administrators only. Learners never
 * receive it (not even their own place), so it cannot be used to compare individuals.
 */
export function rankingFor(db: Database, user: StoredUser, classId: string): Ranking {
  const classroom = db.classes.find((c) => c.id === classId);
  if (!classroom) throw new HttpError(404, 'Không tìm thấy lớp học.');
  if (!user.isAdmin && !managesClass(classroom, user))
    throw new HttpError(403, 'Chỉ giáo viên của lớp và quản trị viên được xem bảng xếp hạng.');
  const lessons = db.lessons
    .filter((l) => l.classId === classId && l.published)
    .sort((a, b) => a.order - b.order);
  const members = db.enrollments.filter((e) => e.classId === classId && e.status === 'APPROVED');
  const name = (id: string) => db.users.find((u) => u.id === id)?.name || 'Học viên';
  // Index the sheets and progress once: a class has members x lessons lookups to answer.
  const sheets = new Map(db.practiceChecks.map((p) => [`${p.lessonId}:${p.studentId}`, p]));
  const completed = new Set(
    db.progress.filter((p) => p.completed).map((p) => `${p.lessonId}:${p.userId}`),
  );
  const ticks = (lessonId: string, studentId: string) =>
    new Set(
      (sheets.get(`${lessonId}:${studentId}`)?.items ?? []).filter((i) => PRACTICE_ITEM_IDS.has(i)),
    ).size;
  const studiedIn = (lessonId: string, studentId: string) =>
    completed.has(`${lessonId}:${studentId}`);
  const order = <T extends { done: number; studied: number; name: string }>(rows: T[]) =>
    rows.sort(
      (a, b) => b.done - a.done || b.studied - a.studied || a.name.localeCompare(b.name, 'vi'),
    );
  const row = (
    e: (typeof members)[number],
    done: number,
    studied: number,
    lessonCount: number,
  ) => ({
    userId: e.userId,
    name: name(e.userId),
    group: e.group,
    leader: e.leader === true,
    done,
    possible: PRACTICE_TOTAL * lessonCount,
    percent: lessonCount ? Math.round((done / (PRACTICE_TOTAL * lessonCount)) * 100) : 0,
    studied,
  });
  const byLesson: Record<string, RankRow[]> = {};
  for (const lesson of lessons)
    byLesson[lesson.id] = place(
      order(
        members.map((e) =>
          row(e, ticks(lesson.id, e.userId), studiedIn(lesson.id, e.userId) ? 1 : 0, 1),
        ),
      ),
    );
  const overall = place(
    order(
      members.map((e) =>
        row(
          e,
          lessons.reduce((sum, l) => sum + ticks(l.id, e.userId), 0),
          lessons.filter((l) => studiedIn(l.id, e.userId)).length,
          lessons.length,
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
