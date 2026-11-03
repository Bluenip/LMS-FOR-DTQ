import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  completeStoredUpload,
  fileRecord,
  finalizeObject,
  storageStatus,
} from '../src/lib/server/storage';
import { reserveUpload, UploadGate, readUploadBody } from '../src/lib/server/upload-policy';
import { staleUnreferencedFileIds, orphanedStorageKeys } from '../src/lib/storage-cleanup';
import { seedData } from '../src/lib/server/seed-data';

function file() {
  return fileRecord('student-1', {
    classId: 'dtq-2026',
    name: 'sample.pdf',
    size: 10,
    mimeType: 'application/pdf',
    kind: 'document',
  });
}
function operations(events: string[], fail?: string) {
  return {
    verifyObject: async () => {
      events.push('verify');
      if (fail === 'verify') throw new Error(fail);
      return 'etag';
    },
    finalizeObject: async () => {
      events.push('copy');
      if (fail === 'copy') throw new Error(fail);
      return 'verified/copy';
    },
    deleteObject: async () => {
      events.push('delete');
      if (fail === 'delete') throw new Error(fail);
    },
  };
}
for (const stage of ['verify', 'copy', 'commit'])
  test(`completion preserves source on ${stage} failure and succeeds on retry`, async () => {
    const record = file();
    const events: string[] = [];
    await assert.rejects(
      completeStoredUpload(
        record,
        async (key) => {
          events.push('commit');
          if (stage === 'commit') throw new Error(stage);
          return { ...record, key, verified: true };
        },
        operations(events, stage),
      ),
      new RegExp(stage),
    );
    assert(!events.includes('delete'));
    const retried: string[] = [];
    const result = await completeStoredUpload(
      record,
      async (key) => {
        retried.push('commit');
        return { ...record, key, verified: true };
      },
      operations(retried),
    );
    assert.equal(result.verified, true);
    assert.deepEqual(retried, ['verify', 'copy', 'commit', 'delete']);
  });
test('cleanup failure after commit still returns success and committed retries do no object I/O', async () => {
  const record = file();
  const events: string[] = [];
  const result = await completeStoredUpload(
    record,
    async (key) => ({ ...record, key, verified: true }),
    operations(events, 'delete'),
  );
  assert.equal(result.verified, true);
  const retry: string[] = [];
  assert.equal(
    await completeStoredUpload(
      result,
      async () => {
        throw new Error('unexpected commit');
      },
      operations(retry),
    ),
    result,
  );
  assert.deepEqual(retry, []);
});
test('concurrent completion returns the already committed winner without replacing its key', async () => {
  const record = file();
  const winner = { ...record, key: 'verified/winning-version', verified: true };
  const result = await completeStoredUpload(record, async () => winner, operations([]));
  assert.equal(result.key, winner.key);
});
test('verified destination is stable for retries but differs for new source versions', async (t) => {
  const previous = {
    bucket: process.env.S3_BUCKET,
    id: process.env.S3_ACCESS_KEY_ID,
    key: process.env.S3_SECRET_ACCESS_KEY,
  };
  process.env.S3_BUCKET = 'test';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test';
  t.after(() => {
    for (const [name, value] of Object.entries({
      S3_BUCKET: previous.bucket,
      S3_ACCESS_KEY_ID: previous.id,
      S3_SECRET_ACCESS_KEY: previous.key,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const commands: unknown[] = [];
  t.mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    commands.push(command);
    return {};
  });
  const record = file();
  const first = await finalizeObject(record, 'first');
  assert.equal(await finalizeObject(record, 'first'), first);
  assert.notEqual(await finalizeObject(record, 'second'), first);
  await assert.rejects(finalizeObject(record, undefined), /phiên bản/);
  assert(commands.every((command) => command instanceof CopyObjectCommand));
  assert(!commands.some((command) => command instanceof DeleteObjectCommand));
  assert.equal((commands[0] as CopyObjectCommand).input.CopySourceIfMatch, 'first');
});
test('atomic upload reservations count pending and verified bytes and limit active uploads', () => {
  const db = seedData();
  db.files = [];
  const record = file();
  reserveUpload(db, record);
  reserveUpload(db, { ...file(), ownerId: record.ownerId });
  reserveUpload(db, { ...file(), ownerId: record.ownerId });
  assert.throws(() => reserveUpload(db, file()), /quá nhiều tệp đang tải/);
  db.files.forEach((entry) => (entry.verified = true));
  reserveUpload(db, file());
  db.files = [{ ...record, size: 10 * 1024 ** 3, verified: true }];
  assert.throws(() => reserveUpload(db, file()), /tài khoản/);
  db.files = [{ ...record, ownerId: 'other', size: 100 * 1024 ** 3, verified: true }];
  assert.throws(() => reserveUpload(db, file()), /lớp học/);
});
test('upload reservation rate counts completed uploads too', () => {
  const db = seedData();
  db.files = Array.from({ length: 60 }, () => ({ ...file(), verified: true }));
  assert.throws(() => reserveUpload(db, file()), /quá nhiều tệp/);
});
test('request gate bounds user and process memory slots and releases idempotently', () => {
  const gate = new UploadGate(2, 1);
  const releaseA = gate.acquire('a');
  assert.throws(() => gate.acquire('a'), /đang xử lý/i);
  const releaseB = gate.acquire('b');
  assert.throws(() => gate.acquire('c'), /đang xử lý/i);
  releaseA();
  releaseA();
  const releaseC = gate.acquire('c');
  assert.throws(() => gate.acquire('d'), /đang xử lý/i);
  releaseB();
  releaseC();
  gate.acquire('a')();
});
test('upload body enforces byte and elapsed-time limits without trusting content-length', async () => {
  assert.equal(
    (
      await readUploadBody(new Request('http://local', { method: 'POST', body: 'abc' }), 3)
    ).toString(),
    'abc',
  );
  await assert.rejects(
    readUploadBody(new Request('http://local', { method: 'POST', body: 'abcd' }), 3),
    /25 MB/,
  );
  let cancelled = false;
  const body = new ReadableStream({
    start() {},
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://local', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit);
  await assert.rejects(readUploadBody(request, 3, 10), /quá thời gian/);
  assert(cancelled);
});
test('pruning recovers old failed reservations and source-version copies while preserving referenced files', () => {
  const db = seedData();
  const record = { ...file(), createdAt: '2020-01-01T00:00:00.000Z' };
  db.files = [record];
  const cutoff = Date.parse('2026-01-01T00:00:00.000Z');
  assert.deepEqual(staleUnreferencedFileIds(db, cutoff), [record.id]);
  const key = `verified/${record.key.replace('.pdf', `-${'a'.repeat(32)}.pdf`)}`;
  assert.deepEqual(
    orphanedStorageKeys(db, [{ Key: key, LastModified: new Date(record.createdAt) }], cutoff),
    [key],
  );
  record.key = key;
  record.verified = true;
  db.lessons[0].documents.push({
    id: record.id,
    name: record.name,
    size: record.size,
    mimeType: record.mimeType,
  });
  assert.deepEqual(staleUnreferencedFileIds(db, cutoff), []);
  assert.deepEqual(
    orphanedStorageKeys(db, [{ Key: key, LastModified: new Date(record.createdAt) }], cutoff),
    [],
  );
});
test('unconfigured optional storage is explicitly reported without contacting a provider', async () => {
  assert.equal(await storageStatus(), 'unconfigured');
});

test('verification never deletes a concurrently replaceable source on invalid metadata or content', async (t) => {
  const { verifyObject } = await import('../src/lib/server/storage');
  const { HeadObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { Readable } = await import('node:stream');
  const names = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const old = names.map((name) => process.env[name]);
  names.forEach((name) => (process.env[name] = 'test'));
  t.after(() =>
    names.forEach((name, index) => {
      if (old[index] === undefined) delete process.env[name];
      else process.env[name] = old[index];
    }),
  );
  const commands: unknown[] = [];
  let validMetadata = false;
  t.mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    commands.push(command);
    if (command instanceof HeadObjectCommand)
      return {
        ContentLength: validMetadata ? 10 : 20,
        ContentType: 'application/pdf',
        ETag: 'version',
      };
    if (command instanceof GetObjectCommand) {
      assert.equal(command.input.IfMatch, 'version');
      return { ETag: 'version', Body: Readable.from([Buffer.from('not a pdf!')]) };
    }
    throw new Error('Unexpected storage mutation');
  });
  await assert.rejects(verifyObject(file()), /Kích thước/);
  validMetadata = true;
  await assert.rejects(verifyObject(file()), /không đúng định dạng/);
  assert(!commands.some((command) => command instanceof DeleteObjectCommand));
});

test('configured storage probe checks bucket access and caches concurrent health requests', async (t) => {
  const names = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const old = names.map((name) => process.env[name]);
  names.forEach((name) => (process.env[name] = 'test'));
  t.after(() =>
    names.forEach((name, index) => {
      if (old[index] === undefined) delete process.env[name];
      else process.env[name] = old[index];
    }),
  );
  let calls = 0;
  t.mock.method(S3Client.prototype, 'send', async () => {
    calls++;
    throw new Error('secret provider error');
  });
  assert.deepEqual(await Promise.all([storageStatus(), storageStatus()]), [
    'unavailable',
    'unavailable',
  ]);
  assert.equal(calls, 1);
});

test('storage probe has a real deadline when a provider does not respond', async (t) => {
  const names = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const old = names.map((name) => process.env[name]);
  names.forEach((name) => (process.env[name] = 'test'));
  t.after(() =>
    names.forEach((name, index) => {
      if (old[index] === undefined) delete process.env[name];
      else process.env[name] = old[index];
    }),
  );
  const future = Date.now() + 120000;
  t.mock.method(Date, 'now', () => future);
  t.mock.method(
    S3Client.prototype,
    'send',
    async (_command: unknown, options: { abortSignal: AbortSignal }) => {
      assert(options.abortSignal, 'probe must pass its deadline to the SDK');
      return new Promise((_, reject) =>
        options.abortSignal.addEventListener(
          'abort',
          () => reject(new Error('request timed out')),
          { once: true },
        ),
      );
    },
  );
  const started = performance.now();
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    assert.equal(await storageStatus(), 'unavailable');
    assert(performance.now() - started < 4500, 'probe should finish before Docker health timeout');
  } finally {
    clearTimeout(keepAlive);
  }
});
