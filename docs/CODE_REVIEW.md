# Kết quả rà soát và sửa lỗi LMS

> Báo cáo lịch sử của đợt rà soát trước. Chính sách tài khoản và phân quyền lớp hiện hành được cập nhật trong README; một số giới hạn được liệt kê bên dưới đã thay đổi ở phiên bản sau.

Cập nhật **03/11/2026**. Bốn lỗi được phát hiện trong lượt rà soát đầu đã được sửa trong mã nguồn và có kiểm thử hồi quy. Ứng dụng đã được triển khai thường trực tại https://zimaos.click bằng Docker với PostgreSQL riêng. Kiểm thử kho S3 dùng một stack tạm biệt lập; production chưa có bucket vì R2 của tài khoản chưa bật.

## Những lỗi đã sửa

| Vấn đề ban đầu                                            | Hành vi sau khi sửa                                                                                                                         | Bằng chứng kiểm tra                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Học viên nhận được điểm/nhận xét chưa trả khi thu hồi bài | Dùng chung cách lọc bài nộp cho state và phản hồi mutation; xóa điểm, rubric, nhận xét và mốc trả điểm khi thu hồi hoặc sửa bản nháp        | Kiểm thử backend, HTTP Playwright và PostgreSQL/S3 kiểm tra cả phản hồi lẫn dữ liệu đọc lại sau thu hồi/nộp lại |
| Giáo viên đọc được bài nháp chưa nộp và tải được tệp nháp | State giáo viên chỉ chứa bài đã nộp/đã chấm; quyền tải tệp kiểm tra chủ sở hữu, học liệu đã xuất bản hoặc tệp trong bài đã nộp của đúng lớp | Kiểm thử vòng đời nháp → nộp → thu hồi, quyền tệp của giáo viên/học viên khác và học liệu xuất bản              |
| API xuất bản video kiểu UPLOAD không có tệp xác thực      | URL do server tạo từ tệp video đã xác thực, thuộc giáo viên và đúng lớp; bản nháp chưa có tệp giữ URL trống và chưa thể xuất bản            | Kiểm thử thiếu ID, tệp chưa xác thực, sai chủ/sai lớp/sai MIME và trường hợp hợp lệ                             |
| Giao diện cho thu hồi bài sau hạn khi bật nộp muộn        | Nút thu hồi chỉ hiện trước hạn, thống nhất với backend; nộp muộn không kéo dài thời hạn thu hồi                                             | Kiểm thử backend cho hai giá trị `allowLate` và Playwright kiểm tra nút sau hạn                                 |

Nguồn chính: [nghiệp vụ và phân quyền](../src/lib/server/actions.ts), [API tải tệp](../src/app/api/files/[id]/route.ts), [giao diện bài tập](../src/components/student.tsx), [kiểm thử backend](../tests/backend.test.ts), [kiểm thử trình duyệt](../tests/e2e.spec.ts), [kiểm thử tích hợp](../scripts/integration-test.mjs).

Điểm nháp cũ trên bản ghi DRAFT do phiên bản trước tạo ra cũng được xóa khi học viên lưu hoặc nộp lại. Giáo viên không tiếp tục dùng điểm nháp của lần nộp trước cho bài đã sửa. Khi học viên thu hồi bài đang mở trong cửa sổ chấm, giao diện thông báo bài không còn khả dụng.

## Sửa thêm trước khi mở tên miền

- JSON đăng nhập/quản trị/tải tệp được giới hạn 8.000 byte; actions 200.000 byte. Bộ đọc giới hạn ngay trên stream, kiểm tra JSON là object và trả 400/413 thay vì lỗi 500 hoặc đọc body không giới hạn.
- Đăng nhập giữ lượt thử trước khi truy vấn bất đồng bộ, tránh bỏ lọt nhiều yêu cầu đồng thời; bộ nhớ giới hạn số khóa. Header IP chỉ được tin khi cấu hình proxy rõ ràng.
- Form chấm gửi lần nộp/mốc nộp đang mở; backend trả 409 nếu học viên đã nộp lại, tránh chấm nhầm bài mới từ cửa sổ cũ.
- Hoàn tất video kiểm tra lại quyền lớp/tài khoản trước khi ghi dữ liệu. CLI cấp giáo viên nhận mật khẩu khởi tạo riêng cho quản trị production.
- Healthcheck thật qua PostgreSQL và Bash deploy có kiểm thử build lỗi, rollout lỗi/khôi phục image, lịch sử Git lệch, giữ cấu hình, khóa triển khai, giới hạn backup và tự thay script khi cập nhật.

## Sửa theo phản hồi khi sử dụng

- Thông báo nhắc nộp có badge chưa đọc, banner trên trang, lịch sử và liên kết bài tập. Không tự đánh dấu đọc khi chỉ mở chuông; chỉ cập nhật đúng ID đã đọc để tránh nuốt lời nhắc mới đến. Giáo viên nhận phản hồi đúng khi không còn học viên cần nhắc.
- Giáo viên quản lý từng bài trong bảng riêng: chọn xem bài nộp, sửa đề/hạn/chính sách hoặc xóa với xác nhận tên. Quyền chỉnh sửa/xóa chỉ thuộc giáo viên của lớp; thao tác xóa không ảnh hưởng bài khác hay bài giảng.
- Số từ do giáo viên đặt cho từng bài. Bài mới mặc định tối thiểu 150, tối đa không giới hạn (`maxWords: null`); giao diện và backend dùng chung quy tắc. Yêu cầu cũ không tự bị đổi, bài nộp/điểm đã có được giữ khi sửa đề.
- Người giảng nội dung là trường riêng của lớp; để trống thì không hiện trên thẻ lớp. Bỏ tên người giảng và chương mục được gán cố định trong giao diện; gợi ý chương chỉ lấy từ chính lớp đó.
- Migration mới cho phép `Assignment.maxWords` null, thêm `Classroom.contentAuthor` và liên kết thông báo với bài tập. Đã thử nâng cấp từ image production trước đó trong database biệt lập: giữ nguyên lớp, yêu cầu 300–500 từ cũ, bài nộp, điểm 90 và phiên đăng nhập đã ký. Xóa lớp/bài tập cũng dọn thông báo liên quan để không còn tham chiếu database bị lỗi.

## Chỉnh sửa và quản lý thảo luận

- Người viết được sửa/xóa bài của mình; chỉ giáo viên sở hữu lớp được xóa bài của người khác. Giáo viên khác hoặc quyền quản trị tài khoản không tự cấp quyền sửa/xóa thảo luận của lớp không phụ trách. Kiểm tra quyền và quyền xem bài học nằm ở backend.
- Nội dung chỉnh sửa phải có 1–5.000 ký tự sau trim. Giữ người viết, bài học và ngày đăng, bổ sung `updatedAt` khi nội dung thực sự thay đổi. Migration chỉ thêm cột nullable; bình luận cũ không bị sửa hoặc gắn nhãn chỉnh sửa giả.
- Sửa và xóa gửi nội dung gốc để đối chiếu trong transaction. Bản đã thay đổi trả 409; bản bị xóa trả 404. Giao diện giữ bản soạn và chặn lưu/xóa từ cửa sổ cũ; xóa phải xác nhận.
- Khung thảo luận giữ trạng thái khi đổi tab; polling không thay bản đang viết. Kho bài giảng có liên kết vào thảo luận để giáo viên quản lý trực tiếp.
- Kiểm thử gồm người viết, bạn học, giáo viên của lớp, giáo viên khác, mất quyền vào lớp, nội dung rỗng/quá dài, bài chưa xuất bản và hai phiên thao tác đồng thời. PostgreSQL/S3 kiểm tra ghi/đọc lại chỉnh sửa, quyền xóa và nâng cấp dữ liệu bình luận cũ.

## Phạm vi rà soát

Đã đối chiếu các trang và Route Handlers trong `src/app`, giao diện/provider đồng bộ trong `src/components`, nghiệp vụ/xác thực/kho tệp trong `src/lib`, schema và năm migration, sáu script vận hành/kiểm thử, mười bốn file test, cấu hình và tài liệu. Các font/giấy phép cùng 34 bản xuất Stitch được kiểm tra về vai trò tài nguyên và tài liệu tham chiếu.

Đã đọc hướng dẫn Next.js đóng gói cùng phiên bản đang cài trong `node_modules/next/dist/docs/`. Mười chín dependency trực tiếp trên máy phát triển khớp lockfile. Image Docker cũng cài mới bằng `npm ci` và build thành công trên server, không dùng `node_modules` hoặc `.next` của máy phát triển.

Đã quét tệp văn bản dự án theo mẫu khóa riêng, token GitHub, access key AWS và URL database có mật khẩu. Không phát hiện các mẫu đó ngoài thông tin mẫu cục bộ được ghi rõ trong tài liệu. Tệp môi trường thực tế, dữ liệu `.data`, dependency, build, ảnh kiểm thử và thư mục backup được Git/Docker loại trừ phù hợp. Kiểm tra theo mẫu không thay thế kiểm tra nội dung từng bí mật trước khi bổ sung dữ liệu mới.

## Kết quả chạy lại

| Kiểm tra                                    | Kết quả                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TypeScript                                  | Đạt                                                                                                   |
| Prettier mã nguồn                           | Đạt                                                                                                   |
| Backend                                     | **90/90 đạt**, gồm backend, request, rate limit và Bash deploy                                        |
| Playwright                                  | **17/17 đạt**, không bỏ qua ca nào; gồm giới hạn JSON/login đồng thời                                 |
| Build production trên máy phát triển        | Đạt, Turbopack mặc định                                                                               |
| Docker build trên server đích               | Đạt; Node.js 22.23.4, Next.js 16.4.4, Prisma 6.19.0                                                   |
| Migration PostgreSQL trên server            | Ba migration chạy thành công trên PostgreSQL **17.11**                                                |
| Bootstrap quản trị bằng CLI trong container | Tạo giáo viên, cấp quản trị và tạo học viên qua API thành công                                        |
| PostgreSQL + S3 qua HTTP                    | **90/90 kiểm tra đạt**, gồm PDF, video, quyền tệp nháp, xóa điểm nháp, chống ghi đè video đã xác thực |
| User chạy ứng dụng                          | UID 1000, không phải root                                                                             |
| Cookie production                           | Có Secure và HttpOnly trong kiểm tra HTTP nội bộ                                                      |
| Dependency ứng dụng                         | `npm ci` trong Docker báo 0 lỗ hổng đã biết tại thời điểm chạy                                        |

Playwright dùng bản sao mã nguồn/dữ liệu JSON trong thư mục tạm, có quản trị viên thử nghiệm riêng. Dev server thử nghiệm dùng Webpack để dùng chung dependency; build production Turbopack được kiểm tra riêng. Dữ liệu `.data/` của người dùng không được dùng làm fixture hoặc ghi đè.

Kiểm thử server dùng project Compose, database, bucket và cổng loopback riêng. Tài khoản kiểm thử là các tài khoản được cấp thật trong database thử, không bật đăng nhập demo. Các bước S3 chạy với S3rver 3.7.1 trong network Docker; chưa dùng thông tin xác thực AWS/R2 thật.

Fixture PDF/MP4 chỉ có byte nhận dạng tối thiểu để kiểm tra đường truyền và validation; không chứng minh video phát được hoặc xác thực được tài liệu hoàn chỉnh. Lượt này chưa kiểm thử file video 2 GiB, bucket/IAM/CORS thật hoặc tải đồng thời nhiều học viên. HTTPS thật được xác minh riêng bằng trình duyệt sau triển khai.

Đã khởi động lại app/PostgreSQL và xác nhận tài khoản cùng phiên đăng nhập đã ký vẫn dùng được. Bản sao lưu `pg_dump` định dạng custom đã được khôi phục vào một database thử riêng và giữ nguyên hai tài khoản kiểm thử.

Project Compose và volume kiểm thử đã được dọn riêng. Project production `lms-dtq` tiếp tục chạy ở `/home/bluenip/apps/lms-dtq`, app mở `127.0.0.1:3000`. Chỉ route gốc `zimaos.click` chuyển từ AdGuard sang LMS theo phép chủ server; route Anki/Home Assistant và AdGuard trên LAN được giữ nguyên.

## Cấu hình triển khai đã bổ sung

- [Dockerfile](../Dockerfile): build nhiều giai đoạn, Node.js 22/Debian có OpenSSL, chạy user không phải root, healthcheck và công cụ migration/tài khoản.
- [compose.production.yml](../compose.production.yml): project riêng `lms-dtq`, PostgreSQL có volume, migration trước app, cổng loopback, tự khởi động lại và giới hạn log.
- [.env.production.example](../.env.production.example): cấu hình thật được cấp lúc chạy, không đóng gói bí mật trong image.
- [Kho S3 thử nghiệm](../docker/s3rver/server.cjs): thay image MinIO cũ không tải được bằng S3rver chỉ dùng cho phát triển/kiểm thử; bucket tạo tự động và chỉ hỗ trợ truy cập theo đường dẫn.

Compose phát triển dùng volume `local_s3_data` riêng cho bộ giả lập, không tái sử dụng volume `object_data` của cấu hình MinIO cũ. Đây không phải công cụ chuyển đổi dữ liệu MinIO.

## Server đích

| Hạng mục                    | Kết quả kiểm tra                                                                |
| --------------------------- | ------------------------------------------------------------------------------- |
| Hệ điều hành / kiến trúc    | Ubuntu 26.04.1 LTS, x86_64                                                      |
| CPU / RAM                   | 4 CPU, khoảng 5.1 GiB RAM                                                       |
| Dung lượng trước thử nghiệm | Còn khoảng 85 GiB                                                               |
| Docker / Compose            | Docker 29.1.3, Compose 2.40.3                                                   |
| Node.js/npm trên host       | Chưa có trong PATH; cấu hình Docker đã chạy được mà không cần cài Node lên host |
| Tunnel                      | `cloudflared` đang hoạt động; `zimaos.click` → `http://127.0.0.1:3000`          |

Build và các thao tác thực tế ở trên xác nhận khả năng chạy ứng dụng trên server. Chưa có phép đo để cam kết số học viên đồng thời hoặc băng thông phát video. Tên miền HTTPS đã được kiểm tra đăng nhập quản trị, API quản trị, cookie Secure/HttpOnly và healthcheck từ trình duyệt qua Cloudflare. Còn cần bucket vận hành và kiểm thử video thật/CORS.

## Vận hành sau triển khai

- Mã đã đẩy lên GitHub; Bash fetch `origin/main`, triển khai commit mới và giữ cấu hình thật. Healthcheck đã trả 503 khi tắt PostgreSQL thử nghiệm và 200 sau khi khởi động lại.
- User timer `lms-dtq-update.timer` được bật; `Linger=yes`, Docker và cloudflared đều enabled. App/PostgreSQL dùng `restart: unless-stopped`. Chưa reboot toàn máy để tránh gián đoạn các dịch vụ khác.
- Quản trị đầu tiên `admin@zimaos.click` có mật khẩu riêng ngẫu nhiên; đăng nhập bằng mật khẩu mặc định bị từ chối. Bản cấp mật khẩu ban đầu nằm ở `.deploy/admin-credentials.json` trên server, quyền 600; không commit hoặc in vào log.
- Đăng nhập qua HTTPS thật, trang quản trị/API và cookie Secure/HttpOnly đã được kiểm tra bằng Chromium. Không có tài khoản/lớp demo trong production.

## Giới hạn còn lại

> Đây là ảnh chụp tại thời điểm rà soát ban đầu; các mục dưới có thể đã được khắc phục. Xem README và DEPLOYMENT để biết trạng thái hiện tại.

- Tài khoản mới/reset hiện được cấp mật khẩu tạm ngẫu nhiên; cần bảo vệ việc bàn giao mật khẩu.
- Repository đọc toàn bộ snapshot và upsert toàn bộ dữ liệu khi ghi; advisory lock tuần tự hóa các lần ghi. Polling 3 giây còn hạn chế khi dữ liệu/phiên đồng thời tăng.
- Rate limit trong bộ nhớ không chia sẻ giữa nhiều instance; cấu hình proxy/IP client phải phù hợp môi trường thực tế.
- Chưa có quét mã độc, dọn object mồ côi, vòng đời tệp chờ xác thực hoặc tự xóa object khi xóa lớp.
- Chưa có công cụ chuyển JSON demo sang PostgreSQL. Updater sao lưu trước deploy, giữ ba bản trên cùng server; chưa có backup định kỳ ra nơi khác. Hướng dẫn ở [DEPLOYMENT.md](DEPLOYMENT.md).

Các hàm đăng ký/xác minh/khôi phục email cũ vẫn còn và được một phần test backend kiểm tra. Website hiện chặn các API công khai đó; các test đạt không có nghĩa chúng đã được mở lại.
