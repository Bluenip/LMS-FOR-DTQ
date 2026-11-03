import type { Database } from '@/lib/types';
import { hashPassword } from './auth';
export function seedData(): Database {
  const now = new Date().toISOString();
  const teacher = {
    id: 'teacher-1',
    name: 'Giáo viên Tuệ Tâm',
    email: 'teacher@detuquy.vn',
    role: 'TEACHER' as const,
    passwordHash: hashPassword('Demo@2026'),
    emailVerified: true,
    sessionVersion: 0,
    isDemo: true,
  };
  const students = [
    ['student-1', 'Nguyễn Văn An', 'student@detuquy.vn'],
    ['student-2', 'Trần Thị Minh Châu', 'chau@detuquy.vn'],
    ['student-3', 'Lê Hoàng Nam', 'nam@detuquy.vn'],
    ['student-4', 'Phạm Ngọc Mai', 'mai@detuquy.vn'],
  ].map(([id, name, email]) => ({
    id,
    name,
    email,
    role: 'STUDENT' as const,
    passwordHash: hashPassword('Demo@2026'),
    emailVerified: true,
    sessionVersion: 0,
    isDemo: true,
  }));
  const classId = 'dtq-2026';
  const titles = [
    'Tổng tự – Đệ Tử Quy, Thánh nhân huấn',
    'Nhập tắc hiếu – Cha mẹ gọi, trả lời ngay',
    'Nhập tắc hiếu – Đông phải ấm, hạ phải mát',
    'Xuất tắc đễ – Anh thương em, em kính anh',
    'Cẩn – Sáng dậy sớm, tối ngủ trễ',
    'Tín – Phàm nói ra, tín trước tiên',
    'Phiếm ái chúng – Phàm là người, đều yêu thương',
    'Thân nhân – Gần người nhân, tốt vô hạn',
  ];
  const lessons = titles.map((title, index) => ({
    id: `lesson-${index + 1}`,
    classId,
    title,
    chapter: index < 3 ? 'Nhập tắc hiếu' : index < 5 ? 'Xuất tắc đễ' : 'Cẩn và tín',
    order: index + 1,
    description:
      index === 0
        ? 'Đệ Tử Quy, Thánh nhân huấn. Thủ hiếu đễ, thứ cẩn tín. Phiếm ái chúng, nhi thân nhân. Hữu dư lực, tắc học văn.\n\nCùng tìm hiểu những lời dạy về đạo làm người và thực hành trong cuộc sống hằng ngày.'
        : 'Lắng nghe bài giảng, ghi lại điều tâm đắc và thực hành bằng những việc làm cụ thể trong gia đình.',
    videoType: 'YOUTUBE' as const,
    videoUrl: '',
    duration: '',
    published: index < 4,
    timestamps: [],
    documents: [],
    createdAt: now,
  }));
  return {
    users: [teacher, ...students],
    classes: [
      {
        id: classId,
        title: 'Đệ Tử Quy – Nhập Tắc Hiếu',
        description:
          'Học đạo làm con, nuôi dưỡng lòng hiếu kính. Cùng học, cùng thực hành những lời dạy của Thánh hiền trong cuộc sống hằng ngày.',
        code: 'DTQ-2026',
        teacherId: teacher.id,
        teacherIds: [teacher.id],
        status: 'ACTIVE',
        capacity: 50,
        enrollmentOpen: true,
        autoApprove: false,
        schedule: 'Thứ 3 và Thứ 5, 19:30 – 21:00',
        cover: '',
        createdAt: now,
      },
      {
        id: 'dtq-tin',
        title: 'Thập Thiện – Thực hành điều lành',
        description: 'Cùng học và thực hành những điều lành trong đời sống hằng ngày.',
        code: 'DTQ-TIN26',
        teacherId: teacher.id,
        teacherIds: [teacher.id],
        status: 'ACTIVE',
        capacity: 40,
        enrollmentOpen: true,
        autoApprove: true,
        schedule: 'Thứ 7, 19:30 – 21:00',
        cover: '',
        createdAt: now,
      },
    ],
    enrollments: students.map((u, i) => ({
      id: `enrollment-${i + 1}`,
      userId: u.id,
      classId,
      status: i === 3 ? 'PENDING' : 'APPROVED',
      group: (i % 4) + 1,
      joinedAt: now,
    })),
    lessons,
    assignments: [
      {
        id: 'assignment-1',
        classId,
        lessonId: 'lesson-2',
        title: 'Tâm đắc bài học: Đạo làm con',
        instructions:
          'Sau khi học bài “Cha mẹ gọi, trả lời ngay”, hãy viết một đoạn tâm đắc từ 300 đến 500 từ:\n\n1. Điều gì trong bài giảng khiến bạn suy ngẫm nhất?\n2. Kể một việc làm cụ thể thể hiện sự hiếu kính với cha mẹ.\n3. Bạn sẽ thay đổi thói quen nào trong tuần tới?\n\nCó thể viết trực tiếp hoặc đính kèm PDF, DOCX, JPG, PNG (tối đa 25 MB).',
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        allowLate: true,
        allowResubmit: true,
        maxAttempts: 2,
        minWords: 300,
        maxWords: 500,
        createdAt: now,
      },
    ],
    submissions: [
      {
        id: 'submission-chau',
        assignmentId: 'assignment-1',
        studentId: 'student-2',
        content:
          'Điều em tâm đắc nhất là sự hiếu kính bắt đầu từ những hành động nhỏ mỗi ngày. Khi cha mẹ gọi, em cần trả lời ngay bằng thái độ lễ phép. Em sẽ chủ động phụ giúp gia đình và lắng nghe cha mẹ nhiều hơn.',
        link: '',
        attachments: [],
        status: 'SUBMITTED',
        attempt: 1,
        submittedAt: now,
        feedback: '',
      },
    ],
    progress: [
      {
        id: 'progress-an-1',
        userId: 'student-1',
        lessonId: 'lesson-1',
        completed: true,
        bookmarked: false,
      },
    ],
    notes: [],
    discussions: [
      {
        id: 'discussion-1',
        userId: 'teacher-1',
        lessonId: 'lesson-1',
        content: 'Các em hãy chia sẻ một việc tốt mình đã làm cho cha mẹ trong tuần này nhé.',
        createdAt: now,
      },
    ],
    notifications: [],
    files: [],
    authTokens: [],
  };
}
