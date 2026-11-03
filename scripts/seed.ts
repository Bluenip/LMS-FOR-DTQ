import { seedPostgres } from '../src/lib/server/repository';
seedPostgres()
  .then(() => {
    console.log(
      'Đã tạo dữ liệu minh họa. student@detuquy.vn / teacher@detuquy.vn, mật khẩu Demo@2026. Hãy thay tài khoản demo trước khi vận hành thực tế.',
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
