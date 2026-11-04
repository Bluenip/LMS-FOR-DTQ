import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { backupObjects, restoreBucket, verifyBackup } from '../scripts/backup-objects.mjs';

test('object backup verifies every byte, restores independently, and detects damage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lms-object-test-'));
  try {
    const content = Buffer.alloc(2 * 1024 * 1024, 0x42);
    const commands = [];
    const client = {
      async send(command) {
        commands.push(command.constructor.name);
        if (command.constructor.name === 'ListObjectsV2Command')
          return {
            Contents: [{ Key: 'classes/odd/../name', Size: content.length, ETag: '"etag"' }],
          };
        assert.equal(command.constructor.name, 'GetObjectCommand');
        assert.equal(command.input.IfMatch, '"etag"');
        return { Body: Readable.from(content), ContentType: 'application/pdf' };
      },
    };
    const { snapshot, count } = await backupObjects(client, 'test', dir);
    assert.equal(count, 1);
    assert.deepEqual(commands, ['ListObjectsV2Command', 'GetObjectCommand']);
    const restored = join(dir, 'restored');
    assert.equal(await verifyBackup(snapshot, restored), 1);
    await assert.rejects(verifyBackup(snapshot, restored), /EEXIST/);
    const manifest = JSON.parse(await readFile(join(restored, 'manifest.json'), 'utf8'));
    assert.deepEqual(await readFile(join(restored, 'objects', manifest.objects[0].file)), content);
    let uploaded;
    const target = {
      async send(command) {
        if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [] };
        if (command.constructor.name === 'PutObjectCommand') {
          assert.equal(command.input.IfNoneMatch, '*');
          assert.equal(command.input.ContentLength, content.length);
          const chunks = [];
          for await (const chunk of command.input.Body) chunks.push(chunk);
          uploaded = Buffer.concat(chunks);
          return {};
        }
        assert.equal(command.constructor.name, 'GetObjectCommand');
        return { Body: Readable.from(uploaded) };
      },
    };
    assert.equal(await restoreBucket(target, 'independent', snapshot), 1);
    assert.deepEqual(uploaded, content);
    await assert.rejects(
      restoreBucket(
        { send: async () => ({ Contents: [{ Key: 'existing' }] }) },
        'independent',
        snapshot,
      ),
      /bucket must be empty/,
    );
    await writeFile(join(snapshot, 'objects', manifest.objects[0].file), 'corrupted');
    await assert.rejects(verifyBackup(snapshot), /Checksum mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
