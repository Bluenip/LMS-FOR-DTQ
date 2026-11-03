'use client';
import { usePathname } from 'next/navigation';
import { TeacherAssignments, TeacherClasses, TeacherLessons } from '@/components/teacher';
import { useLms } from '@/components/lms-provider';
import { Empty } from '@/components/ui';
export default function TeacherPage() {
  const path = usePathname();
  const { state } = useLms();
  if (state.user.role !== 'TEACHER')
    return (
      <Empty
        title="Trang dành cho giáo viên"
        description="Đăng nhập bằng tài khoản giáo viên để quản lý giảng đường."
      />
    );
  if (path.endsWith('/lessons')) return <TeacherLessons />;
  if (path.endsWith('/assignments')) return <TeacherAssignments />;
  return <TeacherClasses />;
}
