import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
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
  release(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.reset <= now || entry.count <= 1) this.entries.delete(key);
    else entry.count--;
  }
}

const localSharedLimits = new Map<string, RateLimit>();
export async function consumeSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.',
) {
  const hashed = createHash('sha256').update(key).digest('hex');
  if (process.env.DATABASE_URL) {
    const { consumeRequestLimit } = await import('./repository');
    if (!(await consumeRequestLimit(hashed, limit, windowMs))) throw new HttpError(429, message);
    return;
  }
  const policy = `${limit}:${windowMs}:${message}`;
  let limiter = localSharedLimits.get(policy);
  if (!limiter) {
    limiter = new RateLimit(limit, windowMs, 10000, message);
    localSharedLimits.set(policy, limiter);
  }
  limiter.consume(hashed);
}

export async function resetSharedRateLimit(key: string) {
  const hashed = createHash('sha256').update(key).digest('hex');
  if (process.env.DATABASE_URL) {
    const { resetRequestLimit } = await import('./repository');
    await resetRequestLimit(hashed);
  } else {
    for (const limiter of localSharedLimits.values()) limiter.reset(hashed);
  }
}

/** Release one reserved attempt after successful authentication. */
export async function releaseSharedRateLimit(key: string) {
  const hashed = createHash('sha256').update(key).digest('hex');
  if (process.env.DATABASE_URL) {
    const { releaseRequestLimit } = await import('./repository');
    await releaseRequestLimit(hashed);
  } else {
    for (const limiter of localSharedLimits.values()) limiter.release(hashed);
  }
}
