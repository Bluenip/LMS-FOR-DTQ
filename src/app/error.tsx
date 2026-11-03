'use client';
import { Button } from '@/components/ui';
import { RefreshCw } from 'lucide-react';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel stack" role="alert">
      <h1>Chưa thể mở nội dung</h1>
      <p className="muted">Kết nối có thể bị gián đoạn. Hãy thử tải lại nội dung học tập.</p>
      <div>
        <Button onClick={reset}>
          <RefreshCw size={16} />
          Thử lại
        </Button>
      </div>
    </section>
  );
}
