import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { seedData } from '../src/lib/server/seed-data';
import {
  createAuthToken,
  forgotPassword,
  registerAccount,
  resendVerification,
  resetPassword,
  tokenHash,
  verifyEmail,
} from '../src/lib/server/accounts';
import {
  accountEnabled,
  publicUser,
  readSession,
  sessionMatches,
  signSession,
  verifyPassword,
} from '../src/lib/server/auth';
import { emailMode, mailOrigin, sendAccountMail } from '../src/lib/server/mail';
import { withDatabase } from '../src/lib/server/repository';

const original = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
const initial = seedData();
const fixture = () => structuredClone(initial);
const input = { name: 'Học viên mới', email: 'learner@example.com', password: 'mat-khau-123456' };
const origin = 'http://localhost:3000';
const tokenFrom = (value: { previewUrl?: string }) =>
  new URL(value.previewUrl!).searchParams.get('token')!;
async function registered() {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  const db = fixture();
  const result = await registerAccount(db, input, origin);
  return { db, result, user: db.users.find((u) => u.email === input.email)! };
}

test('public registration creates only an unverified student and stores token hash rather than bearer token', async () => {
  const { db, result, user } = await registered();
  assert.equal(user.role, 'STUDENT');
  assert.equal(user.emailVerified, false);
  assert.equal(accountEnabled(user), false);
  assert.equal(verifyPassword(input.password, user.passwordHash), true);
  const raw = tokenFrom(result);
  assert.match(raw, /^[a-f0-9]{64}$/);
  assert.equal(db.authTokens[0].tokenHash, tokenHash(raw));
  assert.equal(JSON.stringify(db).includes(raw), false);
  assert.equal(new URL(result.previewUrl!).pathname, '/verify-email');
  assert.equal(Object.hasOwn(publicUser(user), 'sessionVersion'), false);
  assert.equal(Object.hasOwn(publicUser(user), 'passwordHash'), false);
});

test('teacher role injection, short passwords and confirmation mismatch cannot create an account', async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  const db = fixture();
  const count = db.users.length;
  await assert.rejects(registerAccount(db, { ...input, role: 'TEACHER' }, origin));
  await assert.rejects(registerAccount(db, { ...input, password: 'Short77' }, origin));
  await assert.rejects(
    registerAccount(db, { ...input, confirmPassword: 'different-password' }, origin),
    /chưa khớp/,
  );
  assert.equal(db.users.length, count);
});

test('email addresses are normalized and duplicate registration does not overwrite account credentials', async () => {
  const { db, user, result: verification } = await registered();
  verifyEmail(db, { token: tokenFrom(verification) });
  const originalHash = user.passwordHash;
  const result = await registerAccount(
    db,
    { ...input, name: 'Thay tên', email: ' LEARNER@example.COM ', password: 'different-password' },
    origin,
  );
  assert.equal(db.users.filter((u) => u.email === input.email).length, 1);
  assert.equal(user.passwordHash, originalHash);
  assert.equal(user.name, input.name);
  assert.equal(result.previewUrl, undefined);
});

test('verification token has a one-hour expiry, one use, and rejects reset purpose', async () => {
  const { db, result, user } = await registered();
  const raw = tokenFrom(result);
  assert.throws(() => verifyEmail(db, { token: raw }, Date.now() + 3600001), /hết hạn/);
  assert.throws(() => resetPassword(db, { token: raw, password: 'new-password-123' }), /hết hạn/);
  assert.equal(user.emailVerified, false);
  verifyEmail(db, { token: raw });
  assert.equal(user.emailVerified, true);
  assert.equal(accountEnabled(user), true);
  assert.throws(() => verifyEmail(db, { token: raw }), /hết hạn/);
});

test('resend cooldown does not issue new token or invalidate the previous delivered link', async () => {
  const { db, result } = await registered();
  const first = db.authTokens[0].tokenHash;
  const resent = await resendVerification(db, { email: input.email }, origin);
  assert.equal(resent.previewUrl, undefined);
  assert.equal(db.authTokens.length, 1);
  assert.equal(db.authTokens[0].tokenHash, first);
  verifyEmail(db, { token: tokenFrom(result) });
});

test('forgot password does not expose demo account reset links or unknown emails', async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  const db = fixture();
  const sample = await forgotPassword(db, { email: 'teacher@detuquy.vn' }, origin);
  const unknown = await forgotPassword(db, { email: 'unknown@example.com' }, origin);
  assert.deepEqual(sample, unknown);
  assert.equal(db.authTokens.length, 0);
});

test('reset token expires after thirty minutes, cannot verify email, and invalidates old sessions', async () => {
  const { db, result, user } = await registered();
  verifyEmail(db, { token: tokenFrom(result) });
  const reset = await forgotPassword(db, { email: input.email }, origin);
  const raw = tokenFrom(reset);
  const oldSession = { id: user.id, version: user.sessionVersion ?? 0 };
  assert.equal(sessionMatches(user, oldSession), true);
  assert.throws(() => verifyEmail(db, { token: raw }), /hết hạn/);
  assert.throws(
    () => resetPassword(db, { token: raw, password: 'new-password-123' }, Date.now() + 1800001),
    /hết hạn/,
  );
  resetPassword(db, {
    token: raw,
    password: 'new-password-123',
    confirmPassword: 'new-password-123',
  });
  assert.equal(verifyPassword(input.password, user.passwordHash), false);
  assert.equal(verifyPassword('new-password-123', user.passwordHash), true);
  assert.equal(sessionMatches(user, oldSession), false);
  assert.equal(sessionMatches(user, { id: user.id, version: 1 }), true);
  assert.throws(
    () => resetPassword(db, { token: raw, password: 'another-password-123' }),
    /hết hạn/,
  );
});

test('issuing replacement reset token invalidates all older reset links', async () => {
  const { db, user } = await registered();
  user.emailVerified = true;
  const first = createAuthToken(db, user.id, 'RESET_PASSWORD');
  const second = createAuthToken(db, user.id, 'RESET_PASSWORD');
  assert.notEqual(first, second);
  assert.throws(() => resetPassword(db, { token: first, password: 'new-password-123' }), /hết hạn/);
  resetPassword(db, { token: second, password: 'new-password-123' });
});

test('signed session versions are preserved and tampering is rejected', async () => {
  process.env.SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
  const signed = await signSession('learner', 7);
  assert.deepEqual(await readSession(signed), { id: 'learner', version: 7 });
  assert.equal(await readSession(signed + 'x'), null);
});

test('legacy accounts remain readable while production sample accounts require explicit opt-in', () => {
  const user = fixture().users[0];
  delete user.emailVerified;
  delete user.sessionVersion;
  delete user.isDemo;
  delete process.env.DATABASE_URL;
  assert.equal(accountEnabled(user), true);
  process.env.DATABASE_URL = 'postgres://unused';
  delete process.env.ALLOW_DEMO_ACCOUNTS;
  assert.equal(accountEnabled(user), false);
  process.env.ALLOW_DEMO_ACCOUNTS = 'true';
  assert.equal(accountEnabled(user), true);
  assert.deepEqual(Object.keys(publicUser(user)).sort(), ['email', 'id', 'name', 'role']);
});

test('missing production SMTP fails honestly before creating an account', async () => {
  process.env.DATABASE_URL = 'postgres://unused';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  const db = fixture();
  const count = db.users.length;
  assert.equal(emailMode(), 'unavailable');
  await assert.rejects(registerAccount(db, input, origin), /chưa được cấu hình/);
  assert.equal(db.users.length, count);
  assert.throws(() => mailOrigin(new Request(origin)), /chưa được cấu hình/);
});

test('SMTP links require configured APP_URL rather than trusting request Host', () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_FROM = 'school@example.com';
  delete process.env.APP_URL;
  assert.throws(() => mailOrigin(new Request('https://attacker.example')), /APP_URL/);
  process.env.APP_URL = 'https://learning.example.com';
  assert.equal(mailOrigin(new Request('https://attacker.example')), 'https://learning.example.com');
});

test('failed email delivery rolls back registration and token persistence', async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  const cwd = process.cwd();
  const temporary = await mkdtemp(join(tmpdir(), 'lms-auth-test-'));
  try {
    process.chdir(temporary);
    await assert.rejects(
      withDatabase(
        (db) =>
          registerAccount(db, input, origin, async () => {
            throw new Error('SMTP unavailable');
          }),
        true,
      ),
      /SMTP unavailable/,
    );
    const stored = await withDatabase((db) => ({
      user: db.users.find((u) => u.email === input.email),
      tokens: db.authTokens,
    }));
    assert.equal(stored.user, undefined);
    assert.deepEqual(stored.tokens, []);
  } finally {
    process.chdir(cwd);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('SMTP delivery transports actual mail locally and never returns its bearer link', async () => {
  const sockets = new Set<Socket>();
  let received = '';
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let dataMode = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (true) {
        if (dataMode) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          received += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write('250 accepted\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 SIZE 100000\r\n');
        else if (/^DATA/.test(line)) {
          dataMode = true;
          socket.write('354 End data\r\n');
        } else if (/^QUIT/.test(line)) {
          socket.end('221 Bye\r\n');
          return;
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String((server.address() as { port: number }).port);
    process.env.SMTP_FROM = 'School <school@example.com>';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const result = await sendAccountMail({
      to: input.email,
      url: `${origin}/reset-password?token=${'a'.repeat(64)}`,
      purpose: 'RESET_PASSWORD',
    });
    assert.deepEqual(result, {});
    assert.match(received, /To: learner@example.com/);
    assert.match(received, /reset-password/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a victim re-registering a pending account activates only credentials bound to their own verification link', async () => {
  const { db, result: attacker, user } = await registered();
  const oldHash = user.passwordHash;
  await assert.rejects(
    registerAccount(db, { ...input, password: 'victim-selected-password' }, origin),
    /một phút/,
  );
  db.authTokens[0].createdAt = new Date(Date.now() - 61000).toISOString();
  const victim = await registerAccount(
    db,
    { ...input, name: 'Chủ email thật', password: 'victim-selected-password' },
    origin,
  );
  assert.equal(user.passwordHash, oldHash);
  assert.throws(() => verifyEmail(db, { token: tokenFrom(attacker) }), /hết hạn/);
  verifyEmail(db, { token: tokenFrom(victim) });
  assert.equal(user.name, 'Chủ email thật');
  assert.equal(verifyPassword('victim-selected-password', user.passwordHash), true);
  assert.equal(verifyPassword(input.password, user.passwordHash), false);
});

test('resend preserves the credentials of the latest registration token', async () => {
  const { db, user } = await registered();
  db.authTokens[0].createdAt = new Date(Date.now() - 61000).toISOString();
  const replacement = await registerAccount(
    db,
    { ...input, password: 'replacement-password-123' },
    origin,
  );
  db.authTokens[0].createdAt = new Date(Date.now() - 61000).toISOString();
  const resent = await resendVerification(db, { email: input.email }, origin);
  assert.throws(() => verifyEmail(db, { token: tokenFrom(replacement) }), /hết hạn/);
  verifyEmail(db, { token: tokenFrom(resent) });
  assert.equal(verifyPassword('replacement-password-123', user.passwordHash), true);
});

test('public app URLs and request hosts never expose local email previews', () => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  process.env.APP_URL = 'https://school.example.com';
  assert.equal(emailMode(), 'unavailable');
  delete process.env.APP_URL;
  assert.throws(() => mailOrigin(new Request('https://school.example.com')), /cục bộ/);
});
