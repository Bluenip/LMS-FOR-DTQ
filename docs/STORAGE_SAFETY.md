# Kho tệp sau đợt sửa 03/11/2026

API hoàn tất xác thực nội dung/ETag, sao chép sang khóa riêng cho phiên bản nguồn, ghi khóa đã xác thực vào database, rồi mới dọn nguồn. Lỗi trước khi commit giữ nguồn để thử lại. Lỗi dọn nguồn sau commit vẫn trả thành công; tác vụ prune sẽ dọn bản dư. Hai phiên hoàn tất cùng tệp trả về bản đã commit đầu tiên. Ghi lại vào URL PUT cũ không thay thế bản đã công bố.

Tài liệu tải qua ứng dụng cũng tạo bản ghi giữ chỗ trước khi ghi S3. Mọi giữ chỗ và kiểm tra hạn mức diễn ra trong cùng transaction ghi, dùng chung giữa các tiến trình. Mặc định:

- 10 GiB dung lượng tệp/tài khoản (`LMS_UPLOAD_USER_QUOTA_BYTES`).
- 100 GiB dung lượng tệp/lớp (`LMS_UPLOAD_CLASS_QUOTA_BYTES`).
- 3 bản ghi đang tải trong một giờ/tài khoản; 60 yêu cầu tải mới/giờ/tài khoản, gồm cả yêu cầu lỗi. Bộ đếm yêu cầu dùng PostgreSQL khi có database production.
- Tối đa 2 yêu cầu đang đệm/xác thực tệp trên mỗi tiến trình, 1 yêu cầu/tài khoản trên mỗi tiến trình. Bộ đọc multipart giới hạn 26 MiB và 60 giây. Mỗi tài liệu vẫn tối đa 25 MiB; video tối đa 2 GiB và tải trực tiếp lên S3.

Hạn mức dung lượng tính cả bản ghi đã xác thực và giữ chỗ chưa hoàn tất. Nó tính dung lượng tệp logic; bản sao tạm/nguồn chưa dọn có thể tăng dung lượng thực tế tại nhà cung cấp. Khi bổ sung nhiều replica, vẫn cần đặt giới hạn RAM/container và theo dõi chi phí kho. Không tự xóa tài liệu đang gắn bài học/bài nộp để giải phóng hạn mức.

`npm run storage:prune` chỉ khảo sát. `npm run storage:prune -- --apply` xóa object và bản ghi không còn tham chiếu, cũ ít nhất 30 ngày. Bao gồm giữ chỗ lỗi chưa từng ghi object và bản sao do hoàn tất gián đoạn. Giữ retention tối thiểu 30 ngày; xem kết quả khảo sát trước khi áp dụng.

Script liệt kê và xóa object ngoài transaction; mỗi lớp chỉ bị khóa ngắn để kiểm tra lại tham chiếu và xóa bản ghi cũ. Chỉ xóa object sau khi bản ghi cùng ID đã được gỡ, nên một yêu cầu hoàn tất tải lên đồng thời không thể ghi tham chiếu tới object đã xóa. Các bản sao của một bản ghi còn tồn tại được giữ lại. Lệnh `--apply` yêu cầu PostgreSQL: chế độ JSON chỉ hỗ trợ khảo sát vì không có khóa liên tiến trình. Lỗi S3 có thể khiến một lượt dọn chỉ hoàn thành một phần; chạy lại để dọn tiếp. Sao lưu object và kiểm tra khả năng khôi phục trước khi dùng `--apply`.

`GET /api/health` kiểm tra ứng dụng/database riêng và thêm `storage`: `unconfigured`, `reachable` hoặc `unavailable`. Probe chỉ thực hiện HEAD bucket, giới hạn 3 giây, cache một phút, không trả tên bucket/khóa truy cập/lỗi nội bộ. `reachable` chứng minh bucket có thể được truy cập theo quyền HEAD; chưa chứng minh PUT, GET hay CORS từ trình duyệt. Kho tùy chọn không làm healthcheck ứng dụng thất bại.

Sau khi cấp kho thật, chạy thử tài liệu và video trên lớp kiểm thử, kiểm tra tải/xem lại qua trình duyệt cùng origin production, cấu hình CORS đúng origin và phương thức/headers cần dùng. Sao lưu database không thay thế sao lưu object: cần bật versioning/retention hoặc sao chép object sang kho backup độc lập, bảo vệ thông tin truy cập, và thử khôi phục cả database lẫn các object được tham chiếu. Production chưa có thông tin truy cập S3/R2 thì upload vẫn báo chưa sẵn sàng.
