# Tài liệu nghiệp vụ — LMS Đệ Tử Quy

Tài liệu mô tả **toàn bộ nghiệp vụ đang có trong code** (nhánh `quan/upgrade-lms`), không phải kế hoạch. Mỗi quy tắc đều lấy từ mã nguồn; nơi nào là giới hạn hoặc chưa có thì ghi rõ ở mục 16.

Tài liệu liên quan: [README.md](../README.md), [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md) (chi tiết kỹ thuật Drive), [DEPLOYMENT.md](DEPLOYMENT.md), [ACCOUNTS.md](ACCOUNTS.md).

---

## 1. Tổng quan

Ứng dụng quản lý lớp học trực tuyến bằng tiếng Việt. Giáo viên tổ chức lớp, bài giảng (video, tài liệu), bài tập và chấm điểm; học viên học, ghi chép, thảo luận, nộp bài; quản trị viên cấp và quản lý tài khoản, kết nối Google Drive.

- Công nghệ: Next.js (App Router) full-stack TypeScript, PostgreSQL (Prisma), lưu tệp trên Google Drive.
- Chế độ demo: khi `DATABASE_URL` trống, dữ liệu lưu ở `.data/demo.json` (một tiến trình Node, chỉ để phát triển).
- Toàn bộ nghiệp vụ lớp học đi qua **một điểm vào**: `POST /api/actions` với `{ "action": "<tên>", ... }`, xử lý trong `runAction` ([actions.ts](../src/lib/server/actions.ts)). Tài khoản, hồ sơ, Drive và tải tệp có route riêng.

## 2. Vai trò và quyền

| Vai trò                       | Cách có                                                                                         | Làm được                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Học viên** (`STUDENT`)      | Admin cấp tài khoản                                                                             | Vào lớp bằng mã, học, ghi chép, thảo luận, nộp bài, đính kèm tệp/video vào bài làm               |
| **Giáo viên** (`TEACHER`)     | Admin cấp tài khoản                                                                             | Tạo lớp, soạn bài giảng, giao/chấm bài, duyệt học viên. Vừa dạy lớp mình vừa có thể học lớp khác |
| **Quản trị viên** (`isAdmin`) | Cờ cộng thêm trên một tài khoản giáo viên/học viên, cấp bằng lệnh `npm run account:grant-admin` | Quản lý tài khoản, chuyển chủ lớp, kết nối Google Drive, mở mọi tệp đã tải lên                   |

Trong từng lớp có hai cấp quản lý:

| Cấp                     | Định nghĩa                                                     | Quyền riêng                                                                          |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Chủ lớp**             | Người tạo lớp (`teacherId`), hoặc người được admin chuyển giao | Sửa cài đặt lớp, phân công giáo viên, lưu trữ/mở lại lớp, đổi mã lớp, xóa lớp        |
| **Giáo viên phụ trách** | Được chủ lớp phân công (`teacherIds`)                          | Soạn bài giảng, giao/sửa/xóa/chấm bài tập, duyệt/loại học viên, kiểm duyệt thảo luận |

Một giáo viên "quản lý lớp" (`managesClass`) khi là chủ lớp **hoặc** nằm trong danh sách phân công. Học viên chỉ có quyền học khi enrollment ở trạng thái `APPROVED`. Người đang là học viên của lớp không thể đồng thời được phân công dạy lớp đó (và ngược lại: người đang dạy lớp không xin vào lớp đó).

## 3. Tài khoản và xác thực

- **Không có đăng ký công khai.** `/api/auth/register`, quên mật khẩu, xác minh email, gửi lại xác minh đều trả "Tài khoản do quản trị viên cấp". Chỉ admin tạo tài khoản.
- **Admin tạo tài khoản** (giáo viên hoặc học viên): mật khẩu ban đầu là mật khẩu mặc định **`123@123aA`**. Tài khoản mới có `mustChangePassword = true`: đăng nhập xong được chuyển tới `/profile` và phải đổi mật khẩu (không được chọn lại mật khẩu mặc định).
- **Đăng nhập:** email + mật khẩu → cookie `dtq_session` (HttpOnly, ký HMAC, hạn 7 ngày). Cookie gắn `sessionVersion`; đổi mật khẩu, khóa, đổi vai trò, reset mật khẩu đều tăng `sessionVersion` nên **mọi phiên cũ bị đăng xuất**.
- **Ép đổi mật khẩu:** nếu `mustChangePassword` hoặc mật khẩu là mật khẩu mặc định cũ (`123@123aA`), người dùng chỉ được vào `/profile`; mọi API nghiệp vụ trả 403 cho đến khi đổi. `GET /api/state` vẫn trả khung tối thiểu (không có lớp/bài).
- **Hồ sơ** (`/profile`): đổi họ tên; đổi mật khẩu cần mật khẩu hiện tại, mật khẩu mới ≥ 8 ký tự (≤ 128), khác mật khẩu cũ, không dùng mật khẩu mặc định.
- **Admin quản lý tài khoản** (`/admin`): tạo, sửa tên, đổi vai trò (không đổi được nếu người đó đang dạy lớp), khóa/mở khóa, kích hoạt, đặt lại mật khẩu (về mặc định `123@123aA`, bắt đổi khi đăng nhập), chuyển chủ lớp, xóa vĩnh viễn tài khoản (gõ lại email; không xóa được chủ lớp, admin hay chính mình; học liệu bài giảng còn dùng được chuyển cho chủ lớp). Không thao tác được trên tài khoản quản trị khác. Giữ nguyên tài khoản demo.
- **Tài khoản demo** (`teacher@detuquy.vn`, `student@detuquy.vn`…) chỉ đăng nhập được khi chạy localhost/demo hoặc bật `ALLOW_DEMO_ACCOUNTS=true`.
- **Giới hạn tần suất:** đăng nhập 20 lần/15 phút/(IP+email); thử mã lớp 30/15 phút/người; khởi tạo tải lên Drive 60/15 phút/người; thao tác admin 120/15 phút; đổi hồ sơ 30/15 phút. Ba bộ đếm đầu **lưu trong PostgreSQL** nên không mất khi khởi động lại và dùng chung giữa nhiều bản chạy.
- **Chống dò tài khoản:** đăng nhập sai luôn trả cùng một thông báo và tốn thời gian như nhau dù email có tồn tại hay không.
- **Nhật ký quản trị:** mọi thao tác của admin (tạo/sửa/khóa/đặt lại mật khẩu tài khoản, chuyển chủ lớp, kết nối/ngắt/dọn Google Drive, cấp/thu hồi quyền admin) được ghi lại (thời điểm, người thực hiện, đối tượng, tóm tắt không chứa mật khẩu) và xem được ở `/admin` (mục "Nhật ký thao tác quản trị").
- **Quyền admin:** cấp bằng `npm run account:grant-admin -- email`, thu hồi bằng `npm run account:revoke-admin -- email` (từ chối nếu đó là quản trị viên cuối cùng; thu hồi sẽ đăng xuất mọi phiên của người đó).
- **Chống CSRF:** mọi `POST/PATCH/DELETE` kiểm tra header `Origin` so với `APP_URL`/host.

## 4. Lớp học

Thuộc tính: tiêu đề (2–200 ký tự), mô tả, tác giả nội dung, **mã lớp** `LH-` + 12 ký tự hex, sĩ số (1–500, mặc định 50), lịch học, **mở đăng ký** (mặc định bật), **tự động duyệt** (mặc định tắt), trạng thái `ACTIVE`/`ARCHIVED`, `revision`.

| Thao tác            | Ai        | Quy tắc                                                                                                                      |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tạo lớp             | Giáo viên | Người tạo là chủ lớp                                                                                                         |
| Sửa cài đặt         | Chủ lớp   | Cần `expectedRevision`; sĩ số mới không nhỏ hơn số học viên đang học                                                         |
| Phân công giáo viên | Chủ lớp   | Chỉ giáo viên đang hoạt động; không trùng; không phải học viên của lớp; cần danh sách hiện tại để chống ghi đè (409 nếu đổi) |
| Lưu trữ / mở lại    | Chủ lớp   | Lớp `ARCHIVED` chặn **mọi thay đổi nội dung** (409); vẫn xem được                                                            |
| Đổi mã lớp          | Chủ lớp   | Mã cũ vô hiệu                                                                                                                |
| Xóa lớp             | Chủ lớp   | Phải gõ đúng mã lớp để xác nhận; xóa kèm tất cả dữ liệu của lớp                                                              |
| Chuyển chủ lớp      | Admin     | Người nhận phải là giáo viên hoạt động, không phải học viên của lớp; danh sách phân công giữ nguyên                          |

## 5. Ghi danh (enrollment)

Trạng thái: `PENDING` (chờ duyệt) → `APPROVED` (đang học) → `REMOVED` (đã rời/bị loại). Mỗi học viên có **nhóm 1–4**.

1. **Xem trước mã lớp** (`previewClass`): chỉ lớp còn `ACTIVE` và đang mở đăng ký; trả tên, mô tả, lịch, giáo viên.
2. **Xin tham gia** (`joinClass`): kiểm tra lớp không lưu trữ, đang mở đăng ký, chưa tham gia, **còn chỗ**. Nếu lớp bật tự duyệt → `APPROVED` ngay, ngược lại `PENDING`. Người đã `REMOVED` có thể xin lại.
3. **Hủy yêu cầu** (`cancelEnrollment`): chỉ khi `PENDING`.
4. **Duyệt / từ chối** (`approveEnrollment`/`rejectEnrollment`): giáo viên của lớp; duyệt kiểm tra lại sĩ số; từ chối xóa yêu cầu.
5. **Rời lớp / loại học viên** (`leaveClass`/`removeEnrollment`): chuyển `REMOVED`; chỉ khi đang `APPROVED`.
6. **Đổi nhóm** (`setEnrollmentGroup`): giáo viên, học viên đang `APPROVED`.

Học viên `PENDING`/`REMOVED` vẫn thấy lớp trong danh sách của mình nhưng **không thấy nội dung** (bài giảng, bài tập, thành viên).

## 6. Bài giảng (lesson)

Thuộc tính: tiêu đề, chương mục (mặc định "Nội dung khóa học"), thứ tự (1–10000), mô tả, nguồn video, thời lượng, mốc thời gian, tài liệu, **đã xuất bản**, `revision`.

- **Nguồn video** (`videoType`):
  - `YOUTUBE`: chỉ nhận link `youtube.com`, `m.youtube.com`, `youtu.be` có mã 11 ký tự; chuẩn hóa về `watch?v=`.
  - `DRIVE`: video đã tải lên Google Drive trong **cùng lớp** (xem mục 11); phát bằng Drive Preview. Chỉ chọn được video do **giáo viên của lớp** tải (video bài nộp của học viên không dùng được).
  - `UPLOAD`: video lưu S3/R2 cũ — còn phát/sửa được nhưng giao diện không tạo mới.
- **Mốc thời gian**: tối đa 100, định dạng `mm:ss`; **tài liệu**: tối đa 20 tệp.
- **Xuất bản** cần ít nhất một trong: video, nội dung mô tả, tài liệu. Bản nháp **ẩn hoàn toàn** với học viên. Xuất bản lần đầu sẽ gửi thông báo cho học viên về các bài tập gắn với bài giảng đó.
- **Chống ghi đè**: sửa bài cần `expectedRevision`; lệch → 409 "đã được sửa ở phiên khác".
- **Xóa bài giảng**: xóa kèm tiến độ, ghi chú, thảo luận; bài tập liên quan **bị gỡ liên kết** (không bị xóa); thư viện Drive bỏ liên kết với bài.
- Người sửa phải là giáo viên của lớp; lớp lưu trữ thì không sửa được.

## 7. Học tập: tiến độ, ghi chú, thảo luận

- **Tiến độ** (`completeLesson`, `bookmarkLesson`): chỉ học viên đã duyệt; đánh dấu hoàn thành và lưu bài. Giáo viên thấy tiến độ của cả lớp.
- **Ghi chú cá nhân** (`saveNote`): một ghi chú cho mỗi (người dùng, bài giảng), riêng tư; cần `expectedUpdatedAt` để chống ghi đè giữa hai tab.
- **Thảo luận** theo bài giảng (nội dung 1–5000 ký tự):
  - Đăng: người có quyền xem bài.
  - Sửa: **chỉ người viết**; cần `expectedContent` đúng nội dung hiện tại (409 nếu đã đổi).
  - Xóa: người viết **hoặc giáo viên của lớp**; cùng cơ chế `expectedContent`.
- Lớp lưu trữ chặn đăng/sửa/xóa.

## 8. Bài tập (assignment)

Thuộc tính: tiêu đề (2–200), hướng dẫn, **hạn nộp** (`dueAt`), cho phép nộp muộn (mặc định tắt), cho phép nộp lại (mặc định bật), số lượt tối đa (1–5, mặc định 2), số từ tối thiểu (0–20000, mặc định 150) và tối đa (tùy chọn, ≥ tối thiểu), bài giảng liên kết (tùy chọn, phải cùng lớp).

- **Giao bài** (`createAssignment`): giáo viên của lớp. Học viên đã duyệt nhận thông báo "Lớp có bài tập mới". Nếu bài gắn với bài giảng chưa xuất bản, thông báo hoãn tới khi bài giảng được xuất bản. Thông báo chỉ gửi **một lần cho mỗi bài tập** (`announcedAt`): chuyển bài giảng về nháp rồi xuất bản lại không gửi lại.
- **Hiển thị cho học viên:** bài gắn với bài giảng chưa xuất bản thì ẩn.
- **Sửa** (`updateAssignment`): cần `expectedRevision`; không chuyển lớp.
- **Xóa** (`deleteAssignment`): phải gõ đúng tên bài; xóa kèm mọi bài nộp và thông báo.
- **Nhắc nộp** (`remindStudents`): gửi thông báo cho học viên chưa nộp (cả lớp hoặc một người), kèm hạn nộp theo giờ GMT+7. **Mỗi học viên chỉ được nhắc một lần mỗi 3 giờ cho mỗi bài**; nếu tất cả đều vừa được nhắc, hệ thống từ chối (429) thay vì gửi trùng.

## 9. Nộp bài và chấm điểm

### 9.1 Trạng thái bài nộp

```
(chưa có) ──lưu nháp──► DRAFT ──nộp──► SUBMITTED ──trả điểm──► GRADED
                          ▲                │
                          └──── thu hồi ───┘   (không thu hồi được khi đã GRADED)
```

### 9.2 Học viên

- **Lưu nháp** (`saveSubmission`) và **nộp** (`submitAssignment`): chỉ học viên đã duyệt; cần `expectedRevision`.
- Nội dung: văn bản, liên kết `http(s)`, tối đa **10 tệp đính kèm** (PDF, DOCX, PPTX, ảnh, **video MP4/WebM/MOV**).
- **Khi nộp:** bắt buộc tích **xác nhận bài làm của chính mình**; phải có văn bản, tệp hoặc liên kết; chỉ khi **không có tệp và cũng không có liên kết** thì văn bản mới phải đạt số từ yêu cầu (tệp hoặc liên kết minh chứng thay cho bài viết); kiểm tra **hạn nộp** (trừ khi cho nộp muộn); kiểm tra **số lượt** (`attempt` < `maxAttempts`); mỗi lần nộp tăng `attempt`.
- Bài đã nộp (`SUBMITTED`/`GRADED`) **không sửa trực tiếp**.
- **Thu hồi** (`withdrawSubmission`): về `DRAFT` để sửa/nộp lại; chỉ khi chưa chấm, **chưa quá hạn**, bài cho phép nộp lại và còn lượt. Thu hồi xóa điểm nháp.
- Học viên **chỉ thấy điểm/nhận xét khi `GRADED`**.

### 9.3 Giáo viên

- Chỉ thấy bài nộp **không phải nháp** của học viên đang `APPROVED`.
- **Chấm** (`gradeSubmission`): rubric **hiểu bài 0–40, vận dụng 0–40, trình bày 0–20**, tổng điểm = tổng ba phần (thang 100), kèm nhận xét.
  - **Lưu điểm nháp** (`returnGrade = false`): học viên chưa thấy.
  - **Trả điểm** (`returnGrade = true`): bài thành `GRADED`, học viên nhận thông báo "đã được chấm: x/100".
  - Sửa điểm của bài đã `GRADED` bắt buộc xác nhận trả lại điểm mới.
  - Chống xung đột: kiểm `expectedAttempt`, `expectedSubmittedAt`, `expectedGradeRevision` (409 nếu bài đã đổi).
  - Không tự chấm bài của chính mình; không chấm học viên đã rời lớp.
- **Bảng điểm**: thống kê (tổng, đã nộp, chờ chấm, đã chấm, chưa nộp, điểm trung bình) và **xuất CSV** (có chống chèn công thức Excel, thêm BOM UTF-8).
- Mọi nhận xét/điểm gắn `gradeRevision` để phát hiện sửa chồng.

## 10. Thông báo

Sinh tự động cho: bài tập mới, nhắc nộp bài, học viên nộp bài (gửi chủ lớp + giáo viên phụ trách), điểm được trả. Có thể đánh dấu đã đọc từng cái hoặc tất cả. Giao diện hiển thị biểu tượng chuông, số chưa đọc và một dải thông báo nổi bật; thông báo bài tập có nút "Xem bài tập" dẫn đúng trang theo vai trò.

## 11. Tệp và Google Drive

**Mọi upload đều lên Google Drive** (một tài khoản dùng chung do admin kết nối).

| Loại               | Ai tải            | Giới hạn                                   | Ghi chú                 |
| ------------------ | ----------------- | ------------------------------------------ | ----------------------- |
| Video bài giảng    | Giáo viên của lớp | MP4, WebM, MOV, ≤ 5 GB                     | Phát bằng Drive Preview |
| Học liệu bài giảng | Giáo viên của lớp | PDF, DOCX, PPTX, JPG/PNG/GIF/WebP, ≤ 1 GB | Tối đa 20 tệp/bài       |
| Tệp/video bài nộp  | Học viên đã duyệt | Tài liệu ≤ 1 GB, video ≤ 5 GB             | Tối đa 10 tệp/bài nộp   |

- **Chính sách chia sẻ:** mọi tệp tự được đặt **"ai có liên kết đều xem được"** (không hiện khi tìm kiếm). Nghĩa là **ai có link Drive đều xem được, không cần đăng nhập**, kể cả bài làm học viên. Nếu Google từ chối cấp quyền, lượt tải không hoàn tất và có thể thử lại.
- **Cách tải:** trình duyệt gửi từng đoạn 8 MiB thẳng lên Drive (phiên upload do backend tạo); tự thử lại tối đa 6 lần, **tiếp tục** từ byte Drive đã nhận, có thể hủy; chọn lại đúng tệp đang dở sẽ nối lại phiên cũ.
- **Kiểm tra sau khi tải:** server đối chiếu dung lượng/tên/mã job với Drive và kiểm **chữ ký nội dung** (4 KiB đầu) so với định dạng khai báo; sai thì xóa khỏi Drive và báo lỗi.
- **Xem/tải trong app:** `/api/drive/files/{id}/view` (xem ngay video/PDF/ảnh, hỗ trợ tua) và `/download`. Quyền đọc trong app: chủ tệp; thành viên lớp với học liệu của bài đã xuất bản; giáo viên lớp với bài **đã nộp** (không đọc bản nháp); admin mọi tệp. DOCX/PPTX chỉ có nút tải.
- **Quản lý:** thư viện video lớp (tìm, chọn, xem, đổi tên giữ đuôi tệp, bật/tắt chia sẻ, xóa). Không xóa được tệp đang dùng trong bài giảng hoặc bài nộp (409). **Giáo viên chỉ sửa/xóa/đổi chia sẻ được học liệu của lớp**, không đụng được tệp của học viên (chỉ chủ tệp hoặc admin).
- **Dọn tệp mồ côi:** tệp của bài tập/bài giảng/lớp bị xóa được đưa vào hàng đợi xóa trên Drive; tệp học viên không đính kèm hoặc học liệu bị gỡ quá 24 giờ, và bản ghi tải lên lỗi/hủy/bỏ dở cũng bị xóa. Video thư viện của giáo viên được **giữ lại** (tái sử dụng). Chạy tự động mỗi giờ (`DRIVE_PRUNE_INTERVAL_MINUTES`), bằng nút "Dọn tệp mồ côi" ở `/admin`, hoặc `npm run drive:prune [số giờ]`. **Hạn mức dung lượng:** 10 GiB/tài khoản và 100 GiB/lớp mặc định (`LMS_UPLOAD_USER_QUOTA_BYTES`, `LMS_UPLOAD_CLASS_QUOTA_BYTES`). Chỉ video bài giảng được chia sẻ bằng liên kết; học liệu và bài làm của học viên luôn riêng tư.
- **Kiểm tra định dạng sâu:** DOCX/PPTX phải thật sự chứa `word/document.xml` / `ppt/presentation.xml` (đọc phần cuối tệp), nên file ZIP/Excel đổi đuôi bị từ chối.
- **Ngắt kết nối** giữ lại bản ghi và thư mục Drive; kết nối lại cùng tài khoản dùng lại thư mục cũ (không tạo thư mục trùng). Video bài nộp của học viên không hiện trong thư viện của giáo viên và không thể chọn làm video bài giảng.
- **Kết nối (admin):** OAuth 2.0 scope `drive.file`, refresh token mã hóa AES-256-GCM, tự làm mới access token; phát hiện bị thu hồi thì đánh dấu `REVOKED`. Không đổi sang tài khoản Google khác khi đang kết nối. Ngắt kết nối thu hồi token và hủy các lượt tải dở.
- **Kho S3/R2 cũ**: giữ để tệp/video đã có vẫn xem được; giao diện không tạo mới.
- Chi tiết kỹ thuật, API, cấu hình Google Cloud: xem [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md).

## 12. Quy tắc hiển thị dữ liệu (ai thấy gì)

`GET /api/state` chỉ trả dữ liệu người dùng **được phép thấy**:

| Dữ liệu          | Học viên (đã duyệt)                | Học viên chờ duyệt    | Giáo viên của lớp                                       |
| ---------------- | ---------------------------------- | --------------------- | ------------------------------------------------------- |
| Thông tin lớp    | ✔                                  | ✔ (chỉ thông tin lớp) | ✔                                                       |
| Bài giảng        | Chỉ **đã xuất bản**                | ✘                     | Tất cả (kể cả nháp)                                     |
| Bài tập          | Ẩn nếu gắn bài giảng chưa xuất bản | ✘                     | Tất cả                                                  |
| Bài nộp          | Của chính mình                     | ✘                     | Của học viên (không nháp)                               |
| Điểm/nhận xét    | Chỉ khi `GRADED`                   | ✘                     | Tất cả                                                  |
| Tiến độ          | Của mình                           | ✘                     | Cả lớp                                                  |
| Ghi chú          | Của mình                           | ✘                     | Của mình                                                |
| Thảo luận        | Cả lớp                             | ✘                     | Cả lớp                                                  |
| Email người khác | Ẩn                                 | Ẩn                    | Hiện cho học viên/đồng giáo viên trong lớp mình quản lý |
| Thông báo        | Của mình                           | Của mình              | Của mình                                                |

## 13. Cơ chế dùng chung

- **Đồng bộ gần thời gian thực:** giao diện hỏi `/api/state` mỗi 3 giây (tạm dừng khi tab ẩn/mất mạng), đồng bộ giữa các tab bằng `BroadcastChannel`; chỉ cập nhật giao diện khi dữ liệu thật sự đổi. Phản hồi có `ETag` nên khi không đổi server trả **304** (không gửi lại dữ liệu).
- **Chống ghi đè đồng thời (optimistic concurrency):** nhiều hành động bắt buộc gửi kèm phiên bản (`expectedRevision`, `expectedUpdatedAt`, `expectedContent`, `expectedGradeRevision`); thiếu/lệch → 409. Hành động bắt buộc: lưu/nộp bài, lưu ghi chú, sửa bài giảng, sửa lớp, sửa bài tập, chấm bài.
- **Bản nháp trình duyệt:** form soạn bài giảng, nộp bài, ghi chú lưu nháp vào `sessionStorage` (ghi trễ 400 ms) và cảnh báo khi rời trang chưa lưu.
- **Ghi dữ liệu:** mỗi lần ghi nạp dữ liệu, sửa trong bộ nhớ, chỉ ghi lại phần khác biệt, trong một giao dịch có khóa (`pg_advisory_xact_lock`) nên các thao tác ghi tuần tự. **Mỗi hành động chỉ nạp đúng các bảng nó dùng** (`ACTION_TABLES` trong `actions.ts`); bảng không khai báo bị chặn truy cập (lỗi thay vì đọc nhầm bảng rỗng), và `tests/action-tables.test.ts` chạy mọi hành động để bảo đảm danh sách đủ. Đo trên ~35 nghìn dòng: hoàn thành bài học 354 → 35 ms, bình luận 352 → 103 ms.
- **Kiểu thời gian:** các cột thời gian là `TIMESTAMPTZ` trong PostgreSQL; ứng dụng vẫn nhận/gửi chuỗi ISO-8601 UTC.
- **Kiểm tra phiên bản chỉnh sửa** nằm trong `runActionStrict` (điểm vào dành cho dữ liệu người dùng), không chỉ ở route.
- **Giờ hiển thị:** `Asia/Ho_Chi_Minh` (GMT+7).

## 14. Bản đồ màn hình

| Đường dẫn                          | Dành cho            | Chức năng                                                       |
| ---------------------------------- | ------------------- | --------------------------------------------------------------- |
| `/login`                           | Mọi người           | Đăng nhập                                                       |
| `/profile`                         | Mọi người           | Họ tên, đổi mật khẩu (bắt buộc khi có cờ đổi mật khẩu)          |
| `/classes`                         | Học viên, giáo viên | Lớp của tôi: tìm, nhập mã lớp, hủy yêu cầu chờ duyệt            |
| `/classes/{id}`                    | Thành viên lớp      | Tổng quan, bài giảng, bài tập, thông tin lớp                    |
| `/classes/{id}/lessons/{lessonId}` | Thành viên lớp      | Video, tài liệu, ghi chú, thảo luận, hoàn thành/lưu bài         |
| `/classes/{id}/assignments/{id}`   | Thành viên lớp      | Soạn/nộp/thu hồi bài, xem điểm                                  |
| `/classes/{id}/members`            | Thành viên lớp      | Danh sách thành viên, lọc nhóm, tìm không dấu                   |
| `/assignments`                     | Học viên, giáo viên | Bài tập của tôi (mọi lớp)                                       |
| `/teacher/classes`                 | Giáo viên           | Lớp giảng dạy: tạo/sửa, duyệt học viên, phân công, lưu trữ, xóa |
| `/teacher/lessons`                 | Giáo viên           | Kho bài giảng: soạn, xuất bản, tải video/tài liệu               |
| `/teacher/assignments`             | Giáo viên           | Giao bài, bài cần chấm, chấm theo rubric, nhắc nộp, xuất CSV    |
| `/admin`, `/admin/users`           | Admin               | Tài khoản, kết nối Google Drive, chuyển chủ lớp                 |

## 15. Bảng API

| Nhóm              | Endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nghiệp vụ lớp học | `POST /api/actions` — `createClass`, `updateClass`, `setClassTeachers`, `archiveClass`, `regenerateCode`, `deleteClass`, `previewClass`, `joinClass`, `cancelEnrollment`, `leaveClass`, `removeEnrollment`, `setEnrollmentGroup`, `approveEnrollment`, `rejectEnrollment`, `saveLesson`, `deleteLesson`, `completeLesson`, `bookmarkLesson`, `saveNote`, `comment`, `updateComment`, `deleteComment`, `createAssignment`, `updateAssignment`, `deleteAssignment`, `saveSubmission`, `submitAssignment`, `withdrawSubmission`, `gradeSubmission`, `remindStudents`, `markNotificationsRead` |
| Trạng thái        | `GET /api/state`, `GET /api/health`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Xác thực/hồ sơ    | `POST /api/auth/login`, `/logout`, `GET /api/auth/me`, `/config`, `PATCH /api/profile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Admin             | `/api/admin/users` (tạo/liệt kê), `/api/admin/users/{id}` (sửa), `/api/admin/users/{id}/reset-password`, `/api/admin/classes/{id}/owner`, `/api/classes/{classId}/teachers`                                                                                                                                                                                                                                                                                                                                                                                                                |
| Nhật ký           | `GET /api/admin/audit` (admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Google Drive      | `GET /api/drive/status`, `/connect`, `/callback`; `POST /disconnect`, `POST /api/drive/maintenance` (admin, dọn tệp mồ côi); `POST /api/drive/uploads` (+ `/{id}` GET/DELETE, `/{id}/resume`, `/{id}/complete`); `GET /api/drive/files` (+ `/{id}` GET/PATCH/DELETE, `/{id}/sharing`, `/{id}/view`, `/{id}/download`)                                                                                                                                                                                                                                                                      |
| Tệp S3 cũ         | `/api/uploads`, `/api/uploads/presign`, `/api/uploads/complete`, `GET /api/files/{id}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 16. Giới hạn và những điều chưa có

- **Không có** đăng ký tự phục vụ, quên mật khẩu qua email, gửi email thông báo; mọi thứ qua admin và thông báo trong app.
- Chỉ **video bài giảng** trên Drive công khai theo liên kết (xem mục 11); học liệu và bài nộp của học viên riêng tư, chỉ mở qua ứng dụng.
- Video bài nộp chỉ **tải xuống/xem qua server** (tốn băng thông server); giáo viên chưa có công cụ nhận xét trực tiếp trên video.
- DOCX/PPTX không xem trực tiếp trong app (chỉ tải); video bài giảng phụ thuộc Google xử lý (có thể vài phút sau khi tải) và cookie bên thứ ba.
- Tệp trên Drive của lớp/bài đã xóa được dọn theo lịch (mục 11), không xóa ngay lập tức.
- Chưa có chia sẻ Drive theo email, chưa có proxy tải lên qua server nếu CORS bị chặn.
- Trạng thái được tải theo phạm vi lớp của người dùng và đồng bộ bằng thăm dò 3 giây (có ETag/304); chưa có đẩy thời gian thực (SSE) hay phân trang phía server.
- Một tài khoản Google Drive dùng chung cho cả hệ thống; dung lượng và hạn mức API là của tài khoản đó.
- Điểm chỉ theo rubric cố định 40/40/20; chưa có nhiều thang điểm, nhóm bài tập, hay chấm theo nhóm học viên.

## Trưởng nhóm

Mỗi học viên trong lớp thuộc một nhóm (1–4). Giáo viên của lớp có thể đặt **một Trưởng nhóm cho mỗi nhóm** (trang Thành viên của lớp → "Đặt làm trưởng nhóm"; chỉ có hiệu lực trong lớp đó). Trưởng nhóm vẫn là học viên và vẫn nộp bài như bình thường, thêm quyền:

- Thấy email và bài **đã nộp** của các thành viên cùng nhóm (nội dung, liên kết, tệp; xem trực tuyến cả PPTX), ở mục "Nhóm của bạn" trong trang Thành viên.
- Không thấy điểm hay nhận xét của bạn, không thấy bản nháp, không thấy nhóm khác.
- Không chấm bài, không tạo/sửa/xóa bài tập, bài giảng hay lớp.

Đổi nhóm của một học viên hoặc cho học viên rời lớp sẽ tự gỡ quyền Trưởng nhóm của họ.

## Thực hành theo bài giảng (bảng phân lịch học tập và thực hành)

Mỗi bài giảng có tab **Thực hành**, gồm 13 mục tick theo bảng phân lịch của lớp: 4 mục *Nhiệm vụ học tập*, 3 mục *Thực hành đạo lý hằng ngày*, 2 mục *Thực hành đạo lý hằng tuần* và 4 mục *Tinh thần thực hành*. Điểm thực hành của một bài là số mục được tick trên 13.

| Người dùng | Thấy | Được tick |
|---|---|---|
| Trưởng nhóm | Thành viên trong nhóm mình: đã học bài chưa, tiến độ thực hành | Có, cho các thành viên cùng nhóm (không tự chấm mình) |
| Học viên | Chỉ phiếu của chính mình (chỉ xem) | Không |
| Giáo viên của lớp, quản trị viên | Toàn lớp | Chỉ khi nhóm chưa có trưởng nhóm, hoặc cho chính trưởng nhóm (không ai khác chấm được) |

Phiếu được lưu theo từng cặp (bài giảng, học viên) kèm nhận xét và người chấm gần nhất; bị xóa theo bài giảng, lớp hoặc tài khoản.

## Bảng xếp hạng thực hành

Chỉ **giáo viên của lớp** và **quản trị viên** xem được; học viên và trưởng nhóm không thấy (máy chủ trả 403 cho `GET /api/ranking`).

- **Điểm tổng (trên 100)** = 50% **thực hành** (mục được tick trên 13 mục mỗi bài) + 50% **bài tập** (điểm chấm đã trả, thang 100).
  - Bài tập chỉ được tính khi đã **xuất bản và quá hạn nộp**: điểm đã trả cho học viên, hoặc **0** nếu chưa có điểm (không nộp, hoặc đã nộp nhưng giáo viên chưa chấm/chưa trả điểm). Vì vậy giáo viên nên chấm xong để điểm phản ánh đúng.
  - Nơi không có bài tập nào được tính (bài giảng chưa gắn bài tập, lớp chưa có bài tập quá hạn) thì điểm tổng chỉ là điểm thực hành, áp dụng giống nhau cho mọi thành viên.
- **Xếp hạng tổng của lớp:** mọi bài giảng đã xuất bản và mọi bài tập của lớp (kể cả bài không gắn bài giảng).
- **Xếp hạng từng bài giảng:** thực hành của bài đó và các bài tập gắn với bài giảng đó.
- Cùng điểm thì cùng hạng (1, 2, 2, 4); nếu bằng điểm thì người đã học nhiều bài hơn xếp trước.
- Vị trí: tab **Xếp hạng** của lớp (giáo viên), cuối tab **Thực hành** của mỗi bài giảng (giáo viên), và mục **Bảng xếp hạng thực hành** trong trang Quản trị (chọn bất kỳ lớp nào).
- Chấm cho từng thành viên: ở tab **Thực hành** của bài, hoặc trong hộp thoại **Chi tiết** của thành viên (trang Thành viên) → "Thực hành theo bài giảng" → **Chấm thực hành**.
