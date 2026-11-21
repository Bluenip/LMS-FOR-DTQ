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

/** The first assigned teacher leads the class; the rest assist. */
export function classTeacherRoster(
  classroom: Classroom,
  users: User[],
): { lead: string | null; assistants: string[] } {
  const names = assignedTeacherIds(classroom)
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => !!name);
  return { lead: names[0] ?? null, assistants: names.slice(1) };
}

const HONORIFICS = [
  'hoa thuong',
  'thuong toa',
  'dai duc',
  'ni su',
  'su thay',
  'su co',
  'giao vien',
  'thay',
  'co',
];

/** Lowercased, accent-free name with leading honorifics ("Thầy", "Sư cô", …) removed. */
function bareName(name: string): string {
  let value = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (let stripped = true; stripped;) {
    stripped = false;
    for (const honorific of HONORIFICS) {
      if (value.startsWith(`${honorific} `)) {
        value = value.slice(honorific.length + 1);
        stripped = true;
      }
    }
  }
  return value;
}

/** The content presenter is worth showing only when it is someone other than the lead teacher. */
export function contentAuthorDiffers(contentAuthor: string | undefined, lead: string | null) {
  if (!contentAuthor?.trim()) return false;
  return !lead || bareName(contentAuthor) !== bareName(lead);
}
