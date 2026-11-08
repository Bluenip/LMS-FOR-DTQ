# Tài khoản — LỚP LẬP MỆNH

## Đăng nhập

Giao diện giữ thiết kế LỚP LẬP MỆNH, chỉ có email, mật khẩu và nút đăng nhập. Người dùng không tự đăng ký, không đặt lại mật khẩu bằng email. Các đường dẫn đăng ký/khôi phục cũ chuyển về `/login`; API công khai của những luồng này trả 403 và không thay đổi dữ liệu.

Mật khẩu mặc định khi quản trị viên tạo hoặc reset tài khoản là **`123@123aA`**. Người dùng đổi mật khẩu trong **Thông tin cá nhân** sau khi đăng nhập. Mật khẩu cá nhân mới cần từ 8 đến 128 ký tự.

## Trang quản trị

Người có quyền quản trị vào `/admin` qua liên kết **Quản trị** trên thanh điều hướng. Trang gồm giáo viên và học viên, tìm kiếm tên/email, lọc trạng thái và phân trang.

- **Tạo tài khoản**: chọn Giáo viên/Học viên, nhập họ tên và email. Không cần nhập hoặc gửi mật khẩu qua email; tài khoản mới hoạt động ngay với mật khẩu mặc định.
- **Sửa thông tin**: sửa họ tên, giữ nguyên email định danh và vai trò.
- **Kích hoạt**: duyệt một tài khoản cũ còn chờ kích hoạt.
- **Đặt lại mật khẩu**: yêu cầu xác nhận, khôi phục mật khẩu mặc định và vô hiệu hóa mọi phiên cũ.
- **Khóa/Mở khóa**: thay đổi quyền đăng nhập, giữ nguyên lớp, thành viên, bài làm và tiến độ.
- **Xóa tài khoản** (`DELETE /api/admin/users/{id}`, body `{confirmEmail}`): xóa vĩnh viễn tài khoản cùng ghi danh, bài nộp, tiến độ, ghi chép, thảo luận, thông báo và tệp riêng; học liệu bài giảng còn dùng được chuyển cho chủ lớp. Từ chối tự xóa, tài khoản quản trị và chủ lớp. Ghi vào nhật ký quản trị (`user.delete`, kèm email).

Quyền quản trị là một quyền riêng, không thay thế vai trò Giáo viên/Học viên. Không có nút hoặc API công khai để tự cấp quản trị. API quản trị từ chối người chưa đăng nhập, giáo viên bình thường và học viên; phản hồi không chứa mật khẩu băm, phiên bản phiên hay token.

Tài khoản quản trị được bảo vệ khỏi khóa/reset tại bảng quản lý. Quản trị viên tự đổi mật khẩu trong Thông tin cá nhân bằng mật khẩu hiện tại.

## Thông tin cá nhân

Cả giáo viên và học viên mở `/profile` qua **Thông tin cá nhân** trên thanh điều hướng để:

1. Sửa họ tên; email đăng nhập do quản trị viên cấp và hiển thị chỉ đọc.
2. Nhập mật khẩu hiện tại, mật khẩu mới và xác nhận để đổi mật khẩu.

Đổi mật khẩu thành công cấp lại cookie cho trình duyệt hiện tại, vô hiệu hóa các phiên và liên kết khôi phục cũ. Tự sửa hồ sơ không thể đổi email, vai trò, trạng thái khóa hay quyền quản trị. Nội dung nhập dở không bị mất do lần đồng bộ dữ liệu nền.

Nếu quên mật khẩu hiện tại, người dùng liên hệ quản trị viên để reset về mật khẩu mặc định, sau đó đăng nhập và tự đổi lại.

## Cấp quản trị lần đầu

Chạy từ terminal máy chủ với môi trường dữ liệu tương ứng. Với PostgreSQL mới:

```bash
npm run db:migrate
npm run account:create-teacher -- owner@example.com "Tên quản trị viên"
npm run account:grant-admin -- owner@example.com
```

Nếu tài khoản thật đã có, chỉ chạy `account:grant-admin`. Lệnh từ chối tài khoản mẫu, chưa kích hoạt hoặc đang khóa. Cấp quyền quản trị vô hiệu hóa các phiên trước đó; người dùng đăng nhập lại với mật khẩu hiện có. Tài khoản giáo viên được cấp bởi CLI cũng dùng mật khẩu mặc định chung.

Chạy `db:migrate` khi nâng cấp hệ thống. Migration thêm `isAdmin` và `disabled` mặc định false, không tự động cấp quyền hoặc khóa người dùng cũ. Dữ liệu demo cục bộ bổ sung trường mới khi đọc, không xóa dữ liệu đã lưu.

## Triển khai và kiểm thử

Luồng tài khoản hiện tại không cần SMTP. Public website dùng PostgreSQL, `SESSION_SECRET` riêng và `APP_URL` HTTPS khớp tên miền; tài khoản mẫu bị chặn mặc định. Không dùng `ALLOW_DEMO_ACCOUNTS=true` trên website chính thức.

Kiểm thử trình duyệt quản trị cần tài khoản quản trị **riêng cho kiểm thử**, cung cấp qua `ADMIN_E2E_EMAIL` và `ADMIN_E2E_PASSWORD`. Không có tài khoản quản trị mẫu với mật khẩu cố định trong mã nguồn. Kiểm thử tạo các tài khoản có tiền tố `e2e-admin-created-`; dọn tài khoản thử trong dữ liệu kiểm thử sau khi chạy, không dùng tài khoản thật làm fixture.

Đã kiểm tra migration trên PostgreSQL 18.6 và 24 bước tích hợp theo chính sách hiện tại: cấp cả hai vai trò với mật khẩu mặc định, tự đổi mật khẩu, reset về mặc định, thu hồi phiên, khóa/mở giữ nguyên đăng ký lớp, kích hoạt tài khoản cũ và bảo vệ quyền quản trị. Các bản ghi có sẵn giữ nguyên sau khi dọn fixture.
