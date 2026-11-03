# Kiểm thử PostgreSQL và kho tệp

`scripts/integration-test.mjs` chạy 148 bước kiểm tra HTTP trên một ứng dụng có PostgreSQL và kho S3 tương thích đang hoạt động. Chỉ dùng cơ sở dữ liệu và bucket dành riêng cho kiểm thử. Script tạo một lớp, thêm dữ liệu, rồi xóa lớp đó. Nếu một bước lỗi, lớp kiểm thử có thể còn lại để kiểm tra nguyên nhân. Tệp trong bucket kiểm thử có thể còn lại sau khi lớp bị xóa.

## Chuẩn bị

1. Cài các dependency trong dự án bằng `npm ci` với Node.js 22 hoặc 24.
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

Các bước kiểm tra gồm sửa/xóa thảo luận theo quyền người viết/giáo viên, giữ thời điểm đăng và hiển thị dấu chỉnh sửa, chặn thao tác từ bản cũ, sửa yêu cầu số từ và bỏ mức tối đa, nhắc nộp/đánh dấu thông báo, cấu hình người giảng nội dung, xóa một bài tập và dữ liệu gắn với nó mà giữ bài khác/bài giảng, đăng nhập, phân quyền, tạo/sửa/tham gia lớp, lưu bài giảng, hoàn thành bài và ghi chú/thảo luận, tạo bài tập, từ chối tệp giả định dạng, tải PDF và đọc lại đúng byte qua URL ký, nộp bài, giữ riêng bài/tệp nháp, thu hồi và nộp lại không lộ hoặc tái sử dụng điểm nháp, trả điểm, tải video bằng URL ký và xác thực, chống ghi đè video đã xác thực bằng URL tải cũ, lưu trữ/khôi phục/xóa lớp cùng dữ liệu liên quan.

Fixture PDF/MP4 chỉ có byte nhận dạng tối thiểu để kiểm tra việc vận chuyển và xác thực tệp; chúng không phải tài liệu/video mẫu để phát trong giao diện.

## Kiểm chứng bản sửa báo cáo ngày 03/11/2026

Đã chạy **148 kiểm tra HTTP đạt** trên Docker riêng `lms-validation` ở máy chủ mới `100.71.200.54`: Node.js 22.23.4, PostgreSQL 17 và S3rver. Stack chỉ mở cổng ứng dụng trên loopback `3137`; database, bucket và tài khoản đều là dữ liệu giả. Không dùng database vận hành cho kiểm thử ghi.

Bổ sung kiểm tra lưu trạng thái công bố sau xóa bài giảng nháp, chỉ thông báo một lần sau công bố lại, từ chối xóa bài giảng/bài tập/lớp với revision cũ, giữ điểm nháp khi yêu cầu thu hồi đã cũ, bảo toàn bài nộp/điểm sau khi gắn sang bài giảng nháp, chặn nhắc bài ẩn, từ chối đưa học viên ra bằng lần tham gia cũ, hoàn tất upload lặp lại an toàn và cookie sao chép trả 401 sau đăng xuất.

Kiểm tra riêng trong PostgreSQL:

- Tám tiến trình Node cùng dùng một bộ đếm hạn mức 3: đúng 3 được chấp nhận, 5 bị chặn; tiến trình mới tiếp tục bị chặn. Đây là kiểm tra bộ đếm chung qua nhiều tiến trình.
- Khởi tạo database phụ bằng schema trước bản sửa, thêm dữ liệu giả rồi áp dụng hai migration mới: bản ghi còn nguyên, bài đang hiện được ghi nhận đã thông báo, bài gắn nháp vẫn ẩn và chưa thông báo.
- Prisma Client sinh từ schema trước bản sửa vẫn đọc/tạo/sửa/xóa được trên schema mới; chỉnh sửa bằng client cũ giữ nguyên các cột công bố mới. Đây là kiểm tra tương thích tầng dữ liệu, chưa phải diễn tập toàn bộ image cũ và phục hồi production.

## Đo tải trên dữ liệu giả

Script `scripts/load-test.mjs` yêu cầu cờ xác nhận môi trường bỏ được và URL loopback, dùng PostgreSQL thật, tạo lớp/bài giảng có tiền tố `Synthetic`, rồi dọn các lớp đó trong `finally`. Script không được dùng với ứng dụng vận hành, kể cả khi URL vận hành là localhost.

```bash
LMS_LOAD_TEST_DISPOSABLE=true \
LMS_LOAD_BASE_URL=http://127.0.0.1:3000 \
node scripts/load-test.mjs
```

Chạy lệnh trong container ứng dụng kiểm thử khi endpoint S3 dùng hostname Docker. Có thể đặt `LMS_LOAD_CLASSES`, `LMS_LOAD_LESSONS`, `LMS_LOAD_READS`, `LMS_LOAD_WRITES`, `LMS_LOAD_CONCURRENCY` và hai cặp tài khoản `INTEGRATION_*` giống script HTTP. Mặc định: 10 lớp, mỗi lớp 10 bài giảng, 200 lần đọc, 50 lần ghi, đồng thời 10 yêu cầu.

Kết quả một lượt trên máy chủ mới, 100 bài giảng giả và 2 tài khoản đăng nhập:

| Thao tác | Yêu cầu | Đồng thời | Lỗi | Yêu cầu/giây | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Đọc state theo lớp của người dùng | 200 | 10 | 0 | 278,0 | 35 ms | 51 ms | 58 ms |
| Ghi thảo luận qua snapshot có khóa | 50 | 10 | 0 | 97,9 | 98 ms | 116 ms | 122 ms |

Đây là số đo mẫu nhỏ qua loopback; không suy ra số học viên tối đa, tải lâu dài, độ trễ mạng bên ngoài hay khả năng chịu tải ở dữ liệu lớn. RAM sau lượt chạy: ứng dụng khoảng 120 MiB, PostgreSQL khoảng 66 MiB; không phải đỉnh RAM lúc tải. Khóa ghi chung vẫn còn; khi quy mô tăng, chạy lại với bộ dữ liệu tương ứng trước khi quyết định tách truy vấn ghi.

## Kết quả trước đợt sửa báo cáo, ngày 03/11/2026

Toàn bộ **90 kiểm tra đạt** trên ứng dụng production trong Docker của server đích, với Node.js 22 hoặc 24.23.4, Next.js 16.4.4, Prisma 6.19.0, PostgreSQL 17.11 và S3rver 3.7.1. Database và bucket riêng cho kiểm thử; tài khoản giáo viên/học viên được cấp qua CLI/API, không bật tài khoản demo. Ứng dụng chạy UID 1000. Các kiểm tra mới bao gồm readiness, quyền đọc tệp/bài nháp, thu hồi/nộp lại, xóa điểm nháp thực sự trong PostgreSQL và từ chối chấm từ phiên bản bài nộp cũ.

Bộ giả lập dùng truy cập bucket theo đường dẫn (`vhostBuckets: false`) để hoạt động qua hostname service Docker. Bucket/IAM/CORS của AWS hoặc R2 thật chưa được kiểm tra. Bộ 90 bước dùng HTTP trong network Docker; HTTPS của ứng dụng được xác minh riêng sau triển khai, xem [CODE_REVIEW.md](CODE_REVIEW.md).

Đã nâng cấp riêng từ image production trước bản sửa lên schema mới với lớp/bài nộp/điểm mẫu. Bài đã trả 90 điểm, yêu cầu cũ, bình luận có trước migration và cookie đăng nhập vẫn dùng được; tắt PostgreSQL thử nghiệm làm healthcheck trả 503 và khởi động lại trả 200.

## Kết quả lịch sử

Ngày 02/11/2026, migration và seed đã chạy thành công trên một máy chủ PostgreSQL 18.6 tạm thời. Toàn bộ **36 bước HTTP đạt** với Next.js 16.4.4, Prisma 6.19.0 và máy chủ S3 tương thích `s3rver`. Các dependency chạy máy chủ kiểm thử được cài ở `/tmp`, không được thêm vào dependency của dự án.

Amazon S3 và Cloudflare R2 thật chưa được thử bằng thông tin xác thực dịch vụ. MinIO không được thực thi trong lượt kiểm thử này vì URL tải binary chính thức trả HTTP 410. Kết quả S3 ở trên xác nhận đường đi HTTP/SDK và byte tệp với máy chủ tương thích cục bộ, chưa thay thế kiểm thử cấu hình bucket/IAM/CORS của từng môi trường triển khai.
