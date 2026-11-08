import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';
import { SiteShell } from '@/components/site';

export default function Home() {
  return (
    <SiteShell>
      <section className="site-hero">
        <span className="badge">Giảng đường trực tuyến</span>
        <h1>{APP_NAME}</h1>
        <p>
          Nền tảng học tập trực tuyến: giáo viên xây dựng bài giảng, giao bài tập và chấm điểm; học
          viên xem video, đọc học liệu, nộp bài và theo dõi tiến độ của mình.
        </p>
        <div className="heading-actions">
          <Link className="button primary" href="/login">
            Đăng nhập
          </Link>
          <Link className="button secondary" href="/privacy">
            Chính sách quyền riêng tư
          </Link>
        </div>
      </section>
      <section className="site-grid">
        <article className="panel">
          <h3>Bài giảng và học liệu</h3>
          <p className="muted">Video, tài liệu PDF/Word/PowerPoint được sắp xếp theo từng lớp.</p>
        </article>
        <article className="panel">
          <h3>Bài tập và chấm điểm</h3>
          <p className="muted">
            Giao bài, nộp bài bằng văn bản, tệp hoặc video, chấm theo thang điểm.
          </p>
        </article>
        <article className="panel">
          <h3>Lưu trữ trên Google Drive</h3>
          <p className="muted">
            Video và tệp tải lên được lưu trong một thư mục Google Drive do quản trị viên kết nối và
            chỉ dùng cho việc học trong lớp. Xem{' '}
            <Link className="text-link" href="/privacy">
              chính sách quyền riêng tư
            </Link>
            .
          </p>
        </article>
      </section>
    </SiteShell>
  );
}
