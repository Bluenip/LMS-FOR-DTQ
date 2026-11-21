import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStream } from '../src/lib/server/zip';

const stream = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(Buffer.from(p)));
      c.close();
    },
  });

test('zipStream builds a valid archive, skipping entries that cannot be opened', async () => {
  const body = zipStream([
    { name: 'An/bai 1.pptx', open: async () => stream('hello ', 'world') },
    { name: 'An/loi.pptx', open: async () => null },
    { name: 'Bình/bài 2.pdf', open: async () => stream('xin chào') },
  ]);
  const buffer = Buffer.from(await new Response(body).arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, buffer);
  // The reader is Python's zipfile (ZIP64 aware) and verifies every CRC.
  const out = execFileSync(
    'python',
    [
      '-c',
      'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;' +
        '[print(n+"="+z.read(n).decode()) for n in sorted(z.namelist())]',
      file,
    ],
    { encoding: 'utf8' },
  );
  assert.match(out, /An\/bai 1\.pptx=hello world/);
  assert.match(out, /Bình\/bài 2\.pdf=xin chào/);
  assert.doesNotMatch(out, /loi\.pptx/);
  assert.ok(readFileSync(file).length > 0);
});
