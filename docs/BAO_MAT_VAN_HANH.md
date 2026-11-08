# Bảo mật và vận hành

Tổng hợp các biện pháp bảo mật, hiệu năng và vận hành hiện có, cùng cách cấu hình và kiểm thử. Nghiệp vụ xem [NGHIEP_VU.md](NGHIEP_VU.md), Google Drive xem [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md), triển khai xem [DEPLOYMENT.md](DEPLOYMENT.md).

## Biến môi trường liên quan

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `TRUST_PROXY_HEADERS` | `true` trong `compose.production.yml` | Tin `CF-Connecting-IP` / `X-Forwarded-For` để biết IP khách. Cổng app chỉ mở loopback nên đúng với mô hình tunnel/proxy. Nếu `false`, mọi khách dùng chung một bộ đếm đăng nhập theo email (ai cũng khóa được tài khoản người khác bằng 20 lần sai) và app ghi cảnh báo khi khởi động |
| `DRIVE_PRUNE_INTERVAL_MINUTES` | `60` | Chu kỳ dọn tệp mồ côi trên Drive; `0` để tắt |
| `LMS_DATA_DIR` | `.data` | Thư mục dữ liệu chế độ demo (JSON) và khóa phiên; dùng cho test để không đụng dữ liệu thật |
| `TEST_DATABASE_URL` | (trống) | Cho phép các test chạy với PostgreSQL thật (chỉ chấp nhận máy cục bộ; các bảng bị xóa sạch) |

## Đã có

- **Đăng nhập:** truy vấn một tài khoản theo email (1 ms thay vì đọc cả DB), thời gian phản hồi như nhau dù email có tồn tại hay không, giới hạn 20 lần/15 phút lưu trong PostgreSQL (`RequestLimit`, cập nhật nguyên tử, dùng chung nhiều bản chạy; nếu DB lỗi thì dùng bộ đếm trong bộ nhớ).
- **Header bảo mật** (`next.config.ts`): `Content-Security-Policy` (chỉ cho phép chính nó, Google Drive/googleapis, YouTube), `Strict-Transport-Security` (production), `Permissions-Policy`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`. `script-src` cần `'unsafe-inline'` vì Next.js App Router nhúng script khởi tạo; muốn bỏ phải chuyển mọi trang sang kết xuất động với nonce. Đã kiểm tra trong Chrome thật: không có vi phạm CSP khi đăng nhập, duyệt các trang, phát video Drive, tải tệp lên Drive và mở trình xem PDF.
- **Nhật ký quản trị** (`AuditLog`), xem ở `/admin`; **thu hồi quyền admin** bằng `npm run account:revoke-admin`, từ chối thu hồi admin cuối cùng.
- **Kiểm tra phiên bản chỉnh sửa** trong `runActionStrict` (mọi dữ liệu người dùng đi qua đây).
- **Tệp Drive:** quyền sửa tệp học viên chỉ thuộc chủ tệp/admin; kiểm tra định dạng sâu cho DOCX/PPTX; dọn tệp mồ côi; ngắt kết nối giữ thư mục.

## Hiệu năng

- `GET /api/state`: truy vấn theo phạm vi của người dùng (~23 ms trên 35 nghìn dòng) + `ETag`/304.
- Hành động ghi chỉ nạp đúng các bảng cần dùng. Đo trên PostgreSQL thật, ~35 nghìn dòng: hoàn thành bài học **354 → 35 ms**, bình luận **352 → 103 ms**, đánh dấu đã đọc **352 → 185 ms**. Vì mọi thao tác ghi xếp hàng qua một khóa toàn cục, thời gian mỗi lần ghi quyết định thông lượng.
- Hành động chưa khai báo bảng (rộng, hiếm như xóa lớp) vẫn nạp tất cả. Thêm hành động mới: khai báo trong `ACTION_TABLES` rồi chạy `tests/action-tables.test.ts`.
- Chỉ mục mới: `Progress(lessonId)`, `Note(lessonId)`, `Enrollment(userId)`, `Submission(studentId)`.
- Các cột thời gian là `TIMESTAMPTZ` (migration `20261104100000_timestamptz`, đã thử trên dữ liệu cũ 20 000 dòng); ứng dụng vẫn dùng chuỗi ISO.

## Migration mới

| Migration | Nội dung |
|---|---|
| `20261104090000_hardening` | Chỉ mục `Progress/Note/Submission`, bảng `DriveTrash`, `AuditLog` (`announcedAt`, `RequestLimit` đến từ migration của nhánh main) |
| `20261104100000_timestamptz` | 22 cột thời gian từ `TEXT` sang `TIMESTAMPTZ(3)` |

Chạy `npm run db:migrate`. Với dữ liệu thật nên sao lưu trước; chuyển đổi cột nhanh với vài chục nghìn dòng nhưng khóa bảng trong lúc chạy.

## Kiểm thử

```bash
npm test                      # đơn vị + route (route cần `npm run build` mới nhất, nếu cũ sẽ tự bỏ qua)
# PostgreSQL thật:
docker run -d --name lms-pg-test -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=lms postgres:17-alpine
DATABASE_URL=postgresql://postgres:test@localhost:55432/lms npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/lms npm test
```

Các nhóm test: `hardening` (lỗi nghiệp vụ, hàng đợi xóa, giới hạn, audit), `drive-maintenance` (dọn dẹp, quyền sửa tệp, ngắt kết nối), `postgres` (SQL dùng chung, truy vấn email, kiểu thời gian), `routes` (khởi động server thật: header, đăng nhập, ETag/304, Origin, DELETE không body...).

## Còn lại / quyết định có chủ ý

- Giới hạn tần suất cho xem/tải tệp (mức cao, để tua video) và thao tác admin vẫn trong bộ nhớ từng bản chạy.
- Chỉ video bài giảng công khai theo liên kết (Drive Preview cần); học liệu và bài làm học viên riêng tư, mở qua app. Hạn mức dung lượng 10 GiB/tài khoản, 100 GiB/lớp (cấu hình được).
- Thăm dò 3 giây vẫn là cơ chế đồng bộ (đã giảm tải bằng ETag); đẩy thời gian thực (SSE) là bước tiếp theo nếu cần.
- Mỗi lần ghi vẫn xếp hàng qua một khóa toàn cục; việc nạp từng phần giảm thời gian giữ khóa nhưng chưa chia khóa theo lớp.

> Sau khi gộp `main`: nạp dữ liệu theo lớp (`withClassScope`), dấu vân tay trạng thái/304 và giới hạn tần suất dùng chung (`RequestLimit`) dùng bản của `main`; phần của nhánh này là Google Drive, nhật ký quản trị, dọn tệp mồ côi. Các thao tác Drive vẫn đọc toàn bộ dữ liệu (`withDatabase`) và có thể được chuyển sang nạp theo lớp sau.
