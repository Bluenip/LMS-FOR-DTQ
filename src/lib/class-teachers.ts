import type { Classroom, User } from './types';

/** Older JSON snapshots predate teacher assignments and keep their original teacher. */
export function assignedTeacherIds(classroom: Classroom): string[] {
  return classroom.teacherIds ?? [classroom.teacherId];
}

/** The creator retains management access independently of the public teaching roster. */
export function managesClass(classroom: Classroom, user: Pick<User, 'id' | 'role'>): boolean {
  return (
    user.role === 'TEACHER' &&
    (classroom.teacherId === user.id || assignedTeacherIds(classroom).includes(user.id))
  );
}

export function classTeacherNames(classroom: Classroom, users: User[]): string {
  const names = assignedTeacherIds(classroom)
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => !!name);
  return names.join(', ') || 'Chưa phân công giáo viên';
}
