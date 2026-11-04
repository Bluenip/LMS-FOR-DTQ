# Sao lưu và diễn tập khôi phục object

`scripts/backup-objects.mjs` đọc toàn bộ object hiện hành trong bucket nguồn, ghi từng object theo SHA-256 của **khóa** vào snapshot mới và lưu tên khóa, loại nội dung, một số metadata cùng SHA-256 của **nội dung** trong manifest. Nó không xóa hoặc sửa object nguồn hay bản backup cũ. Sau khi tải xong, script đọc lại toàn bộ byte để đối chiếu; chỉ snapshot có tệp `COMPLETE` là đã hoàn thành. Object thay đổi giữa lần liệt kê và tải sẽ khiến lượt sao lưu thất bại. Theo dõi lỗi và dung lượng trống: mỗi lượt lưu thêm một bản đầy đủ, không tự xóa các bản cũ hoặc bản chưa hoàn thành.

**Snapshot chứa dữ liệu rõ, kể cả tên tệp và nội dung bài làm.** Dùng ổ backup độc lập, được mã hóa ở cấp volume và bảo vệ khóa mã hóa riêng; quyền thư mục/tệp `700`/`600` không thay thế mã hóa. Bảo vệ máy backup và thông tin truy cập; chỉ cấp quyền đọc bucket nguồn cho khóa sao lưu. Script lưu metadata nội dung cơ bản và metadata tùy chỉnh; nó không sao lưu ACL, object tags, version history, lifecycle hay chính sách bucket. Cần sao lưu/cấu hình riêng các thành phần đó nếu sử dụng.

Snapshot object **không nguyên tử với backup PostgreSQL**. Để có cặp sao lưu nhất quán, ngừng tải/sửa/xóa tệp và mọi tác vụ prune, sao lưu database và bucket trong cùng cửa sổ bảo trì, sau đó mới mở ghi trở lại. Diễn tập phục hồi database và bucket vào hệ thống thử riêng, đối chiếu mọi tệp được database tham chiếu trước khi dùng bản sao. Tránh chạy prune giữa thời điểm tạo hai bản sao. Không suy ra một snapshot đã hoàn thành chứa object mới phát sinh sau lúc bắt đầu liệt kê bucket.

## Cấu hình máy backup riêng

1. Cài Node.js 22 hoặc 24 và dependency dự án bằng `npm ci`. Mount volume độc lập, mã hóa, rồi tạo sẵn thư mục đích trên volume. Chương trình kiểm tra mountpoint, từ chối `/` và từ chối đường dẫn đích nằm ngoài mountpoint đã chọn; vẫn cần tự xác nhận volume thực sự là bản sao độc lập.
2. Tạo `~/.config/lms-dtq-object-backup/config` thuộc tài khoản chạy timer, quyền `600`. Đây là **file shell**, chỉ được sửa bởi chủ sở hữu. Điền thông tin thật bằng trình soạn thảo an toàn, không ghi lên Git hoặc paste vào terminal dùng chung:

   ```sh
   S3_ENDPOINT='https://ACCOUNT.r2.cloudflarestorage.com'
   S3_REGION='auto'
   S3_BUCKET='source-bucket'
   S3_ACCESS_KEY_ID='read-only-access-key'
   S3_SECRET_ACCESS_KEY='read-only-secret'
   LMS_OBJECT_BACKUP_MOUNT='/mnt/ENCRYPTED-BACKUP'
   LMS_OBJECT_BACKUP_DIR='/mnt/ENCRYPTED-BACKUP/lms-objects'
   ```

   Với AWS S3 có thể để `S3_ENDPOINT=''` và đặt region phù hợp. Bucket phải cho phép liệt kê và đọc object; không cần quyền xóa hay ghi. Không dùng file cấu hình dưới dạng tham số dòng lệnh. Lệnh `chmod 600 ~/.config/lms-dtq-object-backup/config` bảo vệ file; script từ chối file thuộc người khác, symbolic link hoặc cho phép nhóm/người khác truy cập.

3. Chạy thử `bash scripts/run-object-backup.sh`. Sau khi xác nhận snapshot và kiểm tra dung lượng, chạy `bash scripts/install-object-backup-timer.sh` để cài user timer hằng ngày trên **máy backup**, không phải trong container ứng dụng. Xem `systemctl --user list-timers lms-dtq-object-backup.timer` và `journalctl --user -u lms-dtq-object-backup.service`. Máy và ổ phải sẵn sàng; cấu hình user service/lingering nếu cần chạy khi đăng xuất. Nếu cấu hình thiếu hoặc ổ không mount, tác vụ thất bại thay vì ghi nhầm vào root disk.

## Kiểm chứng và diễn tập

Kiểm tra lại một snapshot, không cần thông tin S3:

```sh
node scripts/backup-objects.mjs --verify '/path/to/snapshot'
node scripts/backup-objects.mjs --restore-local '/path/to/snapshot' '/path/to/new-rehearsal-directory'
```

Thư mục diễn tập phải chưa tồn tại; lệnh tạo bản sao đầy đủ và đối chiếu SHA-256 mà không ghi đè dữ liệu. File `manifest.json` ánh xạ tên tệp trên ổ tới object key. Có thể kiểm tra tiếp bản diễn tập bằng `--verify`.

Để diễn tập phục hồi **vào bucket thử nghiệm hoàn toàn trống**, cấp một cặp khóa riêng có quyền list, put và get cho bucket đó, rồi thiết lập các biến môi trường sau bằng file riêng tư tương tự file cấu hình ở trên:

```sh
S3_BUCKET='source-bucket'
LMS_RESTORE_BUCKET='different-empty-test-bucket'
LMS_RESTORE_ENDPOINT='https://ACCOUNT.r2.cloudflarestorage.com'
LMS_RESTORE_REGION='auto'
LMS_RESTORE_ACCESS_KEY_ID='restore-test-key'
LMS_RESTORE_SECRET_ACCESS_KEY='restore-test-secret'
LMS_RESTORE_CONFIRM_EMPTY_BUCKET='yes'
```

Nạp các biến vào môi trường riêng (`set -a; source /path/to/private-restore-config; set +a`), rồi chạy `node scripts/backup-objects.mjs --restore-bucket '/path/to/snapshot'`. Lệnh xác minh snapshot trước, từ chối bucket trùng tên nguồn hoặc có dữ liệu, ghi có điều kiện và đọc lại từng object để kiểm tra SHA-256. Bucket đích phải dành riêng cho lượt diễn tập, không cho tiến trình khác ghi đồng thời; kiểm tra nhà cung cấp hỗ trợ `If-None-Match: *` cho PutObject. Nếu một lượt phục hồi lỗi giữa chừng, bucket sẽ còn dữ liệu một phần và lệnh không tự xóa hay ghi đè; kiểm tra và dùng bucket thử nghiệm mới. Không trỏ biến phục hồi vào bucket production.

Việc xác nhận toàn vẹn byte không xác nhận CORS, IAM, tính nhất quán database, khả năng phát video lâu hoặc hiệu năng CopyObject của R2/S3 thật. Cần thử riêng các tình huống đó trên hệ thống và bucket thử nghiệm.
