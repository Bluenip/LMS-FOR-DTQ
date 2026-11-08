import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/lib/server/auth';
import { withDatabase } from '../src/lib/server/repository';
import { passwordSchema } from '../src/lib/server/accounts';
import { DEFAULT_ACCOUNT_PASSWORD } from '../src/lib/account-policy';

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
  // Same default as accounts created in /admin, unless a specific first password is supplied.
  const password = process.env.ACCOUNT_INITIAL_PASSWORD
    ? passwordSchema.parse(process.env.ACCOUNT_INITIAL_PASSWORD)
    : DEFAULT_ACCOUNT_PASSWORD;
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
      mustChangePassword: true,
      emailVerified: true,
      sessionVersion: 0,
      isDemo: false,
    });
  }, true);
  console.log(
    `Đã cấp tài khoản giáo viên: ${email}\n${process.env.ACCOUNT_INITIAL_PASSWORD ? 'Đã dùng mật khẩu khởi tạo riêng.' : `Mật khẩu đăng nhập lần đầu: ${DEFAULT_ACCOUNT_PASSWORD}.`} Giáo viên cần đổi mật khẩu khi đăng nhập.`,
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
