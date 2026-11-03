import { isIP } from 'node:net';
import { HttpError } from './auth';
import { bumpCounter, clearCounter } from './repository';

let warned = false;
export function clientIp(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') {
    if (!warned && process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
      warned = true;
      console.warn(
        'TRUST_PROXY_HEADERS is not true: all clients share one login rate-limit bucket per email.',
      );
    }
    return 'local';
  }
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
    private message = 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.',
  ) {}
  consume(key: string, now = Date.now()) {
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= this.maxKeys) {
      for (const [entry, value] of this.entries) if (value.reset <= now) this.entries.delete(entry);
      if (this.entries.size >= this.maxKeys)
        throw new HttpError(429, 'Hệ thống đang nhận nhiều yêu cầu. Vui lòng thử lại sau.');
    }
    if (previous && previous.reset > now && previous.count >= this.limit)
      throw new HttpError(429, this.message);
    this.entries.set(key, {
      count: previous && previous.reset > now ? previous.count + 1 : 1,
      reset: previous && previous.reset > now ? previous.reset : now + this.windowMs,
    });
  }
  reset(key: string) {
    this.entries.delete(key);
  }
}

/**
 * Rate limit whose counters live in PostgreSQL, so they survive restarts and are shared by every
 * instance. If the database call fails the in-memory limiter still protects the process.
 */
export class SharedRateLimit {
  private local: RateLimit;
  constructor(
    private scope: string,
    private limit: number,
    private windowMs: number,
    private message = 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.',
  ) {
    this.local = new RateLimit(limit, windowMs, 10000, message);
  }
  async consume(key: string) {
    let count: number | null = null;
    try {
      count = await bumpCounter(`${this.scope}:${key}`, this.windowMs);
    } catch (error) {
      console.error('Shared rate limit unavailable', error instanceof Error ? error.message : '');
    }
    if (count === null) return this.local.consume(key);
    if (count > this.limit) throw new HttpError(429, this.message);
  }
  async reset(key: string) {
    this.local.reset(key);
    await clearCounter(`${this.scope}:${key}`).catch(() => undefined);
  }
}
