'use client';
import { use } from 'react';
import {
  ClassList,
  ClassDetail,
  LessonPage,
  AssignmentPage,
  MembersPage,
} from '@/components/student';
export default function ClassesRoute({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = use(params);
  if (!path.length) return <ClassList />;
  if (path[1] === 'lessons' && path[2])
    return <LessonPage key={path[2]} classId={path[0]} lessonId={path[2]} />;
  if (path[1] === 'assignments' && path[2])
    return <AssignmentPage key={path[2]} classId={path[0]} assignmentId={path[2]} />;
  if (path[1] === 'members') return <MembersPage classId={path[0]} />;
  return <ClassDetail classId={path[0]} />;
}
