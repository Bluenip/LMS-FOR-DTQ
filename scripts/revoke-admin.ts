import { emailSchema } from '../src/lib/server/accounts';
import { recordAudit, withDatabase } from '../src/lib/server/repository';

/** Usage: npm run account:revoke-admin -- email@example.com. Refuses to remove the last administrator. */
async function main() {
  const email = emailSchema.parse(process.argv[2]);
  const result = await withDatabase((db) => {
    const user = db.users.find((entry) => entry.email.toLowerCase() === email);
    if (!user) throw new Error('Không tìm thấy tài khoản với email này.');
    if (!user.isAdmin) return { changed: false };
    const admins = db.users.filter((entry) => entry.isAdmin && entry.disabled !== true);
    if (admins.length <= 1)
      throw new Error(
        'Đây là quản trị viên cuối cùng. Hãy cấp quyền cho người khác trước khi thu hồi.',
      );
    user.isAdmin = false;
    // Sign the account out everywhere so the removed privilege cannot be used from an old session.
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    return { changed: true };
  }, true);
  if (result.changed) await recordAudit('script', 'admin.revoke', undefined, `email=${email}`);
  console.log(
    result.changed
      ? `Đã thu hồi quyền quản trị của ${email}. Tài khoản bị đăng xuất khỏi mọi phiên.`
      : `${email} không có quyền quản trị.`,
  );
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error((error as Error).message);
    process.exit(1);
  },
);
