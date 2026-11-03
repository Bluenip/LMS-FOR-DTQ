import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonObject } from '../src/lib/server/request';
import { clientIp, RateLimit } from '../src/lib/server/rate-limit';

const request = (body: string, headers?: HeadersInit) =>
  new Request('http://localhost/api/actions', { method: 'POST', body, headers });

test('JSON parsing accepts objects and rejects malformed JSON, null, arrays and primitives', async () => {
  assert.deepEqual(await readJsonObject(request('{"name":"An"}')), { name: 'An' });
  for (const value of ['{', '', 'null', '[]', '"string"', '123'])
    await assert.rejects(readJsonObject(request(value)));
});
test('JSON body limits count UTF-8 bytes and do not rely on a smaller declared length', async () => {
  const value = JSON.stringify({ text: 'đ'.repeat(30) });
  assert(value.length < 50);
  await assert.rejects(readJsonObject(request(value), 50), { status: 413 });
  await assert.rejects(readJsonObject(request(value, { 'Content-Length': '1' }), 50), {
    status: 413,
  });
  await assert.rejects(readJsonObject(request('{}', { 'Content-Length': '999' }), 50), {
    status: 413,
  });
});
test('an oversized streamed JSON request cancels the stream before buffering all chunks', async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(40));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const input = new Request('http://localhost/api/actions', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await assert.rejects(readJsonObject(input, 50), { status: 413 });
  assert.equal(cancelled, true);
  assert.equal(reads, 2);
});
test('login rate limits reserve attempts before asynchronous authentication and expire normally', () => {
  const limiter = new RateLimit(2, 100);
  limiter.consume('user', 0);
  limiter.consume('user', 1);
  assert.throws(() => limiter.consume('user', 2), { status: 429 });
  limiter.consume('user', 101);
  limiter.reset('user');
  limiter.consume('user', 102);
});
test('rate limiter bounds distinct keys and reclaims expired entries', () => {
  const limiter = new RateLimit(2, 100, 2);
  limiter.consume('one', 0);
  limiter.consume('two', 0);
  assert.throws(() => limiter.consume('three', 1), { status: 429 });
  limiter.consume('three', 101);
  limiter.consume('four', 101);
});
test('successful login only resets the matching account bucket', () => {
  const limiter = new RateLimit(1, 100);
  limiter.consume('ip:target', 0);
  limiter.consume('ip:other-account', 0);
  limiter.reset('ip:other-account');
  limiter.consume('ip:other-account', 1);
  assert.throws(() => limiter.consume('ip:target', 1), { status: 429 });
});
test('client IP headers are ignored unless the reverse proxy is explicitly trusted', () => {
  const original = process.env.TRUST_PROXY_HEADERS;
  try {
    delete process.env.TRUST_PROXY_HEADERS;
    const input = request('{}', {
      'CF-Connecting-IP': '203.0.113.10',
      'X-Forwarded-For': '198.51.100.5',
    });
    assert.equal(clientIp(input), 'local');
    process.env.TRUST_PROXY_HEADERS = 'true';
    assert.equal(clientIp(input), '203.0.113.10');
    assert.equal(
      clientIp(request('{}', { 'X-Forwarded-For': 'forged, 203.0.113.20' })),
      '203.0.113.20',
    );
    assert.equal(clientIp(request('{}', { 'CF-Connecting-IP': 'not-an-ip' })), 'local');
  } finally {
    if (original === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = original;
  }
});
