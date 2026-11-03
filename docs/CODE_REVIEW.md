# Kết quả rà soát và sửa lỗi LMS

Cập nhật **03/11/2026**. Bốn lỗi được phát hiện trong lượt rà soát đầu đã được sửa trong mã nguồn và có kiểm thử hồi quy. Ứng dụng cũng đã được build/chạy thử bằng Docker trên server đích với PostgreSQL và kho S3 giả lập riêng.

## Những lỗi đã sửa

| Vấn đề ban đầu                                            | Hành vi sau khi sửa                                                                                                                         | Bằng chứng kiểm tra                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Học viên nhận được điểm/nhận xét chưa trả khi thu hồi bài | Dùng chung cách lọc bài nộp cho state và phản hồi mutation; xóa điểm, rubric, nhận xét và mốc trả điểm khi thu hồi hoặc sửa bản nháp        | Kiểm thử backend, HTTP Playwright và PostgreSQL/S3 kiểm tra cả phản hồi lẫn dữ liệu đọc lại sau thu hồi/nộp lại |
| Giáo viên đọc được bài nháp chưa nộp và tải được tệp nháp | State giáo viên chỉ chứa bài đã nộp/đã chấm; quyền tải tệp kiểm tra chủ sở hữu, học liệu đã xuất bản hoặc tệp trong bài đã nộp của đúng lớp | Kiểm thử vòng đời nháp → nộp → thu hồi, quyền tệp của giáo viên/học viên khác và học liệu xuất bản              |
| API xuất bản video kiểu UPLOAD không có tệp xác thực      | URL do server tạo từ tệp video đã xác thực, thuộc giáo viên và đúng lớp; bản nháp chưa có tệp giữ URL trống và chưa thể xuất bản            | Kiểm thử thiếu ID, tệp chưa xác thực, sai chủ/sai lớp/sai MIME và trường hợp hợp lệ                             |
| Giao diện cho thu hồi bài sau hạn khi bật nộp muộn        | Nút thu hồi chỉ hiện trước hạn, thống nhất với backend; nộp muộn không kéo dài thời hạn thu hồi                                             | Kiểm thử backend cho hai giá trị `allowLate` và Playwright kiểm tra nút sau hạn                                 |

Nguồn chính: [nghiệp vụ và phân quyền](../src/lib/server/actions.ts), [API tải tệp](../src/app/api/files/[id]/route.ts), [giao diện bài tập](../src/components/student.tsx), [kiểm thử backend](../tests/backend.test.ts), [kiểm thử trình duyệt](../tests/e2e.spec.ts), [kiểm thử tích hợp](../scripts/integration-test.mjs).

Điểm nháp cũ trên bản ghi DRAFT do phiên bản trước tạo ra cũng được xóa khi học viên lưu hoặc nộp lại. Giáo viên không tiếp tục dùng điểm nháp của lần nộp trước cho bài đã sửa. Khi học viên thu hồi bài đang mở trong cửa sổ chấm, giao diện thông báo bài không còn khả dụng.

## Phạm vi rà soát

Đã đối chiếu các trang và Route Handlers trong `src/app`, giao diện/provider đồng bộ trong `src/components`, nghiệp vụ/xác thực/kho tệp trong `src/lib`, schema và ba migration, năm script vận hành/kiểm thử, tám file test, cấu hình và tài liệu. Các font/giấy phép cùng 34 bản xuất Stitch được kiểm tra về vai trò tài nguyên và tài liệu tham chiếu.

Đã đọc hướng dẫn Next.js đóng gói cùng phiên bản đang cài trong `node_modules/next/dist/docs/`. Mười chín dependency trực tiếp trên máy phát triển khớp lockfile. Image Docker cũng cài mới bằng `npm ci` và build thành công trên server, không dùng `node_modules` hoặc `.next` của máy phát triển.

Đã quét tệp văn bản dự án theo mẫu khóa riêng, token GitHub, access key AWS và URL database có mật khẩu. Không phát hiện các mẫu đó ngoài thông tin mẫu cục bộ được ghi rõ trong tài liệu. Tệp môi trường thực tế, dữ liệu `.data`, dependency, build, ảnh kiểm thử và thư mục backup được Git/Docker loại trừ phù hợp. Kiểm tra theo mẫu không thay thế kiểm tra nội dung từng bí mật trước khi bổ sung dữ liệu mới.

## Kết quả chạy lại

| Kiểm tra                                    | Kết quả                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TypeScript                                  | Đạt                                                                                                   |
| Prettier mã nguồn                           | Đạt                                                                                                   |
| Backend                                     | **55/55 đạt**, gồm 7 ca hồi quy mới                                                                   |
| Playwright                                  | **11/11 đạt**, không bỏ qua ca nào; gồm 2 ca mới qua HTTP/giao diện                                   |
| Build production trên máy phát triển        | Đạt, Turbopack mặc định                                                                               |
| Docker build trên server đích               | Đạt; Node.js 22.23.4, Next.js 16.4.4, Prisma 6.19.0                                                   |
| Migration PostgreSQL trên server            | Ba migration chạy thành công trên PostgreSQL **17.11**                                                |
| Bootstrap quản trị bằng CLI trong container | Tạo giáo viên, cấp quản trị và tạo học viên qua API thành công                                        |
| PostgreSQL + S3 qua HTTP                    | **50/50 kiểm tra đạt**, gồm PDF, video, quyền tệp nháp, xóa điểm nháp, chống ghi đè video đã xác thực |
| User chạy ứng dụng                          | UID 1000, không phải root                                                                             |
| Cookie production                           | Có Secure và HttpOnly trong kiểm tra HTTP nội bộ                                                      |
| Dependency ứng dụng                         | `npm ci` trong Docker báo 0 lỗ hổng đã biết tại thời điểm chạy                                        |

Playwright dùng bản sao mã nguồn/dữ liệu JSON trong thư mục tạm, có quản trị viên thử nghiệm riêng. Dev server thử nghiệm dùng Webpack để dùng chung dependency; build production Turbopack được kiểm tra riêng. Dữ liệu `.data/` của người dùng không được dùng làm fixture hoặc ghi đè.

Kiểm thử server dùng project Compose, database, bucket và cổng loopback riêng. Tài khoản kiểm thử là các tài khoản được cấp thật trong database thử, không bật đăng nhập demo. Các bước S3 chạy với S3rver 3.7.1 trong network Docker; chưa dùng thông tin xác thực AWS/R2 thật.

Fixture PDF/MP4 chỉ có byte nhận dạng tối thiểu để kiểm tra đường truyền và validation; không chứng minh video phát được hoặc xác thực được tài liệu hoàn chỉnh. Lượt này chưa kiểm thử file video 2 GiB, bucket/IAM/CORS thật, hostname HTTPS thật hoặc tải đồng thời nhiều học viên.

Đã khởi động lại app/PostgreSQL và xác nhận tài khoản cùng phiên đăng nhập đã ký vẫn dùng được. Bản sao lưu `pg_dump` định dạng custom đã được khôi phục vào một database thử riêng và giữ nguyên hai tài khoản kiểm thử.

Sau kiểm tra, project Compose thử nghiệm, volume, image gắn tag thử và thư mục nguồn/khóa tạm trên server đã được dọn. Các dịch vụ hiện hữu vẫn chạy; chưa cấu hình route/DNS công khai cho LMS.

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
| Tunnel                      | Có dịch vụ `cloudflared` đang hoạt động; chưa sửa route/DNS của hostname LMS    |

Build và các thao tác thực tế ở trên xác nhận khả năng chạy ứng dụng trên server. Chưa có phép đo để cam kết số học viên đồng thời hoặc băng thông phát video. Khi dùng tên miền thật, còn cần cấu hình hostname HTTPS và kho tệp vận hành, rồi kiểm tra từ mạng ngoài server.

## Giới hạn còn lại

- Tài khoản mới/reset vẫn dùng mật khẩu mặc định chung `123@123aA`; chưa bắt buộc đổi ở lần đăng nhập đầu. Đổi mật khẩu quản trị và chốt cách cấp tài khoản trước khi mở cho người dùng thật.
- Repository đọc toàn bộ snapshot và upsert toàn bộ dữ liệu khi ghi; advisory lock tuần tự hóa các lần ghi. Polling 3 giây còn hạn chế khi dữ liệu/phiên đồng thời tăng.
- `/api/actions` đọc toàn bộ body rồi mới kiểm tra độ dài; cần đánh giá giới hạn request/bộ nhớ ở proxy và ứng dụng cho tải công khai.
- Rate limit trong bộ nhớ không chia sẻ giữa nhiều instance; cấu hình proxy/IP client phải phù hợp môi trường thực tế.
- Chưa có quét mã độc, dọn object mồ côi, vòng đời tệp chờ xác thực hoặc tự xóa object khi xóa lớp.
- Chưa có công cụ chuyển JSON demo sang PostgreSQL hay lịch backup tự động. Hướng dẫn backup và triển khai ở [DEPLOYMENT.md](DEPLOYMENT.md).

Các hàm đăng ký/xác minh/khôi phục email cũ vẫn còn và được một phần test backend kiểm tra. Website hiện chặn các API công khai đó; các test đạt không có nghĩa chúng đã được mở lại.
