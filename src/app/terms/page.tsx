import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';
import { SiteShell } from '@/components/site';

export const metadata: Metadata = { title: 'Điều khoản sử dụng' };

export default function Terms() {
  return (
    <SiteShell>
      <article className="site-doc">
        <h1>Điều khoản sử dụng</h1>
        <p className="muted">Áp dụng cho {APP_NAME}. Cập nhật lần cuối: 08/11/2026.</p>
        <h2>1. Tài khoản</h2>
        <p>
          Tài khoản do quản trị viên hoặc giáo viên cấp. Bạn chịu trách nhiệm giữ bí mật mật khẩu và
          mọi hoạt động dưới tài khoản của mình.
        </p>
        <h2>2. Nội dung tải lên</h2>
        <p>
          Bạn chỉ tải lên nội dung mình có quyền sử dụng và phù hợp với lớp học. Video bài giảng
          được chia sẻ theo liên kết để phát trong ứng dụng, nên không đưa thông tin cá nhân nhạy
          cảm hoặc bí mật vào video bài giảng. Chúng tôi có thể xóa nội dung vi phạm.
        </p>
        <h2>3. Hành vi bị cấm</h2>
        <ul>
          <li>Truy cập trái phép, dò mật khẩu, gây quá tải hoặc làm gián đoạn dịch vụ.</li>
          <li>Tải lên mã độc hoặc nội dung vi phạm pháp luật.</li>
          <li>Nộp bài không phải của chính mình khi bài tập yêu cầu bài làm cá nhân.</li>
        </ul>
        <h2>4. Tạm ngừng và chấm dứt</h2>
        <p>Chúng tôi có thể khóa tài khoản vi phạm điều khoản hoặc gây rủi ro cho hệ thống.</p>
        <h2>5. Miễn trừ</h2>
        <p>
          Dịch vụ được cung cấp &ldquo;như hiện có&rdquo;. Chúng tôi cố gắng duy trì hoạt động ổn
          định nhưng không đảm bảo không gián đoạn hay không mất dữ liệu; hãy giữ bản sao bài làm
          quan trọng.
        </p>
        <h2>6. Quyền riêng tư và liên hệ</h2>
        <p>
          Cách chúng tôi xử lý dữ liệu được nêu trong{' '}
          <Link className="text-link" href="/privacy">
            Chính sách quyền riêng tư
          </Link>
          . Liên hệ:{' '}
          <a className="text-link" href="mailto:quanducbui2017@gmail.com">
            quanducbui2017@gmail.com
          </a>
          .
        </p>
      </article>
    </SiteShell>
  );
}
