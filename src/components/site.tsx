import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';

/** Shared frame of the public pages (home, privacy policy, terms): no sign-in required. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="container header-inner">
          <Link href="/" className="brand">
            <strong>{APP_NAME}</strong>
          </Link>
          <nav className="header-nav" aria-label="Trang công khai">
            <Link href="/privacy">Quyền riêng tư</Link>
            <Link href="/terms">Điều khoản</Link>
          </nav>
          <div className="header-account">
            <Link className="button primary" href="/login">
              Đăng nhập
            </Link>
          </div>
        </div>
      </header>
      <main className="app-main">
        <div className="container site-page">{children}</div>
      </main>
      <footer className="app-footer">
        <div className="container footer-inner">
          <span className="footer-brand">{APP_NAME}</span>
          <span>
            <Link className="text-link" href="/privacy">
              Chính sách quyền riêng tư
            </Link>{' '}
            ·{' '}
            <Link className="text-link" href="/terms">
              Điều khoản sử dụng
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
