import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const devStorage = dev ? ' http://localhost:* http://127.0.0.1:*' : '';
  // Signed object URLs use the configured S3 endpoint. Never allow all HTTPS
  // origins: that would also allow scripts to exfiltrate data to any host.
  let storageOrigin = '';
  const endpoint = process.env.CSP_STORAGE_ORIGIN || process.env.S3_ENDPOINT;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol === 'https:' || (dev && url.protocol === 'http:'))
        storageOrigin = ` ${url.origin}`;
    } catch {
      // Invalid configuration does not widen the policy.
    }
  } else if (process.env.S3_BUCKET && process.env.S3_REGION && process.env.S3_REGION !== 'auto') {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    if (/^[a-z0-9][a-z0-9.-]*$/.test(bucket) && /^[a-z0-9-]+$/.test(region))
      storageOrigin = bucket.includes('.')
        ? ` https://s3.${region}.amazonaws.com`
        : ` https://${bucket}.s3.${region}.amazonaws.com`;
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com https://i.ytimg.com${storageOrigin}${devStorage}`,
    `media-src 'self' blob:${storageOrigin}${devStorage}`,
    `connect-src 'self' https://www.googleapis.com${storageOrigin}${devStorage}`,
    "frame-src 'self' https://drive.google.com https://docs.google.com https://www.youtube-nocookie.com https://www.youtube.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
