import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LmsProvider } from '@/components/lms-provider';
import { APP_NAME } from '@/lib/brand';
import './globals.css';
import '@/components/auth.css';
import '@/components/admin.css';
export const metadata: Metadata = {
  title: { default: `${APP_NAME} — Giảng đường trực tuyến`, template: `%s | ${APP_NAME}` },
  description:
    'Học Đệ Tử Quy, theo dõi bài giảng và chia sẻ những thực hành đạo đức trong cuộc sống.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Suspense>
          <LmsProvider>{children}</LmsProvider>
        </Suspense>
      </body>
    </html>
  );
}
