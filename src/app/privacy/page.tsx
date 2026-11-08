import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/brand';
import { SiteShell } from '@/components/site';

export const metadata: Metadata = { title: 'Chính sách quyền riêng tư' };

export default function Privacy() {
  return (
    <SiteShell>
      <article className="site-doc">
        <h1>Chính sách quyền riêng tư</h1>
        <p className="muted">Áp dụng cho {APP_NAME}. Cập nhật lần cuối: 08/11/2026.</p>

        <h2>1. Chúng tôi thu thập gì</h2>
        <ul>
          <li>
            <strong>Tài khoản:</strong> họ tên, email, vai trò (học viên, giáo viên, quản trị viên)
            và mật khẩu đã được băm (không lưu mật khẩu gốc).
          </li>
          <li>
            <strong>Hoạt động học tập:</strong> lớp tham gia, tiến độ bài học, ghi chú, bình luận,
            bài nộp, điểm và nhận xét.
          </li>
          <li>
            <strong>Tệp tải lên:</strong> video, tài liệu và tệp đính kèm bài tập do người dùng tải
            lên.
          </li>
          <li>
            <strong>Nhật ký kỹ thuật:</strong> địa chỉ IP và thời điểm đăng nhập, dùng để chống lạm
            dụng và giới hạn số lần đăng nhập sai.
          </li>
        </ul>

        <h2>2. Cách chúng tôi dùng Google Drive</h2>
        <p>
          Quản trị viên kết nối một tài khoản Google để lưu video và tệp của lớp học. Ứng dụng chỉ
          xin quyền <code>https://www.googleapis.com/auth/drive.file</code>: quyền này chỉ cho phép
          ứng dụng tạo, đọc, sửa và xóa <strong>các tệp do chính ứng dụng tạo ra</strong>. Ứng dụng
          không thể xem hay thay đổi các tệp khác trong Google Drive của quản trị viên.
        </p>
        <ul>
          <li>
            Khi quản trị viên kết nối, ứng dụng lưu email của tài khoản Google và một mã làm mới
            (refresh token) đã được mã hóa AES-256-GCM trên máy chủ của chúng tôi.
          </li>
          <li>
            Tệp tải lên được đặt ở chế độ &ldquo;bất kỳ ai có liên kết đều xem được&rdquo; để học
            viên và giáo viên xem trực tiếp trong ứng dụng. Vì vậy, hãy chỉ tải lên nội dung bạn sẵn
            sàng chia sẻ trong phạm vi lớp học.
          </li>
          <li>
            Việc sử dụng và chuyển giao thông tin nhận từ Google APIs tuân thủ{' '}
            <a
              className="text-link"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noreferrer"
              target="_blank"
            >
              Chính sách Dữ liệu người dùng của Google API Services
            </a>
            , bao gồm các yêu cầu Sử dụng có giới hạn.
          </li>
        </ul>

        <h2>3. Mục đích sử dụng</h2>
        <p>
          Dữ liệu chỉ được dùng để vận hành lớp học: đăng nhập, hiển thị bài giảng, nhận và chấm
          bài, gửi thông báo trong ứng dụng. Chúng tôi <strong>không bán</strong> dữ liệu, không
          dùng cho quảng cáo và không dùng để huấn luyện mô hình AI.
        </p>

        <h2>4. Chia sẻ dữ liệu</h2>
        <p>
          Dữ liệu chỉ hiển thị cho người có quyền trong cùng lớp (giáo viên của lớp, quản trị viên,
          và học viên đối với phần của mình hoặc nội dung chung của lớp). Chúng tôi không chia sẻ dữ
          liệu cho bên thứ ba, trừ nhà cung cấp hạ tầng cần thiết (máy chủ, Google Drive) hoặc khi
          pháp luật yêu cầu.
        </p>

        <h2>5. Lưu trữ và bảo mật</h2>
        <p>
          Dữ liệu được lưu trong cơ sở dữ liệu PostgreSQL và Google Drive. Chúng tôi dùng kết nối
          HTTPS, mã hóa mã làm mới của Google, giới hạn số lần đăng nhập và nhật ký quản trị. Không
          hệ thống nào an toàn tuyệt đối; nếu phát hiện sự cố ảnh hưởng đến bạn, chúng tôi sẽ thông
          báo.
        </p>

        <h2>6. Thời gian lưu và quyền của bạn</h2>
        <ul>
          <li>Dữ liệu được lưu trong thời gian tài khoản và lớp học còn hoạt động.</li>
          <li>
            Bạn có thể yêu cầu xem, chỉnh sửa hoặc xóa tài khoản và dữ liệu của mình bằng cách liên
            hệ quản trị viên theo địa chỉ bên dưới. Khi xóa lớp, bài tập hoặc bài giảng, các tệp
            liên quan trên Google Drive cũng được dọn tự động.
          </li>
          <li>
            Quản trị viên có thể ngắt kết nối Google Drive bất cứ lúc nào trong trang Quản trị, hoặc
            thu hồi quyền tại{' '}
            <a
              className="text-link"
              href="https://myaccount.google.com/permissions"
              rel="noreferrer"
              target="_blank"
            >
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>

        <h2>7. Trẻ em</h2>
        <p>
          Dịch vụ dành cho lớp học do giáo viên tổ chức. Với người dưới 16 tuổi, việc tạo tài khoản
          nên có sự đồng ý của phụ huynh hoặc người giám hộ.
        </p>

        <h2>8. Thay đổi chính sách</h2>
        <p>
          Khi chính sách thay đổi, chúng tôi cập nhật trang này kèm ngày cập nhật mới. Việc tiếp tục
          sử dụng dịch vụ sau thay đổi nghĩa là bạn chấp nhận chính sách mới.
        </p>

        <h2>9. Liên hệ</h2>
        <p>
          Mọi yêu cầu về quyền riêng tư vui lòng gửi tới quản trị viên của {APP_NAME} qua email{' '}
          <a className="text-link" href="mailto:quanducbui2017@gmail.com">
            quanducbui2017@gmail.com
          </a>
          .
        </p>
      </article>
    </SiteShell>
  );
}
