# Tích hợp Google Drive (video bài giảng)

Tính năng cho phép giáo viên tải video lên một tài khoản Google Drive dùng chung, rồi phát trực tiếp trong bài giảng bằng Google Drive Preview. Dự án là Next.js/TypeScript nên mọi phần được viết bằng TypeScript, dùng REST API chính thức của Google (không thêm dependency).

## Kiến trúc

```
Quản trị viên ──OAuth (drive.file)──► Google ──code──► /api/drive/callback ──► DriveConnection (refresh token mã hóa AES-256-GCM)

Giáo viên ─► POST /api/drive/uploads ─► backend kiểm quyền lớp, tạo DriveUpload, mở resumable session với Drive
          ◄── uploadUrl (session URI) ──┘
Trình duyệt ──PUT từng chunk 8 MiB (Content-Range)──► Google Drive      (backend không nhận byte video)
Trình duyệt ─► POST /uploads/{id}/complete ─► backend xác minh file, kiểm tra nội dung, đặt quyền, lưu DB
Học viên ─► <iframe https://drive.google.com/file/d/{id}/preview>
```

**Option B (trình duyệt → Drive trực tiếp)** được chọn:

| | A: qua backend | B: trực tiếp (đang dùng) |
|---|---|---|
| Băng thông/RAM server | Mọi byte video đi qua server (tới 2 GB/video) | Gần như không |
| Bảo mật | Session URI không lộ ra client | Session URI (bearer credential) nằm trong tay người tải lên; chỉ trả cho chính chủ, lưu DB dạng mã hóa, không log |
| CORS | Không cần | Backend gửi `Origin` khi tạo session để Drive cho phép đọc phản hồi |
| Retry/resume | Server phải tự giữ trạng thái | Hỏi Drive offset (`Content-Range: bytes */size` → 308) rồi gửi tiếp |

Nếu môi trường của bạn chặn CORS tới Drive, cần chuyển sang Option A (proxy chunk) — chưa triển khai.

### Dữ liệu

Migration `20261103150000_google_drive`:

- `DriveConnection` — một dòng `shared` (tài khoản Drive của trung tâm): email, refresh token **đã mã hóa**, trạng thái `ACTIVE/REVOKED`, `folderId`.
- `DriveUpload` — một lượt tải/tệp: chủ sở hữu, lớp (FK, cascade), bài giảng (FK, set null), loại, tên, MIME, dung lượng, trạng thái `PENDING/UPLOADING/COMPLETED/FAILED/CANCELLED`, byte đã tải, session URI mã hóa, `driveFileId` (unique), `webViewLink`, `shared`. Index `(classId,status)`, `(ownerId,status)`, `(lessonId)`.
- `Lesson.driveFileId` + `videoType = 'DRIVE'` (tái dùng bảng bài giảng, không tạo bảng video trùng chức năng). `videoUrl` lưu URL preview.

### API

Phản hồi lỗi theo mẫu hiện có: `{ "error": "..." }`. Mọi `POST/PATCH/DELETE` kiểm tra `Origin`.

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/drive/status` | đăng nhập | `{configured, connected, status, email?, canConnect}` (email chỉ admin thấy) |
| GET | `/api/drive/connect` | admin | Redirect sang Google, đặt cookie `state` |
| GET | `/api/drive/callback` | admin | Kiểm `state`, đổi code lấy token, lưu mã hóa, redirect `/admin?drive=...` |
| POST | `/api/drive/disconnect` | admin | Thu hồi token tại Google, xóa kết nối, hủy các lượt tải dở |
| POST | `/api/drive/uploads` | giáo viên của lớp (video + tài liệu); học viên đã duyệt (chỉ tài liệu) | Body `{classId, lessonId?, name, size, mimeType, kind, title?, description?}` → `{job, uploadUrl, offset, chunkSize}`. Chọn lại đúng tệp đang dở sẽ resume, không tạo trùng |
| GET | `/api/drive/uploads/{id}` | chủ/giáo viên lớp/admin | Trạng thái job |
| POST | `/api/drive/uploads/{id}/resume` | như trên | Hỏi Drive offset đã nhận; trả `uploadUrl`+`offset`. Nếu Drive đã đủ byte thì tự hoàn tất (đối soát khi trình duyệt không kịp báo) |
| POST | `/api/drive/uploads/{id}/complete` | như trên | Body `{driveFileId?}`. Idempotent |
| DELETE | `/api/drive/uploads/{id}` | như trên | Hủy session (job chưa xong) |
| GET | `/api/drive/files?classId&lessonId&kind&q&status` | giáo viên/admin | Danh sách + tìm kiếm trong DB. `source=drive` (admin): `files.list` trực tiếp thư mục Drive |
| GET | `/api/drive/files/{id}?live=1` | như trên | Chi tiết (+ metadata thật từ Drive nếu `live=1`) |
| PATCH | `/api/drive/files/{id}` | như trên | `{name?, title?, description?}`; đổi tên gọi `files.update`, giữ đuôi tệp |
| POST | `/api/drive/files/{id}/sharing` | như trên | `{public: boolean}` tạo/thu hồi quyền `anyone/reader` |
| GET | `/api/drive/files/{id}/download` | theo quy tắc ở trên | Tải tệp (stream qua server) |
| GET | `/api/drive/files/{id}/view` | theo quy tắc ở trên | Xem ngay trong trang (video, PDF, ảnh) — `Content-Disposition: inline`, hỗ trợ `Range` để tua video; DOCX/PPTX chỉ tải xuống |
| POST | `/api/drive/maintenance` | admin | Dọn tệp mồ côi ngay (xem mục "Dọn dẹp" bên dưới) |
| DELETE | `/api/drive/files/{id}` | như trên | `files.delete`; **từ chối nếu video đang gắn bài giảng** |

`{id}` luôn là id job nội bộ, không phải Drive file id (chống IDOR). Gắn video vào bài giảng dùng action `saveLesson` hiện có với `videoType: 'DRIVE'` và `driveFileId`; server chỉ chấp nhận file đã `COMPLETED`, đúng lớp, đúng loại video.

### Giao diện

`src/components/drive.tsx`: `GoogleDriveConnect` (trang `/admin`), `VideoUploader` + `UploadProgress` (chunk 8 MiB, tiến trình, retry tối đa 6 lần với backoff, resume theo offset Drive, hủy), `VideoManagement` (tìm, chọn, xem, đổi tên, chia sẻ, xóa), `DriveVideoPlayer` (iframe 16:9, loading/error, không render khi thiếu fileId), `CourseLessonVideo` (tab “Google Drive” trong trình soạn bài giảng).

## Chính sách chia sẻ & giới hạn cần biết

- **Chính sách chia sẻ: chỉ video bài giảng của giáo viên được tự đặt `anyone/reader`** (anyone with the link; `allowFileDiscovery=false`), vì trình phát Drive Preview cần quyền này. Nếu Google từ chối đặt quyền (ví dụ Workspace chặn chia sẻ ra ngoài) lượt tải không hoàn tất và có thể thử lại. **Mọi tệp khác — học liệu, tệp và video bài làm của học viên — giữ riêng tư trên Drive**; chỉ mở được qua `/view`, `/download` của ứng dụng (kiểm tra quyền mỗi lần, server stream bằng token của tài khoản Drive). Tệp học viên không thể bật chia sẻ, kể cả chính chủ (403). Video bài giảng bị thu hồi chia sẻ thì không gắn được vào bài giảng (409). Job dọn dẹp hằng giờ tự thu hồi link của mọi tệp học viên còn công khai (ví dụ tải lên theo chính sách cũ) — trường `unshared` trong kết quả.
- **Mọi luồng upload của ứng dụng đều đi qua Drive**: video bài giảng, học liệu bài giảng (giáo viên) và tệp đính kèm bài làm (học viên). Học viên đã được duyệt được đính kèm vào bài làm *tài liệu* (PDF, DOCX, PPTX, JPG, PNG, GIF, WebP; tối đa 25 MB) hoặc *video* (MP4, WebM, MOV; tối đa 2 GB), nhưng không được tải học liệu cho bài giảng.
- Video bài nộp của học viên không hiện trong thư viện video của giáo viên và không thể chọn làm video bài giảng (và luôn riêng tư).
- Truy cập qua app: `GET /api/drive/files/{id}/download` và `/view` kiểm quyền rồi stream từ Drive. Quyền đọc trong app: chủ tệp; thành viên lớp với học liệu của bài đã xuất bản; giáo viên của lớp với bài đã nộp (không đọc được bản nháp); quản trị viên mọi tệp.
- **Xem trực tiếp**: nút "Xem" cạnh mỗi tệp đính kèm mở video/PDF/ảnh ngay trong trang (học viên, giáo viên, quản trị viên đều dùng được theo đúng quyền). Quản trị viên mở được mọi tệp. Video/ảnh được trả kèm `Content-Security-Policy: sandbox` và `nosniff`. Video bài giảng vẫn phát bằng Drive Preview.
- Tệp đang được bài giảng hoặc bài nộp dùng thì không xóa được (HTTP 409).
- Kho S3/R2 cũ không còn được giao diện gọi. Các route `/api/uploads*`, `/api/files/*` được giữ để các tệp/video S3 đã có vẫn xem được; tab "Kho cũ (S3)" chỉ hiện khi sửa bài giảng đang dùng video S3.
- Preview phụ thuộc Google: có thể “đang xử lý” vài phút sau khi tải; độ phân giải/phát lại do Google quyết định; cần cookie bên thứ ba (trình duyệt chặn cookie sẽ không phát); có thể bị giới hạn lượt xem/tải khi file quá nổi tiếng; không có ảnh hưởng gì từ phía server khi nhiều người xem cùng lúc, nhưng cũng không có cam kết SLA. Không dùng link tải trực tiếp thay cho streaming.
- Dung lượng Drive là của tài khoản kết nối (Google trả lỗi `storageQuotaExceeded` → 507 và thông báo rõ).
- Scope `drive.file`: ứng dụng chỉ thấy tệp do chính nó tạo. Xóa lớp học xóa bản ghi trong DB nhưng **không** tự xóa file trên Drive (xóa tay hoặc xóa từng video trước).
- Session tải lên của Drive sống tối đa 1 tuần; sau đó phải chọn lại tệp.
- Một tài khoản Google dùng chung: không thể đổi sang tài khoản khác khi đang kết nối (phải ngắt trước) để không mất liên kết tới file cũ.

## Cấu hình Google Cloud (làm một lần)

1. Vào <https://console.cloud.google.com/> → tạo (hoặc chọn) một project.
2. **APIs & Services → Library** → bật **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): User type *External* (hoặc *Internal* nếu dùng Google Workspace); điền tên ứng dụng, email hỗ trợ; thêm scope `.../auth/drive.file`; thêm tài khoản Drive của trung tâm vào **Test users** nếu app ở trạng thái *Testing*.
   - Ở trạng thái *Testing*, refresh token hết hạn sau 7 ngày. Để dùng lâu dài, chuyển **Publish app → In production**. `drive.file` là scope không nhạy cảm nên thường không cần xác minh nặng.
4. **Credentials → Create credentials → OAuth client ID** → loại **Web application**.
   - **Authorized redirect URIs**: `https://<tên-miền>/api/drive/callback` (và `http://localhost:3000/api/drive/callback` khi chạy local). Phải khớp tuyệt đối với `APP_URL` + `/api/drive/callback`, hoặc `GOOGLE_REDIRECT_URI`.
5. Sao chép Client ID và Client secret.

## Biến môi trường

```
APP_URL=https://<tên-miền>            # bắt buộc đúng để tạo redirect URI
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DRIVE_ENCRYPTION_KEY=<>=32 ký tự ngẫu nhiên>   # openssl rand -base64 48 ; mặc định dùng SESSION_SECRET
```

Đã thêm vào `.env.example`, `.env.production.example` và `compose.production.yml`. Không commit giá trị thật. Đổi `DRIVE_ENCRYPTION_KEY` đồng nghĩa phải kết nối lại Drive.

## Chạy và kiểm thử

```bash
npm ci
npm run db:generate
npm run db:migrate        # PostgreSQL; chế độ demo JSON không cần migrate
npm run dev
npm run typecheck && npm test
```

Kiểm thử thủ công với Google thật:

1. Đăng nhập admin (`npm run account:grant-admin`) → `/admin` → **Kết nối Google Drive** → đồng ý → thấy “Đã kết nối”.
2. Đăng nhập giáo viên → Kho bài giảng → soạn bài → tab **Google Drive** → chọn một video MP4 nhỏ → thanh tiến trình → “Đã tải lên”. Kiểm tra thư mục “LMS Đệ Tử Quy” trên Drive.
3. Xuất bản bài giảng → đăng nhập học viên đã vào lớp → mở bài → video phát (chờ Google xử lý nếu báo đang xử lý).
4. Resume: tải video lớn, tắt mạng giữa chừng (DevTools → Offline) → thấy “thử lại” → bật mạng → tiếp tục từ offset. Đóng tab rồi chọn lại đúng tệp → tiếp tục phiên cũ.
5. Thu hồi: ở Google Account → Security → Third-party access gỡ ứng dụng → lần gọi kế tiếp báo “kết nối đã bị thu hồi”, kết nối chuyển `REVOKED`.

## Trạng thái kiểm thử đã thực hiện

- `npm run typecheck`, `npm run build`: đạt.
- `tests/drive-uploads.test.ts`: học viên đính kèm tài liệu vào bài nộp, chỉ video bài giảng được công khai, tệp học viên luôn riêng tư, phân quyền đọc trong app theo vai trò, tải xuống qua server, chặn xóa tệp đang dùng.
- `tests/drive.test.ts` (8 test): mã hóa token, OAuth URL/state, validate upload, chữ ký nội dung, phân loại lỗi Google, truy vấn 308/hoàn tất/hết hạn, gắn video vào bài giảng, và toàn bộ vòng đời upload (init, resume, trùng lặp, IDOR, hoàn tất ràng buộc theo job, từ chối nội dung sai, reconcile, idempotent, chặn xóa khi đang dùng) với **Google API được mock**.
- Smoke test route trên bản build production: 401 khi chưa đăng nhập, 403 cho non-admin, chặn sai Origin.
- **Chưa kiểm thử với Google thật** (cần Client ID/secret của bạn): OAuth consent, upload thực, CORS của trình duyệt khi PUT tới session URI, phát Preview. Xem các bước thủ công ở trên.

## Checklist production

- [ ] OAuth app đã *In production*, redirect URI khớp tên miền HTTPS.
- [ ] `APP_URL`, `GOOGLE_*`, `DRIVE_ENCRYPTION_KEY` đặt trong `.env.production`; `SESSION_SECRET` riêng, không dùng chung với key mã hóa nếu có thể.
- [ ] Chạy migration `20261103150000_google_drive`.
- [ ] Thử upload + phát bằng video thật, cả trình duyệt chặn cookie bên thứ ba.
- [ ] Đã chấp nhận chính sách “anyone with link” cho video bài giảng (tệp khác luôn riêng tư).
- [ ] Theo dõi dung lượng Drive và quota API (Drive API mặc định 12.000 request/phút/project).
- [ ] Quy trình dọn file Drive khi xóa lớp.

## Dọn dẹp, quyền sửa tệp và kiểm tra định dạng

- **Hàng đợi xóa (`DriveTrash`)**: khi xóa bài tập, bài giảng hoặc lớp, các tệp Drive liên quan được ghi vào hàng đợi (không gọi Google trong giao dịch DB). Việc xóa thật trên Drive do `pruneDrive` thực hiện.
- **`pruneDrive(graceHours = 24)`** xóa (trên Drive và trong DB): hàng đợi xóa; tệp học viên chưa/không còn được đính kèm và học liệu giáo viên không còn dùng sau 24 giờ; bản ghi tải lên lỗi, hủy hoặc bỏ dở. **Video thư viện của giáo viên được giữ lại.** Idempotent; nếu chưa kết nối Drive chỉ xử lý bản ghi không có tệp.
- **Chạy khi nào:** tự động mỗi giờ khi có `GOOGLE_CLIENT_ID` (`src/instrumentation.ts`; `DRIVE_PRUNE_INTERVAL_MINUTES`, đặt `0` để tắt), bằng nút "Dọn tệp mồ côi" ở `/admin`, hoặc `npm run drive:prune [số giờ]` (ví dụ từ cron).
- **Ai sửa được tệp:** chủ tệp và admin. Giáo viên của lớp chỉ sửa/xóa/đổi chia sẻ **học liệu của lớp** (tệp do giáo viên tải), không đụng tới tệp của học viên.
- **Hạn mức dung lượng** dùng chung với kho S3: `LMS_UPLOAD_USER_QUOTA_BYTES` (mặc định 10 GiB/tài khoản) và `LMS_UPLOAD_CLASS_QUOTA_BYTES` (mặc định 100 GiB/lớp). Tính cả tệp đã xong và đang tải; tệp lỗi/hủy không tính. Vượt hạn mức trả 413. Dung lượng và hạn mức API của tài khoản Google đã kết nối vẫn cần tự theo dõi.
- **DOCX/PPTX**: ngoài chữ ký "PK" đầu tệp, server đọc 256 KiB cuối để kiểm tra danh mục ZIP có `word/document.xml` / `ppt/presentation.xml`; Excel hay ZIP đổi đuôi bị từ chối và bị xóa khỏi Drive.
- **Ngắt kết nối** chỉ xóa bí mật (refresh token) và đánh dấu `DISCONNECTED`; email và thư mục được giữ để kết nối lại cùng tài khoản dùng lại thư mục cũ. Đổi sang tài khoản khác tạo thư mục mới.
- **Tiến trình upload**: trình duyệt không đọc được header `Range` của Drive (CORS không công khai header này), nên coi mỗi đoạn 8 MiB là đã nhận khi Drive trả 308; offset chính xác luôn được lấy lại từ Drive qua `/resume` khi có lỗi.
