import { hashPassword } from '../src/lib/server/auth';
import { withDatabase } from '../src/lib/server/repository';
import type { StoredUser } from '../src/lib/types';

/**
 * Local-only helper: adds real (non-demo) accounts to the JSON demo database so the Google Drive
 * flow can be tested end to end. The demo accounts cannot be administrators by design.
 */
if (process.env.DATABASE_URL) {
  console.error('local-setup chỉ dành cho chế độ demo JSON (DATABASE_URL phải để trống).');
  process.exit(1);
}
const PASSWORD = 'LocalTest@2026';
const accounts = [
  {
    id: 'local-admin',
    name: 'Quản trị viên (local)',
    email: 'admin@local.test',
    role: 'TEACHER',
    isAdmin: true,
  },
  {
    id: 'local-teacher',
    name: 'Giáo viên (local)',
    email: 'giaovien@local.test',
    role: 'TEACHER',
    isAdmin: false,
  },
  {
    id: 'local-student',
    name: 'Học viên (local)',
    email: 'hocvien@local.test',
    role: 'STUDENT',
    isAdmin: false,
  },
] as const;

async function main() {
  await withDatabase((db) => {
    for (const a of accounts) {
      if (db.users.some((u) => u.id === a.id)) continue;
      const user: StoredUser = {
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        passwordHash: hashPassword(PASSWORD),
        emailVerified: true,
        sessionVersion: 0,
        isDemo: false,
        isAdmin: a.isAdmin,
        disabled: false,
        mustChangePassword: false,
      };
      db.users.push(user);
    }
    if (!db.classes.some((c) => c.teacherId === 'local-teacher'))
      db.classes.push({
        id: 'local-class',
        title: 'Lớp thử Google Drive',
        description: 'Lớp dùng để thử tải video lên Google Drive.',
        contentAuthor: '',
        code: 'LH-LOCALTEST01',
        teacherId: 'local-teacher',
        teacherIds: [],
        revision: 'local-1',
        status: 'ACTIVE',
        capacity: 50,
        enrollmentOpen: true,
        autoApprove: true,
        schedule: '',
        cover: '',
        createdAt: new Date().toISOString(),
      });
    if (!db.enrollments.some((e) => e.classId === 'local-class' && e.userId === 'local-student'))
      db.enrollments.push({
        id: 'local-enrollment',
        classId: 'local-class',
        userId: 'local-student',
        status: 'APPROVED',
        group: 1,
        joinedAt: new Date().toISOString(),
      });
  }, true);
  console.log(`Đã chuẩn bị tài khoản local (mật khẩu chung: ${PASSWORD}):`);
  for (const a of accounts) console.log(`  ${a.email}${a.isAdmin ? '  (quản trị)' : ''}`);
  console.log(
    'Lớp thử: "Lớp thử Google Drive" (giáo viên: giaovien@local.test, học viên đã được duyệt).',
  );
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);
