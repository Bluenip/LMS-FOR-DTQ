import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';
/**
 * Content-Security-Policy. Next.js App Router inlines its hydration scripts, so script-src needs
 * 'unsafe-inline' (a nonce-based policy would force every page to be rendered dynamically).
 * Everything else is locked down; the only third parties are the ones the app really uses:
 *  - Google Drive: preview iframes, and resumable uploads PUT straight to www.googleapis.com;
 *  - YouTube: embedded lesson videos.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com https://i.ytimg.com",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://www.googleapis.com${dev ? ' ws: wss:' : ''}`,
  "frame-src 'self' https://drive.google.com https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: csp },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          // Ignored on plain http (local development); on https browsers refuse to downgrade.
          ...(dev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      ...['/verify-email', '/reset-password'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      })),
    ];
  },
};
export default config;
