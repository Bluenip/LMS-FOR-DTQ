'use client';
import { ExternalLink } from 'lucide-react';
import { Badge } from './ui';

const LECTURER_CHANNEL = 'https://www.youtube.com/@ThichHanhTu.000';
/** The class lecturer: shown in the class introduction tab and on the "Giới thiệu" page. */
export function LecturerCard() {
  return (
    <section className="panel lecturer-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="lecturer-photo"
        src="/giang-su-thich-hanh-tu.jpg"
        alt="Đại đức Thích Hạnh Từ"
        width={1192}
        height={658}
      />
      <div className="stack">
        <div>
          <Badge tone="success">Chủ giảng</Badge>
          <h2 style={{ marginTop: 8 }}>Đại đức Thích Hạnh Từ</h2>
          <p className="muted">
            Giảng sư Phật giáo, trụ trì chùa Kim Long; thường xuyên giảng các đề tài Phật pháp, kinh
            điển và giáo dục nhân cách.
          </p>
        </div>
        <ul className="lecturer-facts">
          <li>
            <strong>Trụ trì:</strong> chùa Kim Long (thôn Thạch An, xã Bình Mỹ, huyện Bình Sơn, tỉnh
            Quảng Ngãi), được bổ nhiệm ngày 28/04/2011. Bổn sư là Thượng tọa Thích Tâm Vị, trụ trì
            chùa Linh Phước, Đà Lạt.
          </li>
          <li>
            <strong>Hoằng pháp:</strong> chủ giảng nhiều chuỗi bài giảng Phật pháp trên các phương
            tiện truyền thông và kênh YouTube chính thức.
          </li>
          <li>
            <strong>Đề tài tiêu biểu:</strong> Liễu Phàm Tứ Huấn (nhiều tập); Nhận Thức Phật Giáo;
            Thập Thiện Nghiệp Đạo Kinh; các chuyên đề về Cẩm nang hạnh phúc và giáo dục đức hạnh.
          </li>
        </ul>
        <div className="inline-actions">
          <a className="button primary" href={LECTURER_CHANNEL} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Kênh YouTube Đại đức Thích Hạnh Từ
          </a>
          <a
            className="button secondary"
            href={`${LECTURER_CHANNEL}/playlists`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} /> Danh sách phát
          </a>
        </div>
      </div>
    </section>
  );
}
