import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { consumeSharedRateLimit, resetSharedRateLimit } from '../src/lib/server/rate-limit';

test('shared limiter reserves a slot before asynchronous callers proceed and resets only the matching key', async () => {
  const database = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const target = `target:${randomUUID()}`;
    const other = `other:${randomUUID()}`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 40 }, () => consumeSharedRateLimit(target, 10, 60000)),
    );
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 10);
    assert(
      attempts
        .filter((result) => result.status === 'rejected')
        .every((result) => result.status === 'rejected' && result.reason.status === 429),
    );
    await consumeSharedRateLimit(other, 10, 60000);
    await resetSharedRateLimit(other);
    await assert.rejects(consumeSharedRateLimit(target, 10, 60000), { status: 429 });
    await resetSharedRateLimit(target);
    await consumeSharedRateLimit(target, 10, 60000);
  } finally {
    if (database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = database;
  }
});

test('shared limiter replenishes an expired window without resetting another account', async () => {
  const database = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const key = `expiry:${randomUUID()}`;
    const other = `other:${randomUUID()}`;
    await consumeSharedRateLimit(key, 1, 20);
    await consumeSharedRateLimit(other, 1, 60000);
    await assert.rejects(consumeSharedRateLimit(key, 1, 20), { status: 429 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await consumeSharedRateLimit(key, 1, 20);
    await assert.rejects(consumeSharedRateLimit(other, 1, 60000), { status: 429 });
  } finally {
    if (database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = database;
  }
});
