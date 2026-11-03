# Xử lý báo cáo kiểm thử ngày 03/11/2026

Nguồn: `bao-cao-kiem-thu-lms-2026-11-03.md`, bản gốc `aec7037150f7`.

| Mục | Thay đổi / giới hạn |
| --- | --- |
| 1, 2, 12 | Bài tập có trạng thái công bố độc lập; xóa/gỡ bài giảng nháp giữ ẩn, giáo viên chọn công bố rõ ràng. Lưu lần thông báo đầu tiên để không gửi lại khi tái xuất bản. |
| 3 | Lưu nội dung đang sửa bình luận vào sessionStorage, cảnh báo rời trang/hủy; giữ kiểm tra xung đột. |
| 4 | Sao chép theo phiên bản object; chỉ dọn nguồn sau khi database commit. Thử lại được khi sao chép/ghi database thất bại; lỗi dọn không làm mất bản đã lưu. |
| 5 | Đặt hạn mức tổng theo tài khoản/lớp, đặt chỗ trong transaction, giới hạn tốc độ/số tệp chờ và bộ nhớ/đồng thời trước khi đọc body. Chi tiết: [kho tệp](STORAGE_SAFETY.md). |
| 6 | Đăng xuất tăng sessionVersion bền vững, vô hiệu cookie đã sao chép. Chính sách: các thiết bị khác của cùng tài khoản cũng phải đăng nhập lại; cookie cũ không thu hồi được phiên mới. |
| 7 | Timeout toàn bộ backup và SSH/pg_dump/pg_restore; timer giới hạn 11 phút, lỗi được ghi journal và giữ backup trước. Backup object còn phụ thuộc kho thật. |
| 8 | Có script đo tải trên dữ liệu giả, chỉ cho URL loopback và xác nhận môi trường thử. Không cam kết số học viên tối đa từ phép đo nhỏ. |
| 9 | Chưa có kho S3/R2 thật; không tự bật dịch vụ trả phí hoặc thay bằng kho demo. YouTube và bài viết tiếp tục hoạt động. |
| 10, 11 | Bản đang viết vẫn hiện để sao chép khi phiên khác nộp/chấm; phân biệt bài nộp bằng liên kết, tệp và văn bản. |
| 13 | PostgreSQL lưu bộ đếm dùng chung giữa tiến trình và sau restart, giới hạn theo IP, tài khoản và cặp IP/email. Chế độ demo JSON vẫn dùng bộ nhớ một tiến trình. |
| 14 | Giữ quyền xem bài đã nộp/điểm và tệp của chính học viên khi bài bị ẩn; chặn nộp mới vào bài chưa công bố. |
| 15 | Migration mới chỉ thêm cột/bảng; hướng dẫn rollback rõ image không hạ schema. Không tự phục hồi database thật khi deploy lỗi. |
| 16 | Health trả trạng thái kho riêng: unconfigured/reachable/unavailable, probe HeadBucket có timeout/cache. CORS/PUT/GET vẫn phải kiểm tra khi cấu hình kho thật. |
| 17–20, 22 | API yêu cầu revision/thời điểm tham gia đúng bản đang xác nhận; từ chối yêu cầu cũ. Chấm điểm tăng revision để thu hồi cũ không xóa điểm nháp. |
| 21 | Chặn nhắc nộp bài chưa công bố. |

Phát hiện bổ sung: đổi tab bài học liên tục có thể kết thúc ở tab cũ do các điều hướng chồng nhau. Dùng History API được Next.js hỗ trợ cho trạng thái query tại trang. Tên backup thêm PID để tránh hai lượt trong cùng giây ghi đè. Thông báo lỗi bài giảng chỉ hiển thị tại vùng đang thao tác, tránh hiện trùng giữa form và hộp xác nhận xóa.

## Vận hành

LMS chuyển từ `bluenip@100.109.157.88` sang `bluenip@100.71.200.54`, thư mục `/home/bluenip/apps/lms-dtq`, tên miền `https://zimaos.click`. Tunnel riêng `lms-orlab`; Anki vẫn ở máy cũ với `https://thaituan.site`. Không chuyển Home Assistant hay dịch vụ khác.

Quy trình: build và thử PostgreSQL/S3 trên stack riêng → dừng ghi LMS cũ → dump và kiểm tra backup → restore sang database mới → migration bổ sung → kiểm tra app → chuyển riêng DNS LMS. Giữ database/backup máy cũ để phục hồi có kiểm soát. Sau khi máy mới đã nhận bài nộp/chỉnh sửa, không trỏ ngược về database cũ mà chưa đồng bộ dữ liệu mới.

## Kiểm thử

- 139 kiểm thử Node (nghiệp vụ, phiên đăng nhập, storage, backup và deploy) đạt; TypeScript, Prettier và build production đạt.
- 28 kịch bản trình duyệt đạt, không bỏ qua: 26 đạt trong lượt toàn bộ; hai ca lỗi được sửa mã hiển thị/thông tin tài khoản thử rồi chạy lại đạt. Bao gồm desktop/điện thoại, quản trị tài khoản, nhiều giáo viên, đồng bộ phiên và ba hồi quy mới của báo cáo.
- PostgreSQL 17 và S3rver trên stack `lms-validation` riêng: 148 kiểm tra HTTP đạt; gồm quyền truy cập, thông báo, revision, cookie logout và tải tệp.
- Lượt backup do systemd hẹn giờ ngày 03/11/2026 lúc 15:44 UTC tới máy mới hoàn tất không tương tác (`Result=success`, exit 0); archive mã hóa được giải mã và kiểm tra danh sách PostgreSQL thành công. Đây xác minh chạy theo lịch, không giả định mọi ngày tương lai đều thành công.
- Không chạy kiểm thử ghi hoặc đo tải vào lớp thật. Kho tệp thật chưa cấu hình; các kiểm tra upload sử dụng S3 giả lập riêng.


## Xác minh sau chuyển máy

Chuyển ngày 03/11/2026, khoảng 15:47 UTC. Bản sửa đầu tiên `7efdc0310748` được build trên máy mới; migration hoàn tất, app/PostgreSQL healthy. Dump cuối cùng có SHA-256 khớp ở hai đầu; 12 bảng ứng dụng khớp số dòng và checksum nội dung (bỏ hai cột công bố mới khi đối chiếu). Dữ liệu có 3 tài khoản, 1 lớp, 0 tệp kho. Không seed dữ liệu thử vào production.

HTTPS `https://zimaos.click/api/health` trả `{"status":"ok","storage":"unconfigured"}`; trang đăng nhập trả 200. DNS gốc trỏ tunnel `aa718ade-b412-4440-879f-eb85105ff889` (`lms-orlab`). `https://thaituan.site` vẫn trả 200; tunnel Anki cũ và các container Anki/Home Assistant không thay đổi.

Máy mới bật Docker, user lingering, `lms-tunnel.service` và `lms-dtq-update.timer` để tự chạy khi khởi động. Máy cũ chỉ dừng hai container LMS và tắt timer cập nhật LMS/restart policy của chúng; giữ nguyên volume, image và backup cuối trong `.deploy/migration/`. Backup hằng ngày trên máy có ổ `/mnt/BACKUP` đã đổi host thành `bluenip@100.71.200.54` và chạy thành công sau chuyển. Chưa reboot toàn máy.

Phép đo PostgreSQL với 100 bài giảng giả, 10 yêu cầu đồng thời: đọc p95 51 ms, ghi p95 116 ms, không lỗi. Phương pháp và giới hạn tại [INTEGRATION.md](INTEGRATION.md).
