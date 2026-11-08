# LMS — LỚP LẬP MỆNH

Ứng dụng quản lý lớp học trực tuyến bằng tiếng Việt: giáo viên tổ chức bài giảng và bài tập, học viên học và nộp bài, quản trị viên cấp tài khoản. Frontend và API cùng chạy trong một ứng dụng Next.js; PostgreSQL lưu dữ liệu vận hành, Google Drive (một tài khoản dùng chung do quản trị viên kết nối) lưu tệp và video tải lên.

**Cập nhật 08/11/2026:** mọi tệp tải lên chuyển sang Google Drive; chỉ video bài giảng được chia sẻ bằng liên kết, học liệu và bài làm của học viên luôn riêng tư; có hạn mức dung lượng, nhật ký quản trị, trang công khai `/`, `/privacy`, `/terms`, cột thời gian `TIMESTAMPTZ`. Xem [Tệp và video](#tệp-và-video-google-drive).

**Cập nhật kiểm thử 03/11/2026:** xem [kết quả xử lý báo cáo](docs/REPORT_FIXES_2026-11-03.md) cho các sửa lỗi về bản nháp, công bố, xung đột giữa phiên, tải tệp, phiên đăng nhập và sao lưu.

**Lượt rà soát trước:** đã sửa các lỗi về quyền riêng tư, video, thu hồi/chấm bài, JSON đầu vào và giới hạn đăng nhập. Có Docker/Compose, healthcheck PostgreSQL và Bash tự cập nhật GitHub bằng systemd timer khi server bật/reboot. Kết quả kiểm thử mới nhất ở mục [Kiểm thử](#kiểm-thử). Xem [báo cáo kiểm tra](docs/CODE_REVIEW.md) và [hướng dẫn triển khai](docs/DEPLOYMENT.md) để biết giới hạn còn lại.

**Địa chỉ triển khai:** https://zimaos.click — Cloudflare Tunnel nối tới app ở `127.0.0.1:3000`. Tải tệp chỉ hoạt động sau khi đặt `GOOGLE_*`, `DRIVE_ENCRYPTION_KEY` trong `.env.production` và quản trị viên kết nối Google Drive tại `/admin`; trước đó YouTube và bài viết trực tiếp vẫn dùng được.

## Công nghệ

| Thành phần             | Phiên bản trong `package-lock.json` / cách sử dụng                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Node.js                | Dùng Node.js 22.13+; lượt rà soát chạy với 22.23.4                                                               |
| Next.js                | 16.4.4, App Router và Route Handlers, Node.js runtime                                                            |
| React / React DOM      | 19.3.1                                                                                                           |
| TypeScript             | 7.0.2                                                                                                            |
| Prisma / Prisma Client | 6.19.0, PostgreSQL                                                                                               |
| Kiểm tra dữ liệu       | Zod                                                                                                              |
| Kho tệp                | Google Drive REST API (OAuth `drive.file`, upload resumable), không thêm dependency; AWS SDK v3 cho tệp S3/R2 cũ |
| Kiểm thử               | Node test runner qua `tsx`, Playwright                                                                           |
| Giao diện              | CSS riêng, Lucide, font Newsreader và Be Vietnam Pro lưu cục bộ                                                  |

Dùng `npm ci` để cài đúng lockfile. Một số dependency trong `package.json` khai báo `latest`; `npm install` hoặc cập nhật dependency có thể làm thay đổi phiên bản khi lockfile thay đổi.

## Chạy thử trên máy cá nhân

Yêu cầu Node.js và npm. Chưa cần PostgreSQL hoặc Google Drive cho luồng học và bài viết trực tiếp.

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

Dữ liệu demo có lớp, bài tập và tiến độ mẫu; không kèm video bài giảng thật. Khi chưa có video hoặc tài liệu, giao diện hiển thị trạng thái tương ứng. Chưa kết nối Google Drive thì không tải tệp lên được, nhưng vẫn có thể viết và nộp bài trực tiếp hoặc nộp bằng liên kết. `npm run local:setup` thêm tài khoản thật (không phải demo, có quyền quản trị) vào dữ liệu JSON để thử luồng Drive trên máy cá nhân.

## Tài liệu chi tiết

Google Drive (cấu hình Google Cloud, API, giới hạn, checklist): [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md). Bảo mật, hiệu năng, vận hành: [docs/BAO_MAT_VAN_HANH.md](docs/BAO_MAT_VAN_HANH.md). Nghiệp vụ đầy đủ: [docs/NGHIEP_VU.md](docs/NGHIEP_VU.md).

## Chức năng và đường dẫn

| Đường dẫn                                  | Chức năng hiện có                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/privacy`, `/terms`                  | Trang giới thiệu, chính sách quyền riêng tư và điều khoản (công khai, không cần đăng nhập)                                        |
| `/login`                                   | Đăng nhập bằng email và mật khẩu được cấp                                                                                         |
| `/profile`                                 | Sửa họ tên, đổi mật khẩu bằng mật khẩu hiện tại                                                                                   |
| `/admin`, `/admin/users`                   | Quản trị tài khoản: tạo, sửa tên, kích hoạt, khóa/mở khóa, reset mật khẩu; kết nối Google Drive, dọn tệp mồ côi, nhật ký quản trị |
| `/classes`                                 | Lớp đang học/chờ duyệt/lưu trữ; tìm kiếm, kiểm tra mã lớp, xin tham gia và hủy yêu cầu chờ duyệt                                  |
| `/classes/[id]`                            | Tổng quan, bài giảng, bài tập, thành viên và thông tin lớp                                                                        |
| `/classes/[id]/lessons/[lessonId]`         | Video YouTube hoặc Google Drive, tài liệu (xem ngay trong trang), ghi chép cá nhân, thảo luận, lưu bài, đánh dấu hoàn thành       |
| `/classes/[id]/assignments/[assignmentId]` | Lưu nháp, nộp bài viết/tệp/video/liên kết, xác nhận trung thực, thu hồi/nộp lại theo chính sách, xem điểm đã trả                  |
| `/classes/[id]/members`                    | Danh sách thành viên, tìm tên không dấu, lọc nhóm, phân trang                                                                     |
| `/assignments`                             | Tổng hợp bài cần làm, đã nộp và đã chấm                                                                                           |
| `/teacher/classes`                         | Tạo/sửa/lưu trữ/khôi phục/xóa lớp, phân công giáo viên, đổi mã, giới hạn sĩ số, duyệt học viên và cấu hình người giảng nội dung   |
| `/teacher/lessons`                         | Soạn chương/bài, YouTube/video Google Drive, thư viện video, tài liệu, mốc nội dung, bản nháp và xuất bản                         |
| `/teacher/assignments`                     | Tạo/sửa/xóa bài tập, đặt số từ từng bài, chấm theo tiêu chí 40/40/20, lưu điểm nháp, trả điểm, nhắc nộp trong ứng dụng, xuất CSV  |

Trang đang mở lấy cập nhật khoảng mỗi 3 giây; khi quay lại tab hoặc có mạng trở lại sẽ kiểm tra ngay. Các tab cùng trình duyệt có thêm tín hiệu qua `BroadcastChannel`. Đây là cơ chế polling, chưa dùng WebSocket hoặc SSE. Với PostgreSQL, máy chủ so bộ đếm thay đổi của các lớp liên quan và trả `304` khi không có gì mới, nên lượt poll không đổi không phải tải lại dữ liệu.

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

Tài khoản do quản trị viên cấp. Các trang `/register`, `/verify-email`, `/forgot-password`, `/reset-password` chuyển về `/login`; API công khai tương ứng trả `403`. Luồng đang sử dụng không cần SMTP; mã gửi email, đăng ký công khai và liên kết đặt lại mật khẩu đã được gỡ khỏi mã nguồn.

Tài khoản mới hoặc được reset nhận mật khẩu tạm ngẫu nhiên riêng, chỉ hiển thị một lần cho quản trị viên. Người dùng phải đổi mật khẩu tại `/profile` trước khi dùng chức năng khác. Tài khoản cũ vẫn dùng mật khẩu chung trước đây cũng được yêu cầu đổi; tài khoản có mật khẩu riêng được giữ nguyên. Mật khẩu mới phải khác mật khẩu hiện tại, dài 8–128 ký tự và xác nhận trùng khớp.

Quyền quản trị (`isAdmin`) tách biệt với vai trò `TEACHER` / `STUDENT`. Giáo viên thông thường không được quản trị tài khoản. Không có tài khoản quản trị demo được cấp sẵn. Bảng quản trị không cho khóa hoặc reset tài khoản có quyền quản trị. Mọi thao tác quản trị (tạo/sửa/khóa tài khoản, reset mật khẩu, chuyển chủ lớp, cấp/thu hồi quyền quản trị, kết nối/ngắt Drive, dọn tệp) được ghi vào nhật ký chỉ-thêm, xem ở `/admin`.

Khóa, reset hoặc đổi mật khẩu làm mất hiệu lực các phiên cũ. Khi tự đổi mật khẩu, trình duyệt hiện tại nhận phiên mới. Đăng xuất thu hồi mọi bản sao cookie và các thiết bị khác của cùng tài khoản; thiết bị khác cần đăng nhập lại. Cookie phiên có thời hạn 7 ngày, HttpOnly, SameSite=Lax và Secure trong production; mật khẩu được băm bằng scrypt với salt riêng.

Chi tiết thao tác: [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

## Biến môi trường

Sao chép từ [.env.example](.env.example); không commit `.env` hoặc dữ liệu trong `.data/`.

| Biến                           | Ý nghĩa                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                 | Trống: JSON demo; có giá trị: kết nối PostgreSQL                                                                                                 |
| `SESSION_SECRET`               | Khóa ký phiên; tối thiểu 32 ký tự khi dùng PostgreSQL; đặt riêng cho môi trường vận hành                                                         |
| `APP_URL`                      | Origin chính xác của ứng dụng, ví dụ `http://localhost:3000` hoặc `https://lms.example.com`; không thêm đường dẫn hoặc dấu `/` cuối              |
| `TRUST_PROXY_HEADERS`          | Mặc định `false`; chỉ bật khi app nhận kết nối qua proxy đáng tin cậy: dùng IP do Cloudflare cung cấp và `X-Forwarded-Proto` khi kiểm tra Origin |
| `ALLOW_DEMO_ACCOUNTS`          | Mặc định `false`; chỉ bật `true` cho kiểm thử riêng nếu cần tài khoản mẫu ngoài localhost/JSON                                                   |
| `GOOGLE_CLIENT_ID`             | OAuth Client ID (loại Web application) của Google Cloud; cần để bật tải tệp                                                                      |
| `GOOGLE_CLIENT_SECRET`         | OAuth Client secret tương ứng                                                                                                                    |
| `GOOGLE_REDIRECT_URI`          | Tùy chọn; mặc định `APP_URL` + `/api/drive/callback`, phải khớp tuyệt đối với Google Cloud                                                       |
| `DRIVE_ENCRYPTION_KEY`         | ≥ 32 ký tự ngẫu nhiên, mã hóa refresh token Drive (AES-256-GCM); đổi khóa phải kết nối lại Drive                                                 |
| `DRIVE_PRUNE_INTERVAL_MINUTES` | Chu kỳ dọn tệp Drive mồ côi, mặc định `60`; `0` để tắt                                                                                           |
| `LMS_DATA_DIR`                 | Thư mục dữ liệu JSON demo và khóa phiên cục bộ, mặc định `.data`; dùng cho test                                                                  |
| `S3_ENDPOINT`                  | Kho S3 cũ (chỉ để mở tệp/video S3 đã có); với AWS S3 có thể để trống                                                                             |
| `S3_REGION`                    | Region của kho; R2 thường dùng `auto`, kho S3 cục bộ dùng `us-east-1`                                                                            |
| `S3_BUCKET`                    | Tên bucket riêng tư                                                                                                                              |
| `S3_ACCESS_KEY_ID`             | Khóa truy cập bucket                                                                                                                             |
| `S3_SECRET_ACCESS_KEY`         | Bí mật truy cập bucket                                                                                                                           |
| `LMS_UPLOAD_USER_QUOTA_BYTES`  | Tổng dung lượng tệp tối đa của mỗi người dùng (Drive và S3), tính cả lượt tải đang chờ; mặc định 10 GiB (`10737418240`)                          |
| `LMS_UPLOAD_CLASS_QUOTA_BYTES` | Tổng dung lượng tệp tối đa của mỗi lớp (Drive và S3), tính cả lượt tải đang chờ; mặc định 100 GiB (`107374182400`)                               |

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

## Tệp và video (Google Drive)

Mọi tệp tải lên đi vào **một tài khoản Google Drive dùng chung**. Quản trị viên vào `/admin` → **Kết nối Google Drive** (OAuth, scope `drive.file`: ứng dụng chỉ thấy tệp do chính nó tạo). Cách tạo OAuth client và chuyển app sang _In production_ (nếu để _Testing_, token hết hạn sau 7 ngày): [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).

| Nội dung                   | Ai tải lên             | Định dạng                            | Giới hạn mỗi tệp |
| -------------------------- | ---------------------- | ------------------------------------ | ---------------- |
| Video bài giảng            | Giáo viên của lớp      | MP4, WebM, MOV                       | 2 GiB            |
| Học liệu bài giảng         | Giáo viên của lớp      | PDF, DOCX, PPTX, JPG, PNG, GIF, WebP | 25 MiB           |
| Tệp/video đính kèm bài làm | Học viên đã được duyệt | Như trên (tài liệu hoặc video)       | 25 MiB / 2 GiB   |

Trình duyệt tải thẳng lên Drive theo từng đoạn 8 MiB (server không nhận byte video), tự thử lại và tiếp tục từ vị trí đã gửi khi mất mạng. Khi hoàn tất, server kiểm tra tệp thuộc đúng lượt tải, đúng dung lượng và đúng chữ ký định dạng (DOCX/PPTX kiểm tra cả danh mục ZIP); sai thì xóa khỏi Drive.

**Chính sách chia sẻ:**

- Chỉ **video bài giảng của giáo viên** được đặt "bất kỳ ai có liên kết đều xem được", vì trình phát Google Drive Preview cần quyền này.
- **Học liệu, tệp và video bài làm của học viên luôn riêng tư** trên Drive. Chúng được mở qua `/api/drive/files/{id}/view` (xem trong trang, hỗ trợ tua video) và `/download`; server kiểm tra quyền trong lớp mỗi lần rồi stream từ Drive.
- Tệp học viên không bật chia sẻ được, kể cả chính chủ. Video bị thu hồi chia sẻ thì không gắn được vào bài giảng.
- Job dọn dẹp tự thu hồi liên kết của mọi tệp học viên còn công khai.

**Hạn mức dung lượng:** 10 GiB mỗi tài khoản, 100 GiB mỗi lớp mặc định (`LMS_UPLOAD_USER_QUOTA_BYTES`, `LMS_UPLOAD_CLASS_QUOTA_BYTES`), tính cả tệp đang tải; tệp lỗi/hủy không tính. Dung lượng thật vẫn là của tài khoản Google đã kết nối (15 GB miễn phí), cần tự theo dõi.

**Dọn dẹp:** xóa bài tập, bài giảng hoặc lớp đưa tệp Drive liên quan vào hàng đợi xóa. Tệp không còn được dùng sau 24 giờ và lượt tải lỗi/bỏ dở bị xóa; video thư viện của giáo viên được giữ. Chạy tự động mỗi giờ, bằng nút ở `/admin`, hoặc `npm run drive:prune`.

### Kho S3 cũ

Các route `/api/uploads*`, `/api/files/*` và biến `S3_*` được giữ để tệp/video S3 đã có vẫn mở được; giao diện không còn tải tệp mới lên S3. Kho S3 giả lập cho phát triển/kiểm thử tích hợp:

```bash
docker compose --profile storage up -d --build
```

Service `s3` dùng S3rver 3.7.1, tự tạo bucket `lms` và chỉ mở cổng trên `127.0.0.1:9000`. Cấu hình `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=lms`, hai khóa truy cập đều là `S3RVER`. `npm run storage:prune` (thống kê) / `-- --apply` (xóa) dọn object S3 không còn tham chiếu; xem [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Cấu trúc thư mục

```text
src/
  app/                 Trang, CSS toàn cục và API Route Handlers
  components/          Giao diện học viên, giáo viên, quản trị và provider đồng bộ
  lib/                 Kiểu dữ liệu, chính sách tài khoản, tiện ích trình duyệt
    server/            Xác thực, nghiệp vụ, repository, hồ sơ, Google Drive và kho S3 cũ
prisma/                Schema, 16 migration và mẫu CORS bucket
docker/s3rver/         Kho S3 giả lập chỉ dành cho phát triển/kiểm thử
scripts/               Seed, cấp/thu hồi giáo viên/quản trị, kiểm thử tích hợp/chịu tải, dọn Drive/kho tệp,
                       tự triển khai, sao lưu database và hỗ trợ chụp giao diện
tests/                 25 file kiểm thử backend (*.test.ts/.mjs), 9 file Playwright (*.spec.ts)
docs/                  Tài khoản, tích hợp, bản đồ thiết kế, rà soát và triển khai
public/                Font cục bộ, giấy phép font và ảnh chờ video
stitch_custom_video_learning_platform/
                       34 bản xuất HTML, ảnh tham chiếu và tài liệu thiết kế
.hallmark/             Hồ sơ thiết kế, báo cáo và ảnh chụp giao diện
```

Các bản xuất Stitch là tài liệu tham chiếu cho 8 màn hình chính, không được phục vụ như 34 trang ứng dụng độc lập. Xem [docs/STITCH_MAP.md](docs/STITCH_MAP.md).

`node_modules/`, `.next/`, `.data/`, các tệp `.env` thực tế, báo cáo Playwright và `*.tsbuildinfo` là dữ liệu cục bộ/sinh tự động, đã được loại trừ bởi `.gitignore`.

## Lệnh npm

| Lệnh                                                   | Công dụng                                             |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `npm run dev`                                          | Chạy phát triển, mặc định cổng 3000                   |
| `npm run build`                                        | Sinh Prisma Client và build production                |
| `npm start`                                            | Chạy bản đã build                                     |
| `npm run typecheck`                                    | Kiểm tra TypeScript                                   |
| `npm test`                                             | Kiểm thử backend trong `tests/*.test.ts`              |
| `npm run test:e2e`                                     | Kiểm thử Playwright trong `tests/*.spec.ts`           |
| `npm run test:integration`                             | Kiểm thử HTTP với PostgreSQL và S3 thật đã cấu hình   |
| `npm run format:check` / `npm run format`              | Kiểm tra / sửa định dạng mã nguồn bằng Prettier       |
| `npm run db:generate`                                  | Sinh Prisma Client                                    |
| `npm run db:migrate`                                   | Áp dụng migration PostgreSQL                          |
| `npm run db:push`                                      | Đồng bộ schema khi phát triển                         |
| `npm run db:seed`                                      | Tạo dữ liệu minh họa trên PostgreSQL trống            |
| `npm run account:create-teacher -- <email> "<họ tên>"` | Cấp giáo viên thật bằng CLI, yêu cầu PostgreSQL       |
| `npm run account:grant-admin -- <email>`               | Cấp quyền quản trị cho tài khoản thật đang hoạt động  |
| `npm run account:revoke-admin -- <email>`              | Thu hồi quyền quản trị (từ chối nếu là admin cuối)    |
| `npm run drive:prune [số giờ]`                         | Dọn tệp Google Drive mồ côi ngay                      |
| `npm run local:setup`                                  | Thêm tài khoản thật vào JSON demo để thử Google Drive |
| `npm run local:prod`                                   | Build rồi chạy bản production trên máy cá nhân        |
| `npm run storage:prune` / `-- --apply`                 | Thống kê / xóa object S3 mồ côi cũ trên 30 ngày       |
| `npm run notifications:prune` / `-- --apply`           | Thống kê / xóa thông báo đã đọc cũ hơn 90 ngày        |

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

Kết quả lượt kiểm thử ngày **08/11/2026** (bản có Google Drive):

| Kiểm tra                                            | Kết quả                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| TypeScript, Prettier, build production              | Đạt                                                                                            |
| Backend (Node test runner)                          | 157/158 đạt, 1 bỏ qua (test PostgreSQL chỉ chạy khi có `TEST_DATABASE_URL`, đã chạy riêng)     |
| Test PostgreSQL và route trên bản build             | 8/8 đạt với PostgreSQL 17 thật                                                                 |
| Migration trên dữ liệu kiểu cũ (TEXT → TIMESTAMPTZ) | Áp dụng đủ, schema khớp, dữ liệu cũ đọc lại đúng                                               |
| PostgreSQL + S3 qua HTTP                            | 157/157 đạt                                                                                    |
| Google Drive thật                                   | Chưa kiểm thử (Google API được mock trong test); làm theo checklist trong docs/GOOGLE_DRIVE.md |

Lượt 03/11/2026 (trước khi có Drive): 28/28 kịch bản Playwright, `npm audit` 0 lỗ hổng; chi tiết [docs/REPORT_FIXES_2026-11-03.md](docs/REPORT_FIXES_2026-11-03.md).

Playwright lần rà soát dùng dev server Webpack trên bản sao tạm để dùng chung dependency mà không sửa dữ liệu gốc; build production được kiểm tra riêng bằng cấu hình Turbopack mặc định. Bộ kịch bản trình duyệt này không kiểm thử chịu tải hoặc production qua HTTPS. Ngoài bộ đó, đăng nhập quản trị, cookie, trang/API quản trị và healthcheck đã được xác minh riêng bằng Chromium qua tên miền HTTPS thật.

Hướng dẫn kiểm thử PostgreSQL/S3 và kết quả lịch sử: [docs/INTEGRATION.md](docs/INTEGRATION.md). Các kết quả lịch sử trong tài liệu không thay thế lần chạy mới.

## Triển khai qua tên miền

Mô hình phù hợp cho máy chủ Linux có Docker: ứng dụng Next.js chạy liên tục, PostgreSQL có volume bền vững, tài khoản Google Drive đã kết nối và tên miền HTTPS đi qua Cloudflare Tunnel hoặc reverse proxy.

File [Dockerfile](Dockerfile) build trên Node.js 22/Debian, chạy app bằng user không phải root và giữ Prisma CLI/`tsx` cho migration, quản trị tài khoản. File [compose.production.yml](compose.production.yml) gồm PostgreSQL có volume bền vững, service migration chạy trước ứng dụng, healthcheck, tự khởi động lại và giới hạn log. App chỉ được map ra loopback để nối với tunnel/reverse proxy; PostgreSQL không mở cổng ra host.

```bash
cp .env.production.example .env.production
# Điền POSTGRES_PASSWORD, SESSION_SECRET, APP_URL, GOOGLE_CLIENT_ID/SECRET và DRIVE_ENCRYPTION_KEY trong .env.production.
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

Với PostgreSQL, trạng thái học tập, thao tác học tập/giảng dạy, tải tệp và mở tệp chỉ đọc dữ liệu của các lớp liên quan cùng thông báo/tệp của người thao tác. Thao tác ghi khóa theo từng lớp và từng tài khoản (advisory lock), nên các lớp khác nhau ghi song song; chỉ bản ghi thực sự thay đổi mới được ghi. Thao tác quản trị tài khoản, hồ sơ và script vận hành vẫn dùng snapshot toàn bộ với khóa độc quyền vì tần suất thấp. Chưa có số đo chịu tải để cam kết số học viên đồng thời. Các nhận xét lịch sử nằm trong [báo cáo kiểm tra](docs/CODE_REVIEW.md).
