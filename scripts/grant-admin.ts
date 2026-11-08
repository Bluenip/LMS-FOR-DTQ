import { emailSchema } from '../src/lib/server/accounts';
import { isDemoAccount } from '../src/lib/server/auth';
import { recordAudit, withDatabase } from '../src/lib/server/repository';

async function main() {
  const email = emailSchema.parse(process.argv[2]);
  const result = await withDatabase((db) => {
    const user = db.users.find((entry) => entry.email.toLowerCase() === email);
    if (!user) throw new Error('Email chưa có tài khoản. Hãy cấp tài khoản đang hoạt động trước.');
    if (isDemoAccount(user) || user.emailVerified === false || user.disabled)
      throw new Error('Chỉ cấp quản trị cho tài khoản thật đã kích hoạt và đang hoạt động.');
    if (user.isAdmin) return { email, changed: false };
    user.isAdmin = true;
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    const now = new Date().toISOString();
    db.authTokens.forEach((token) => {
      if (token.userId === user.id && !token.consumedAt) token.consumedAt = now;
    });
    return { email, changed: true };
  }, true);
  if (result.changed) await recordAudit('script', 'admin.grant', undefined, `email=${email}`);
  console.log(
    result.changed
      ? `Đã cấp quyền quản trị cho ${email}. Đăng nhập lại để mở /admin. Quyền giảng dạy được giữ nguyên.`
      : `${email} đã có quyền quản trị.`,
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
