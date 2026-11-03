import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cookies } from 'next/headers';
import type { Database, StoredUser, User } from '@/lib/types';
import { DEFAULT_ACCOUNT_PASSWORD } from '@/lib/account-policy';
export const COOKIE = 'dtq_session';
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
let secret: Promise<string> | undefined;
function sessionSecret() {
  return (secret ??= (async () => {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
      return process.env.SESSION_SECRET;
    if (process.env.DATABASE_URL)
      throw new Error('SESSION_SECRET phải có ít nhất 32 ký tự khi dùng PostgreSQL.');
    await mkdir('.data', { recursive: true });
    try {
      return await readFile('.data/session-secret', 'utf8');
    } catch {
      const value = randomBytes(48).toString('hex');
      try {
        await writeFile('.data/session-secret', value, { flag: 'wx', mode: 0o600 });
        return value;
      } catch {
        return readFile('.data/session-secret', 'utf8');
      }
    }
  })());
}
export async function signSession(id: string, version = 0) {
  const value = Buffer.from(
    JSON.stringify({ id, version, exp: Date.now() + 7 * 86400000 }),
  ).toString('base64url');
  return `${value}.${createHmac('sha256', await sessionSecret())
    .update(value)
    .digest('base64url')}`;
}
export async function readSession(token: string | undefined) {
  if (!token) return null;
  if (token.split('.').length !== 2) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(
    createHmac('sha256', await sessionSecret())
      .update(payload)
      .digest('base64url'),
  );
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof value.id === 'string' &&
      value.exp > Date.now() &&
      Number.isInteger(value.version ?? 0)
      ? { id: value.id as string, version: (value.version ?? 0) as number }
      : null;
  } catch {
    return null;
  }
}
export function isDemoAccount(user: StoredUser) {
  const fixtures: Record<string, string> = {
    'teacher-1': 'teacher@detuquy.vn',
    'student-1': 'student@detuquy.vn',
    'student-2': 'chau@detuquy.vn',
    'student-3': 'nam@detuquy.vn',
    'student-4': 'mai@detuquy.vn',
  };
  return user.isDemo === true || fixtures[user.id] === user.email;
}
export function demoMode(request?: Request) {
  if (process.env.DATABASE_URL) return false;
  const loopback = (value: string) => {
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
    } catch {
      return false;
    }
  };
  if (process.env.APP_URL && !loopback(process.env.APP_URL)) return false;
  if (request) {
    const value = new URL(request.url);
    if (!loopback(`${value.protocol}//${request.headers.get('host') || value.host}`)) return false;
  }
  return true;
}
export function accountEnabled(user: StoredUser, request?: Request) {
  return (
    user.disabled !== true &&
    user.emailVerified !== false &&
    (!isDemoAccount(user) || demoMode(request) || process.env.ALLOW_DEMO_ACCOUNTS === 'true')
  );
}
export function sessionMatches(
  user: StoredUser | undefined,
  session: { id: string; version: number },
) {
  return (
    !!user &&
    user.id === session.id &&
    (user.sessionVersion ?? 0) === session.version &&
    accountEnabled(user)
  );
}
export async function sessionUserId() {
  const session = await readSession((await cookies()).get(COOKIE)?.value);
  if (!session) return null;
  const { findSessionUser } = await import('./repository');
  return sessionMatches(await findSessionUser(session.id), session) ? session.id : null;
}
const legacyPasswordCache = new Map<string, boolean>();
export function needsPasswordChange(user: StoredUser) {
  if (user.mustChangePassword) return true;
  if (isDemoAccount(user)) return false;
  const cached = legacyPasswordCache.get(user.passwordHash);
  if (cached !== undefined) return cached;
  const legacy = verifyPassword(DEFAULT_ACCOUNT_PASSWORD, user.passwordHash);
  if (legacyPasswordCache.size >= 10000) legacyPasswordCache.clear();
  legacyPasswordCache.set(user.passwordHash, legacy);
  return legacy;
}
export function requireUser(
  db: Database,
  id: string | null,
  allowPasswordChange = false,
): StoredUser {
  const user = db.users.find((u) => u.id === id);
  if (!user || !accountEnabled(user)) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
  if (!allowPasswordChange && needsPasswordChange(user))
    throw new HttpError(403, 'Vui lòng đổi mật khẩu trước khi tiếp tục.');
  return user;
}
export function publicUser(user: StoredUser, includePasswordState = true): User {
  const { id, name, email, role, avatar } = user;
  return {
    id,
    name,
    email,
    role,
    ...(avatar ? { avatar } : {}),
    ...(user.isAdmin ? { isAdmin: true } : {}),
    ...(includePasswordState && needsPasswordChange(user) ? { mustChangePassword: true } : {}),
  };
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host');
  const allowed =
    process.env.APP_URL || (host ? `${requestUrl.protocol}//${host}` : requestUrl.origin);
  if (origin && origin !== allowed) throw new HttpError(403, 'Nguồn yêu cầu không hợp lệ.');
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error && typeof error === 'object' && 'issues' in error)
    return Response.json(
      {
        error: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra các trường bắt buộc.',
        details: (error as { issues: unknown }).issues,
      },
      { status: 400 },
    );
  console.error(error);
  return Response.json({ error: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' }, { status: 500 });
}
