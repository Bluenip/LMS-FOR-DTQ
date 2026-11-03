# Kiểm thử PostgreSQL và kho tệp

`scripts/integration-test.mjs` chạy 72 bước kiểm tra HTTP trên một ứng dụng có PostgreSQL và kho S3 tương thích đang hoạt động. Chỉ dùng cơ sở dữ liệu và bucket dành riêng cho kiểm thử. Script tạo một lớp, thêm dữ liệu, rồi xóa lớp đó. Nếu một bước lỗi, lớp kiểm thử có thể còn lại để kiểm tra nguyên nhân. Tệp trong bucket kiểm thử có thể còn lại sau khi lớp bị xóa.

## Chuẩn bị

1. Cài các dependency trong dự án bằng `npm ci` với Node.js 22.
2. Khởi động PostgreSQL riêng, chẳng hạn `docker compose up -d postgres`.
3. Dùng bucket thử nghiệm riêng trong S3/R2, hoặc chạy kho S3 giả lập cục bộ bằng `docker compose --profile storage up -d --build`. Service `s3` tự tạo bucket `lms` tại `http://localhost:9000`, hai khóa đều là `S3RVER`, region `us-east-1`. Bộ giả lập này chỉ dùng cho phát triển/kiểm thử và không có trang quản trị.
4. Cấu hình `DATABASE_URL`, `SESSION_SECRET` (ít nhất 32 ký tự), `APP_URL` và các biến `S3_*` trong `.env` theo `.env.example`. `APP_URL` phải khớp URL ứng dụng kiểm thử. Bucket phải cho phép GET/PUT/HEAD khi kiểm thử thêm bằng trình duyệt; tham khảo `prisma/s3-cors.json`.
5. Chạy `npx prisma migrate deploy` và `npm run db:seed`. Seed chỉ chạy khi cơ sở dữ liệu trống. Các tài khoản kiểm thử mặc định là `teacher@detuquy.vn` và `student@detuquy.vn`, mật khẩu `Demo@2026`. Tài khoản mẫu bị chặn mặc định trên PostgreSQL: chỉ đặt `ALLOW_DEMO_ACCOUNTS=true` trong môi trường kiểm thử riêng này, hoặc cung cấp tài khoản thật qua các biến `INTEGRATION_*` bên dưới. Không bật tài khoản mẫu trên hệ thống public.
6. Chạy `APP_URL=http://localhost:3002 npm run dev -- --port 3002` hoặc một instance riêng với cấu hình tương ứng. Không chạy hai dev server trên cùng thư mục `.next`.

## Chạy

```bash
INTEGRATION_BASE_URL=http://localhost:3002 node scripts/integration-test.mjs
```

Có thể thay tài khoản bằng các biến sau; script không cần biết mật khẩu PostgreSQL hoặc khóa S3 của máy chủ:

```bash
INTEGRATION_BASE_URL=http://localhost:3002 \
INTEGRATION_TEACHER_EMAIL=teacher@example.com \
INTEGRATION_TEACHER_PASSWORD='test-teacher-password' \
INTEGRATION_STUDENT_EMAIL=student@example.com \
INTEGRATION_STUDENT_PASSWORD='test-student-password' \
node scripts/integration-test.mjs
```

Hai người dùng phải có quyền giáo viên/học viên tương ứng; dữ liệu trả về phải dùng PostgreSQL (`demo: false`). Không đặt các giá trị bí mật vào mã nguồn hoặc commit tệp `.env`.

Các bước kiểm tra gồm sửa yêu cầu số từ và bỏ mức tối đa, nhắc nộp/đánh dấu thông báo, cấu hình người giảng nội dung, xóa một bài tập và dữ liệu gắn với nó mà giữ bài khác/bài giảng, đăng nhập, phân quyền, tạo/sửa/tham gia lớp, lưu bài giảng, hoàn thành bài và ghi chú/thảo luận, tạo bài tập, từ chối tệp giả định dạng, tải PDF và đọc lại đúng byte qua URL ký, nộp bài, giữ riêng bài/tệp nháp, thu hồi và nộp lại không lộ hoặc tái sử dụng điểm nháp, trả điểm, tải video bằng URL ký và xác thực, chống ghi đè video đã xác thực bằng URL tải cũ, lưu trữ/khôi phục/xóa lớp cùng dữ liệu liên quan.

Fixture PDF/MP4 chỉ có byte nhận dạng tối thiểu để kiểm tra việc vận chuyển và xác thực tệp; chúng không phải tài liệu/video mẫu để phát trong giao diện.

## Kết quả chạy lại ngày 03/11/2026

Toàn bộ **72 kiểm tra đạt** trên ứng dụng production trong Docker của server đích, với Node.js 22.23.4, Next.js 16.4.4, Prisma 6.19.0, PostgreSQL 17.11 và S3rver 3.7.1. Database và bucket riêng cho kiểm thử; tài khoản giáo viên/học viên được cấp qua CLI/API, không bật tài khoản demo. Ứng dụng chạy UID 1000. Các kiểm tra mới bao gồm readiness, quyền đọc tệp/bài nháp, thu hồi/nộp lại, xóa điểm nháp thực sự trong PostgreSQL và từ chối chấm từ phiên bản bài nộp cũ.

Bộ giả lập dùng truy cập bucket theo đường dẫn (`vhostBuckets: false`) để hoạt động qua hostname service Docker. Bucket/IAM/CORS của AWS hoặc R2 thật chưa được kiểm tra. Bộ 72 bước dùng HTTP trong network Docker; HTTPS của ứng dụng được xác minh riêng sau triển khai, xem [CODE_REVIEW.md](CODE_REVIEW.md).

Đã nâng cấp riêng từ image production trước bản sửa lên schema mới với lớp/bài nộp/điểm mẫu. Bài đã trả 90 điểm, yêu cầu cũ và cookie đăng nhập vẫn dùng được; tắt PostgreSQL thử nghiệm làm healthcheck trả 503 và khởi động lại trả 200.

## Kết quả lịch sử

Ngày 02/11/2026, migration và seed đã chạy thành công trên một máy chủ PostgreSQL 18.6 tạm thời. Toàn bộ **36 bước HTTP đạt** với Next.js 16.4.4, Prisma 6.19.0 và máy chủ S3 tương thích `s3rver`. Các dependency chạy máy chủ kiểm thử được cài ở `/tmp`, không được thêm vào dependency của dự án.

Amazon S3 và Cloudflare R2 thật chưa được thử bằng thông tin xác thực dịch vụ. MinIO không được thực thi trong lượt kiểm thử này vì URL tải binary chính thức trả HTTP 410. Kết quả S3 ở trên xác nhận đường đi HTTP/SDK và byte tệp với máy chủ tương thích cục bộ, chưa thay thế kiểm thử cấu hình bucket/IAM/CORS của từng môi trường triển khai.
