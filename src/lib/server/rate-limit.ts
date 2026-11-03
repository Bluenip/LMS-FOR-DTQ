import { isIP } from 'node:net';
import { HttpError } from './auth';

export function clientIp(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'local';
  const ip =
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return ip && isIP(ip) ? ip : 'local';
}

export class RateLimit {
  private entries = new Map<string, { count: number; reset: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = 10000,
  ) {}
  consume(key: string, now = Date.now()) {
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= this.maxKeys) {
      for (const [entry, value] of this.entries) if (value.reset <= now) this.entries.delete(entry);
      if (this.entries.size >= this.maxKeys)
        throw new HttpError(429, 'Hệ thống đang nhận nhiều yêu cầu. Vui lòng thử lại sau.');
    }
    if (previous && previous.reset > now && previous.count >= this.limit)
      throw new HttpError(429, 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.');
    this.entries.set(key, {
      count: previous && previous.reset > now ? previous.count + 1 : 1,
      reset: previous && previous.reset > now ? previous.reset : now + this.windowMs,
    });
  }
  reset(key: string) {
    this.entries.delete(key);
  }
}
