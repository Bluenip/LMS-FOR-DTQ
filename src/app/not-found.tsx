import Link from 'next/link';
import { Empty } from '@/components/ui';
export default function NotFound() {
  return (
    <Empty
      title="Không tìm thấy trang"
      description="Đường dẫn này không còn tồn tại. Quay lại giảng đường để tiếp tục."
    >
      <Link className="button primary" href="/">
        Về giảng đường
      </Link>
    </Empty>
  );
}
