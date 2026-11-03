import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_PASSWORD } from '../src/lib/account-policy';
import { hashPassword } from '../src/lib/server/auth';
import { withDatabase } from '../src/lib/server/repository';

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Cấu hình DATABASE_URL trước khi cấp tài khoản giáo viên.');
  const [rawEmail, ...nameParts] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  const name = nameParts.join(' ').trim();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 200 ||
    name.length < 2 ||
    name.length > 100
  ) {
    throw new Error(
      'Cách dùng: npm run account:create-teacher -- email@example.com "Họ tên giáo viên"',
    );
  }
  const password = DEFAULT_ACCOUNT_PASSWORD;
  const passwordHash = hashPassword(password);
  await withDatabase((db) => {
    if (db.users.some((user) => user.email.toLowerCase() === email)) {
      throw new Error(
        'Email đã có tài khoản. Không thay đổi vai trò hoặc mật khẩu của tài khoản hiện có.',
      );
    }
    db.users.push({
      id: randomUUID(),
      name,
      email,
      role: 'TEACHER',
      passwordHash,
      emailVerified: true,
      sessionVersion: 0,
      isDemo: false,
    });
  }, true);
  console.log(
    `Đã cấp tài khoản giáo viên: ${email}\nMật khẩu mặc định: ${password}\nGiáo viên đổi mật khẩu tại Thông tin cá nhân sau khi đăng nhập.`,
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
