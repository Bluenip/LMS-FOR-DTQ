import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Route-level tests: start the real production server (`next start`) on a free port with its own
 * data folder and talk to it over HTTP. They catch what service-level tests cannot (routing,
 * cookies, headers, request-body handling). Skipped when there is no up-to-date `npm run build`.
 */
const root = process.cwd();
const buildId = join(root, '.next', 'BUILD_ID');
function newestSource(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    newest = Math.max(newest, name.isDirectory() ? newestSource(path) : statSync(path).mtimeMs);
  }
  return newest;
}
const skip = !existsSync(buildId)
  ? 'no production build (run npm run build)'
  : statSync(buildId).mtimeMs < newestSource(join(root, 'src')) - 1000
    ? 'the production build is older than src/ (run npm run build)'
    : false;

const testDb = process.env.TEST_DATABASE_URL;
const pgUrl = testDb && ['localhost', '127.0.0.1'].includes(new URL(testDb).hostname) ? testDb : '';
let server: ChildProcess | undefined;
let base = '';
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;
function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
async function login(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email, password }),
  });
  return { response, cookie: cookieOf(response) };
}
const call = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...init.headers },
  });

before(async () => {
  if (skip) return;
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    LMS_DATA_DIR: mkdtempSync(join(tmpdir(), 'routes-')),
    SESSION_SECRET: 'routes-test-session-secret-0123456789abcdef',
    APP_URL: base,
    // With TEST_DATABASE_URL (local PostgreSQL, migrated and seeded) the same tests run against it.
    DATABASE_URL: pgUrl,
    ALLOW_DEMO_ACCOUNTS: pgUrl ? 'true' : 'false',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  } as NodeJS.ProcessEnv;
  server = spawn(
    process.execPath,
    [
      join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-p',
      String(port),
      '-H',
      '127.0.0.1',
    ],
    { cwd: root, env, stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
});
after(() => {
  server?.kill();
});

test('security headers are sent on pages and API responses', { skip }, async () => {
  for (const path of ['/login', '/api/health']) {
    const headers = (await fetch(`${base}${path}`)).headers;
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.match(headers.get('strict-transport-security') ?? '', /max-age=31536000/);
    // The nonce-based policy is attached by the proxy to pages only (API responses are JSON).
    if (path.startsWith('/api')) continue;
    const csp = headers.get('content-security-policy') ?? '';
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      'frame-src',
      'https://www.googleapis.com',
    ])
      assert.ok(csp.includes(directive), `CSP lacks ${directive}`);
    assert.ok(!csp.includes('unsafe-eval'), 'no eval in production');
  }
});

test('login answers identically for unknown emails and wrong passwords', { skip }, async () => {
  const wrong = await login('teacher@detuquy.vn', 'sai-mat-khau');
  const unknown = await login('khong-ton-tai@example.com', 'sai-mat-khau');
  assert.equal(wrong.response.status, 401);
  assert.equal(unknown.response.status, 401);
  assert.deepEqual(await json(wrong.response), await json(unknown.response));
  assert.equal(wrong.cookie, '');
});

test('login is rate limited per client and email', { skip }, async () => {
  let last = 0;
  for (let i = 0; i < 22; i++) last = (await login('spam@example.com', 'x')).response.status;
  assert.equal(last, 429);
  // Another email is not affected by the first one's lock-out.
  assert.equal((await login('other@example.com', 'x')).response.status, 401);
});

test('state is cached with an ETag and revalidates with 304', { skip }, async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const { cookie } = await login('teacher@detuquy.vn', 'Demo@2026');
  const first = await call('/api/state', cookie);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  await first.arrayBuffer();
  const second = await call('/api/state', cookie, { headers: { 'If-None-Match': etag! } });
  assert.equal(second.status, 304);
  assert.equal((await second.arrayBuffer()).byteLength, 0);
  const stale = await call('/api/state', cookie, { headers: { 'If-None-Match': '"nope"' } });
  assert.equal(stale.status, 200);
  const me = await call('/api/auth/me', cookie);
  assert.equal(((await json(me)).user as { id: string }).id, 'teacher-1');
});

test(
  'cross-origin writes are refused and unauthenticated calls need a session',
  { skip },
  async () => {
    const { cookie } = await login('teacher@detuquy.vn', 'Demo@2026');
    const evil = await fetch(`${base}/api/actions`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'createClass', title: 'Tấn công' }),
    });
    assert.equal(evil.status, 403);
    const anonymous = await fetch(`${base}/api/actions`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createClass', title: 'x' }),
    });
    assert.equal(anonymous.status, 401);
  },
);

test(
  'edits of shared content are refused without the version they started from',
  { skip },
  async () => {
    const { cookie } = await login('teacher@detuquy.vn', 'Demo@2026');
    const created = await call('/api/actions', cookie, {
      method: 'POST',
      body: JSON.stringify({ action: 'createClass', title: 'Lớp route' }),
    });
    const classId = ((await json(created)).result as { id: string }).id;
    const stale = await call('/api/actions', cookie, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateClass', classId, title: 'Đổi tên' }),
    });
    assert.equal(stale.status, 409);
  },
);

test(
  'Drive routes: DELETE needs no body, unknown ids are 404, access needs a session',
  { skip },
  async () => {
    const { cookie } = await login('teacher@detuquy.vn', 'Demo@2026');
    // Regression: DELETE has no payload and used to fail with "invalid JSON" (400).
    const cancel = await call('/api/drive/uploads/does-not-exist', cookie, { method: 'DELETE' });
    assert.equal(cancel.status, 404);
    const remove = await call('/api/drive/files/does-not-exist', cookie, { method: 'DELETE' });
    assert.equal(remove.status, 404);
    const resume = await call('/api/drive/uploads/does-not-exist/resume', cookie, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(resume.status, 404);
    for (const suffix of ['view', 'download'])
      assert.equal((await call(`/api/drive/files/does-not-exist/${suffix}`, cookie)).status, 404);
    assert.equal((await fetch(`${base}/api/drive/files/x/view`)).status, 401);
    assert.equal((await fetch(`${base}/api/drive/status`)).status, 401);
    // Drive is not configured in this server: the status says so and uploads are refused.
    const status = await json(await call('/api/drive/status', cookie));
    assert.equal(status.configured, false);
    // Only administrators can start the connection or run maintenance.
    assert.equal((await call('/api/drive/connect', cookie, { redirect: 'manual' })).status, 403);
    assert.equal(
      (await call('/api/drive/maintenance', cookie, { method: 'POST', body: '{}' })).status,
      403,
    );
    assert.equal((await call('/api/admin/audit', cookie)).status, 403);
  },
);
