# LMS — Lớp Học Đạo

Ứng dụng quản lý lớp học trực tuyến bằng tiếng Việt: giáo viên tổ chức bài giảng và bài tập, học viên học và nộp bài, quản trị viên cấp tài khoản. Frontend và API cùng chạy trong một ứng dụng Next.js; PostgreSQL lưu dữ liệu vận hành, kho S3 tương thích lưu tệp và video.

**Cập nhật ngày 03/11/2026:** đã sửa các lỗi về quyền riêng tư, video, thu hồi/chấm bài, JSON đầu vào và giới hạn đăng nhập; 90 kiểm thử backend/vận hành, 17 kiểm thử trình duyệt và build production đều đạt. Có Docker/Compose, healthcheck PostgreSQL và Bash tự cập nhật GitHub bằng systemd timer khi server bật/reboot. Xem [báo cáo kiểm tra](docs/CODE_REVIEW.md) và [hướng dẫn triển khai](docs/DEPLOYMENT.md) để biết kết quả xác minh và giới hạn còn lại.

**Địa chỉ triển khai:** https://zimaos.click — Cloudflare Tunnel nối tới app ở `127.0.0.1:3000`. Chưa cấu hình bucket vận hành vì R2 của tài khoản chưa bật; YouTube/bài viết hoạt động, tải tệp cần bổ sung S3/R2.

## Công nghệ

| Thành phần             | Phiên bản trong `package-lock.json` / cách sử dụng              |
| ---------------------- | --------------------------------------------------------------- |
| Node.js                | Dùng Node.js 22.13+; lượt rà soát chạy với 22.23.4              |
| Next.js                | 16.4.4, App Router và Route Handlers, Node.js runtime           |
| React / React DOM      | 19.3.1                                                          |
| TypeScript             | 7.0.2                                                           |
| Prisma / Prisma Client | 6.19.0, PostgreSQL                                              |
| Kiểm tra dữ liệu       | Zod                                                             |
| Kho tệp                | AWS SDK v3, hỗ trợ S3 và các kho tương thích S3 / Cloudflare R2 |
| Kiểm thử               | Node test runner qua `tsx`, Playwright                          |
| Giao diện              | CSS riêng, Lucide, font Newsreader và Be Vietnam Pro lưu cục bộ |

Dùng `npm ci` để cài đúng lockfile. Một số dependency trong `package.json` khai báo `latest`; `npm install` hoặc cập nhật dependency có thể làm thay đổi phiên bản khi lockfile thay đổi.

## Chạy thử trên máy cá nhân

Yêu cầu Node.js và npm. Chưa cần PostgreSQL hoặc kho tệp cho luồng học và bài viết trực tiếp.

```bash
npm ci
cp .env.example .env
npm run db:generate
npm run dev
```

Mở <http://localhost:3000/login>:

| Vai trò   | Email                | Mật khẩu demo |
| --------- | -------------------- | ------------- |
| Học viên  | `student@detuquy.vn` | `Demo@2026`   |
| Giáo viên | `teacher@detuquy.vn` | `Demo@2026`   |

Khi `DATABASE_URL` trống, ứng dụng khởi tạo dữ liệu minh họa tại `.data/demo.json`. Dữ liệu được lưu qua các lần khởi động và được dùng chung giữa các tài khoản demo. Khóa ký phiên cục bộ được tạo tại `.data/session-secret` nếu chưa đặt `SESSION_SECRET`.

Chế độ JSON chỉ phù hợp một tiến trình Node.js để phát triển hoặc thử nghiệm. Tài khoản demo được phép đăng nhập mặc định trên localhost; khi dùng PostgreSQL hoặc tên miền public, chúng bị chặn trừ khi bật `ALLOW_DEMO_ACCOUNTS=true` cho môi trường kiểm thử riêng.

Dữ liệu demo có lớp, bài tập và tiến độ mẫu; không kèm video bài giảng thật. Khi chưa có video hoặc tài liệu, giao diện hiển thị trạng thái tương ứng. Chưa cấu hình S3 thì không tải tệp lên được, nhưng vẫn có thể viết và nộp bài trực tiếp.

## Video qua Google Drive

Giáo viên có thể tải video lên Google Drive dùng chung (quản trị viên kết nối tại `/admin`) và phát trong bài giảng bằng Drive Preview; tải theo chunk, tự tiếp tục khi mất mạng. Cấu hình Google Cloud, API, giới hạn và checklist: [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md). Bảo mật, hiệu năng, vận hành: [docs/BAO_MAT_VAN_HANH.md](docs/BAO_MAT_VAN_HANH.md). Nghiệp vụ đầy đủ: [docs/NGHIEP_VU.md](docs/NGHIEP_VU.md).

## Chức năng và đường dẫn

| Đường dẫn                                  | Chức năng hiện có                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                                   | Đăng nhập bằng email và mật khẩu được cấp                                                                                        |
| `/profile`                                 | Sửa họ tên, đổi mật khẩu bằng mật khẩu hiện tại                                                                                  |
| `/admin`, `/admin/users`                   | Quản trị tài khoản giáo viên/học viên: tạo, sửa tên, kích hoạt, khóa/mở khóa, reset mật khẩu                                     |
| `/classes`                                 | Lớp đang học/chờ duyệt/lưu trữ; tìm kiếm, kiểm tra mã lớp, xin tham gia và hủy yêu cầu chờ duyệt                                 |
| `/classes/[id]`                            | Tổng quan, bài giảng, bài tập, thành viên và thông tin lớp                                                                       |
| `/classes/[id]/lessons/[lessonId]`         | Video YouTube hoặc video trong kho tệp, tài liệu, ghi chép cá nhân, thảo luận, lưu bài, đánh dấu hoàn thành                      |
| `/classes/[id]/assignments/[assignmentId]` | Lưu nháp, nộp bài viết/tệp, xác nhận trung thực, thu hồi/nộp lại theo chính sách, xem điểm đã trả                                |
| `/classes/[id]/members`                    | Danh sách thành viên, tìm tên không dấu, lọc nhóm, phân trang                                                                    |
| `/assignments`                             | Tổng hợp bài cần làm, đã nộp và đã chấm                                                                                          |
| `/teacher/classes`                         | Tạo/sửa/lưu trữ/khôi phục/xóa lớp, phân công giáo viên, đổi mã, giới hạn sĩ số, duyệt học viên và cấu hình người giảng nội dung  |
| `/teacher/lessons`                         | Soạn chương/bài, YouTube/video tải lên, tài liệu, mốc nội dung, bản nháp và xuất bản                                             |
| `/teacher/assignments`                     | Tạo/sửa/xóa bài tập, đặt số từ từng bài, chấm theo tiêu chí 40/40/20, lưu điểm nháp, trả điểm, nhắc nộp trong ứng dụng, xuất CSV |

Trang đang mở lấy cập nhật khoảng mỗi 3 giây; khi quay lại tab hoặc có mạng trở lại sẽ kiểm tra ngay. Các tab cùng trình duyệt có thêm tín hiệu qua `BroadcastChannel`. Đây là cơ chế polling, chưa dùng WebSocket hoặc SSE.

Hoàn thành bài học là thao tác đánh dấu thủ công. Ứng dụng chưa kiểm tra thời lượng xem video hoặc bắt buộc học tuần tự. Nhắc nộp bài là thông báo trong ứng dụng, không phải email hay tin nhắn bên ngoài.

## Quản lý bài tập và thông báo

Trong **Bài cần chấm**, chọn lớp để xem danh sách bài tập, số học viên đã nộp và số bài cần chấm. Chọn tên bài hoặc **Xem bài nộp** để mở thống kê và danh sách học viên; thao tác sửa/xóa nằm trong menu của từng bài. Xóa yêu cầu nhập đúng tên; bài nộp, điểm và thông báo gắn với bài đó cũng bị xóa. Các bài khác và bài giảng được giữ nguyên.

Ở chi tiết bài, điểm nháp được ghi rõ và vẫn thuộc nhóm **Cần chấm** cho tới khi trả bài. **Xuất điểm bài này** tải CSV của toàn bộ học viên chính thức trong lớp cho bài đang mở, không phụ thuộc bộ lọc; điểm nháp không xuất thành điểm chính thức. Tệp có mã lớp, tên và ID bài tập.

Khi tạo hoặc sửa bài, giáo viên đặt **Số từ tối thiểu** và **Số từ tối đa**. Mặc định bài mới là tối thiểu **150 từ**, không giới hạn tối đa; để trống ô tối đa để bỏ giới hạn, nhập 0 ở ô tối thiểu để bỏ mức tối thiểu. Học viên nhận đúng yêu cầu hiện hành khi trang đang mở; bản nháp đang viết không bị thay thế khi thầy cô sửa đề. Các bài đã giao trước bản cập nhật giữ yêu cầu cũ cho tới khi giáo viên sửa.

Nhắc nộp và trả điểm tạo thông báo trong ứng dụng: chuông có số chưa đọc, trang hiển thị nội dung thông báo mới và hộp thông báo có liên kết tới bài tập. Mở chuông không tự đánh dấu đã đọc; người dùng chọn đánh dấu hoặc mở bài liên quan. Dữ liệu cập nhật theo polling khoảng 3 giây khi trang đang hiển thị.

Người quản lý lớp chọn **Lớp giảng dạy → Giáo viên phụ trách** để phân công nhiều tài khoản giáo viên. Giáo viên được phân công được quản lý bài giảng, xét duyệt học viên và chấm bài; người quản lý lớp thay đổi cài đặt và phân công. Quản trị viên có thể chuyển quyền quản lý khi tài khoản cũ bị khóa. Tên người trình bày nội dung là trường riêng. Giáo viên có thể tham gia lớp khác như học viên; mã lớp không cấp quyền dạy. Học viên có thể rời lớp hoặc được đưa ra khỏi lớp mà không xóa lịch sử; nếu được duyệt lại, dữ liệu được giữ nguyên.

Ở **Lớp giảng dạy → Cài đặt → Người giảng nội dung**, nhập tên riêng cho từng lớp hoặc để trống để ẩn dòng này trên thẻ lớp. Chương mục của bài giảng mới để trống và chỉ gợi ý những chương đã có trong chính lớp đang chọn; không gán tên người giảng hoặc chương mẫu cho lớp thật.

## Thảo luận trong bài học

Người viết sửa hoặc xóa thảo luận của mình bằng nút **Sửa** / **Xóa** cạnh nội dung. Giáo viên phụ trách lớp có quyền xóa thảo luận trong lớp; không được sửa lời của học viên. Xóa có hộp xác nhận. Bài đã sửa giữ ngày đăng và có nhãn **Đã chỉnh sửa**.

Giáo viên có thể vào **Kho bài giảng → chọn bài → Xem thảo luận** để trao đổi hoặc quản lý. Bản đang soạn được giữ khi đổi tab trong bài học hoặc nhận cập nhật. Nếu nội dung bị sửa/xóa từ phiên khác, giao diện báo thay đổi và backend chặn thao tác từ bản cũ; bản soạn chưa lưu vẫn có thể sao chép.

## Chính sách tài khoản

Tài khoản do quản trị viên cấp. Các trang `/register`, `/verify-email`, `/forgot-password`, `/reset-password` chuyển về `/login`; API công khai tương ứng trả `403`. Luồng đang sử dụng không cần SMTP. Mã xử lý email/token cũ vẫn còn trong `src/lib/server/accounts.ts` và `mail.ts`, nhưng không được các API công khai này gọi.

Tài khoản mới hoặc được reset nhận mật khẩu tạm ngẫu nhiên riêng, chỉ hiển thị một lần cho quản trị viên. Người dùng phải đổi mật khẩu tại `/profile` trước khi dùng chức năng khác. Tài khoản cũ vẫn dùng mật khẩu chung trước đây cũng được yêu cầu đổi; tài khoản có mật khẩu riêng được giữ nguyên. Mật khẩu mới phải khác mật khẩu hiện tại, dài 8–128 ký tự và xác nhận trùng khớp.

Quyền quản trị (`isAdmin`) tách biệt với vai trò `TEACHER` / `STUDENT`. Giáo viên thông thường không được quản trị tài khoản. Không có tài khoản quản trị demo được cấp sẵn. Bảng quản trị không cho khóa hoặc reset tài khoản có quyền quản trị.

Khóa, reset hoặc đổi mật khẩu làm mất hiệu lực các phiên cũ. Khi tự đổi mật khẩu, trình duyệt hiện tại nhận phiên mới. Cookie phiên có thời hạn 7 ngày, HttpOnly, SameSite=Lax và Secure trong production; mật khẩu được băm bằng scrypt với salt riêng.

Chi tiết thao tác: [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

## Biến môi trường

Sao chép từ [.env.example](.env.example); không commit `.env` hoặc dữ liệu trong `.data/`.

| Biến                   | Ý nghĩa                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Trống: JSON demo; có giá trị: kết nối PostgreSQL                                                                                    |
| `SESSION_SECRET`       | Khóa ký phiên; tối thiểu 32 ký tự khi dùng PostgreSQL; đặt riêng cho môi trường vận hành                                            |
| `APP_URL`              | Origin chính xác của ứng dụng, ví dụ `http://localhost:3000` hoặc `https://lms.example.com`; không thêm đường dẫn hoặc dấu `/` cuối |
| `TRUST_PROXY_HEADERS`  | Mặc định `false`; chỉ bật khi app nhận kết nối qua proxy đáng tin cậy, ưu tiên IP do Cloudflare cung cấp                            |
| `ALLOW_DEMO_ACCOUNTS`  | Mặc định `false`; chỉ bật `true` cho kiểm thử riêng nếu cần tài khoản mẫu ngoài localhost/JSON                                      |
| `S3_ENDPOINT`          | Endpoint kho tương thích S3; với AWS S3 có thể để trống                                                                             |
| `S3_REGION`            | Region của kho; R2 thường dùng `auto`, kho S3 cục bộ dùng `us-east-1`                                                               |
| `S3_BUCKET`            | Tên bucket riêng tư                                                                                                                 |
| `S3_ACCESS_KEY_ID`     | Khóa truy cập bucket                                                                                                                |
| `S3_SECRET_ACCESS_KEY` | Bí mật truy cập bucket                                                                                                              |

`APP_URL` được dùng để kiểm tra nguồn các yêu cầu ghi dữ liệu. Nếu đổi cổng phát triển, cần đổi `APP_URL` theo cổng mới; khi triển khai phải dùng origin HTTPS của tên miền thật.

## PostgreSQL và quản trị viên đầu tiên

### Phát triển cục bộ

File [docker-compose.yml](docker-compose.yml) cung cấp PostgreSQL 17 và kho S3 giả lập tùy chọn cho phát triển/kiểm thử. Môi trường vận hành dùng [compose.production.yml](compose.production.yml) riêng.

```bash
docker compose up -d postgres
```

Cấu hình `.env`:

```dotenv
DATABASE_URL=postgresql://lms:lms-local-password@localhost:5432/lms?schema=public
SESSION_SECRET=<chuoi-ngau-nhien-rieng-it-nhat-32-ky-tu>
APP_URL=http://localhost:3000
```

Có thể tạo khóa bằng:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Khởi tạo schema và tài khoản thật đầu tiên:

```bash
npm run db:generate
npm run db:migrate
ACCOUNT_INITIAL_PASSWORD="$LMS_INITIAL_PASSWORD" npm run account:create-teacher -- owner@example.com "Tên quản trị viên"
npm run account:grant-admin -- owner@example.com
npm run dev
```

Trước khi chạy, đặt `LMS_INITIAL_PASSWORD` bằng một mật khẩu tạm riêng. CLI yêu cầu `ACCOUNT_INITIAL_PASSWORD` từ môi trường và không in mật khẩu riêng ra log. Người dùng phải đổi mật khẩu tại `/profile` sau khi đăng nhập. Từ `/admin`, tạo các tài khoản còn lại. Nếu tài khoản thật đã có sẵn và đang hoạt động, chỉ cần chạy `account:grant-admin`.

### Dữ liệu minh họa trên PostgreSQL

```bash
npm run db:seed
```

Lệnh này chỉ dành cho cơ sở dữ liệu thử nghiệm: thêm tài khoản/lớp mẫu, từ chối chạy nếu đã có người dùng. Không cần seed để khởi tạo hệ thống thật. Seed không chuyển dữ liệu từ `.data/demo.json` sang PostgreSQL; hiện chưa có lệnh chuyển đổi dữ liệu JSON.

Dùng `db:migrate` khi triển khai/nâng cấp. `db:push` dành cho đồng bộ schema trong quá trình phát triển, không thay thế lịch sử migration khi vận hành.

## Tệp đính kèm và video

Cấu hình các biến `S3_*` để bật tải tệp. Kho S3 tương thích phải truy cập được từ server; các URL tải lên/tải xuống ký sẵn cũng phải truy cập được từ trình duyệt người dùng.

| Nội dung          | Định dạng                | Giới hạn mỗi tệp | Đường tải lên                                   |
| ----------------- | ------------------------ | ---------------- | ----------------------------------------------- |
| Bài làm, tài liệu | PDF, DOCX, JPG/JPEG, PNG | 25 MiB           | Qua API Next.js rồi chuyển vào bucket           |
| Video             | MP4, WebM                | 2 GiB            | Trình duyệt PUT trực tiếp tới bucket qua URL ký |

Máy chủ kiểm tra phần mở rộng, MIME, kích thước và chữ ký nhận dạng cơ bản của tệp. Đây chưa phải kiểm tra toàn vẹn tài liệu, giải mã video hoặc quét mã độc. Nội dung tệp không được lưu ra đĩa ứng dụng; database chỉ lưu metadata.

Video tải lên được xác minh rồi sao chép sang khóa `verified/` để URL PUT cũ không ghi đè bản đã xác minh. URL tải lên có hạn 10 phút; URL tải xuống có hạn 5 phút. API tải xuống kiểm tra quyền trước khi chuyển hướng tới kho tệp.

CORS mẫu ở [prisma/s3-cors.json](prisma/s3-cors.json): đổi `AllowedOrigins` thành origin thực tế, cho phép PUT/GET/HEAD và các header phù hợp. Không cấu hình `S3_ENDPOINT` bằng tên container nội bộ nếu trình duyệt cần truy cập URL ký đó.

Kho S3 cục bộ dành cho phát triển/kiểm thử:

```bash
docker compose --profile storage up -d --build
```

Service `s3` dùng S3rver 3.7.1, tự tạo bucket `lms` và chỉ mở cổng trên `127.0.0.1:9000`. Cấu hình `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=lms`, hai khóa truy cập đều là `S3RVER`. Mẫu nằm trong `.env.example`; kho này không có trang quản trị và không dùng cho lưu trữ public/production. Dữ liệu phát triển nằm trong volume `local_s3_data`.

Xóa lớp hiện xóa dữ liệu và metadata liên quan trong database; chưa tự xóa các object tương ứng khỏi bucket.

## Cấu trúc thư mục

```text
src/
  app/                 Trang, CSS toàn cục và API Route Handlers
  components/          Giao diện học viên, giáo viên, quản trị và provider đồng bộ
  lib/                 Kiểu dữ liệu, chính sách tài khoản, tiện ích trình duyệt
    server/            Xác thực, nghiệp vụ, repository, hồ sơ và kho tệp
prisma/                Schema, 3 migration và mẫu CORS bucket
docker/s3rver/         Kho S3 giả lập chỉ dành cho phát triển/kiểm thử
scripts/               Seed, cấp giáo viên/quản trị, kiểm thử tích hợp, hỗ trợ chụp giao diện
tests/                 4 file kiểm thử backend, 4 file Playwright
docs/                  Tài khoản, tích hợp, bản đồ thiết kế, rà soát và triển khai
public/                Font cục bộ, giấy phép font và ảnh chờ video
stitch_custom_video_learning_platform/
                       34 bản xuất HTML, ảnh tham chiếu và tài liệu thiết kế
.hallmark/             Hồ sơ thiết kế, báo cáo và ảnh chụp giao diện
```

Các bản xuất Stitch là tài liệu tham chiếu cho 8 màn hình chính, không được phục vụ như 34 trang ứng dụng độc lập. Xem [docs/STITCH_MAP.md](docs/STITCH_MAP.md).

`node_modules/`, `.next/`, `.data/`, các tệp `.env` thực tế, báo cáo Playwright và `*.tsbuildinfo` là dữ liệu cục bộ/sinh tự động, đã được loại trừ bởi `.gitignore`.

## Lệnh npm

| Lệnh                                                   | Công dụng                                            |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `npm run dev`                                          | Chạy phát triển, mặc định cổng 3000                  |
| `npm run build`                                        | Sinh Prisma Client và build production               |
| `npm start`                                            | Chạy bản đã build                                    |
| `npm run typecheck`                                    | Kiểm tra TypeScript                                  |
| `npm test`                                             | Kiểm thử backend trong `tests/*.test.ts`             |
| `npm run test:e2e`                                     | Kiểm thử Playwright trong `tests/*.spec.ts`          |
| `npm run test:integration`                             | Kiểm thử HTTP với PostgreSQL và S3 thật đã cấu hình  |
| `npm run format:check` / `npm run format`              | Kiểm tra / sửa định dạng mã nguồn bằng Prettier      |
| `npm run db:generate`                                  | Sinh Prisma Client                                   |
| `npm run db:migrate`                                   | Áp dụng migration PostgreSQL                         |
| `npm run db:push`                                      | Đồng bộ schema khi phát triển                        |
| `npm run db:seed`                                      | Tạo dữ liệu minh họa trên PostgreSQL trống           |
| `npm run account:create-teacher -- <email> "<họ tên>"` | Cấp giáo viên thật bằng CLI, yêu cầu PostgreSQL      |
| `npm run account:grant-admin -- <email>`               | Cấp quyền quản trị cho tài khoản thật đang hoạt động |

## Kiểm thử

```bash
npm run typecheck
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright mặc định dùng `http://localhost:3000`, tái sử dụng server đang chạy hoặc tự khởi động `next dev`. Các test thay đổi dữ liệu; dùng bản sao ứng dụng và dữ liệu kiểm thử riêng. Đặt `E2E_ISOLATED=true` để Playwright từ chối tái sử dụng server có sẵn, chọn cổng riêng qua `E2E_BASE_URL`, và đặt `APP_URL` của server trùng với địa chỉ đó. Không trỏ bộ test vào server thật.

Hai ca quản trị/hồ sơ cần `ADMIN_E2E_EMAIL` và `ADMIN_E2E_PASSWORD` của tài khoản quản trị thử nghiệm riêng; thiếu thông tin thì bị bỏ qua. Các ca dùng tài khoản mẫu cần môi trường cho phép các tài khoản đó. Không trỏ bộ test này vào dữ liệu thật.

Kết quả chạy lại ngày **03/11/2026**, với dependency khớp lockfile và bản cài mới trong Docker:

| Kiểm tra                                                     | Kết quả                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| TypeScript                                                   | Đạt                                                                  |
| Prettier trên mã nguồn                                       | Đạt                                                                  |
| Backend                                                      | 90/90 đạt                                                            |
| Build production mặc định với Turbopack                      | Đạt                                                                  |
| Playwright trên bản sao dữ liệu riêng, đủ tài khoản quản trị | 17/17 đạt, không bỏ qua ca nào                                       |
| `npm audit`                                                  | 0 lỗ hổng đã biết được báo về tại thời điểm chạy                     |
| PostgreSQL + S3 qua HTTP                                     | 90/90 đạt với PostgreSQL và S3 giả lập trong Docker trên server      |
| Chạy ứng dụng trên server đích / qua tên miền thật           | Đã triển khai tại `https://zimaos.click`; đăng nhập/health HTTPS đạt |

Playwright lần rà soát dùng dev server Webpack trên bản sao tạm để dùng chung dependency mà không sửa dữ liệu gốc; build production được kiểm tra riêng bằng cấu hình Turbopack mặc định. Bộ 17 ca này không kiểm thử chịu tải hoặc production qua HTTPS. Ngoài bộ đó, đăng nhập quản trị, cookie, trang/API quản trị và healthcheck đã được xác minh riêng bằng Chromium qua tên miền HTTPS thật.

Hướng dẫn kiểm thử PostgreSQL/S3 và kết quả lịch sử: [docs/INTEGRATION.md](docs/INTEGRATION.md). Các kết quả lịch sử trong tài liệu không thay thế lần chạy mới.

## Triển khai qua tên miền

Mô hình phù hợp cho máy chủ Linux có Docker: ứng dụng Next.js chạy liên tục, PostgreSQL có volume bền vững, bucket S3/R2 riêng tư và tên miền HTTPS đi qua Cloudflare Tunnel hoặc reverse proxy.

File [Dockerfile](Dockerfile) build trên Node.js 22/Debian, chạy app bằng user không phải root và giữ Prisma CLI/`tsx` cho migration, quản trị tài khoản. File [compose.production.yml](compose.production.yml) gồm PostgreSQL có volume bền vững, service migration chạy trước ứng dụng, healthcheck, tự khởi động lại và giới hạn log. App chỉ được map ra loopback để nối với tunnel/reverse proxy; PostgreSQL không mở cổng ra host.

```bash
cp .env.production.example .env.production
# Điền POSTGRES_PASSWORD, SESSION_SECRET và APP_URL trong .env.production.
bash scripts/auto-deploy.sh --once
bash scripts/auto-deploy.sh --install-systemd
```

Script kiểm tra `origin/main` khoảng mỗi phút, sao lưu database trước deploy, chạy migration và kiểm tra app healthy. Bật user lingering để timer chạy khi reboot mà không cần SSH; app/PostgreSQL cũng tự khởi động cùng Docker. Sau đó cấp giáo viên/quản trị đầu tiên với mật khẩu riêng theo [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Production Compose luôn tắt tài khoản demo. Kho S3 cục bộ trong Compose phát triển không được đưa vào cấu hình production.

Nếu chạy trực tiếp bằng Node.js với PostgreSQL và tài khoản đã cấu hình:

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Đặt `APP_URL=https://lms.example.com` đúng origin của tên miền thật và dùng khóa phiên riêng. Hướng dẫn bao gồm cổng nội bộ, tunnel, database, kho video, backup và cách kiểm tra sau triển khai: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Trạng thái học tập và kiểm tra phiên PostgreSQL chỉ đọc dữ liệu của tài khoản/lớp liên quan. Thao tác ghi vẫn đọc snapshot và dùng transaction/advisory lock, nhưng chỉ ghi hoặc xóa bản ghi thực sự thay đổi. Cách này vẫn còn hạn chế khi dữ liệu hoặc số phiên đồng thời tăng. Chưa có số đo chịu tải để cam kết số học viên đồng thời. Các nhận xét lịch sử nằm trong [báo cáo kiểm tra](docs/CODE_REVIEW.md).
