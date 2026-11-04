/** Snapshot a private S3 bucket to an independent local volume. No source writes. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const hashKey = (key) => createHash('sha256').update(key).digest('hex');
const digestStream = () => {
  const hash = createHash('sha256');
  let size = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ sha256: hash.digest('hex'), size }) };
};

async function regularFile(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Not a regular file: ${path}`);
}
async function loadManifest(snapshot) {
  await regularFile(join(snapshot, 'manifest.json'));
  const data = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8'));
  if (data.format !== 'lms-object-backup-v1' || !Array.isArray(data.objects))
    throw new Error('Invalid backup manifest.');
  const keys = new Set();
  for (const item of data.objects) {
    if (
      typeof item.key !== 'string' ||
      item.file !== hashKey(item.key) ||
      !/^[0-9a-f]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      keys.has(item.key)
    )
      throw new Error('Invalid or duplicate object in manifest.');
    keys.add(item.key);
  }
  return data;
}

/** Re-read every byte; restore writes a second verified copy into a new directory. */
export async function verifyBackup(snapshot, restoreTo, incomplete = false) {
  snapshot = await realpath(snapshot);
  if (!incomplete) await regularFile(join(snapshot, 'COMPLETE'));
  if (!(await lstat(join(snapshot, 'objects'))).isDirectory())
    throw new Error('Backup objects must be in a regular directory.');
  const data = await loadManifest(snapshot);
  if (restoreTo) {
    restoreTo = resolve(restoreTo);
    await mkdir(restoreTo, { mode: 0o700 }); // Must be new; never overwrite an old restore.
    await mkdir(join(restoreTo, 'objects'), { mode: 0o700 });
  }
  for (const item of data.objects) {
    const path = join(snapshot, 'objects', item.file);
    await regularFile(path);
    const digest = digestStream();
    if (restoreTo) {
      await pipeline(
        createReadStream(path),
        digest.stream,
        createWriteStream(join(restoreTo, 'objects', item.file), { flags: 'wx', mode: 0o600 }),
      );
    } else {
      await pipeline(
        createReadStream(path),
        digest.stream,
        new Writable({
          write(_chunk, _encoding, cb) {
            cb();
          },
        }),
      );
    }
    const actual = digest.result();
    if (actual.size !== item.size || actual.sha256 !== item.sha256)
      throw new Error(`Checksum mismatch for object ${item.file}`);
  }
  if (restoreTo) {
    await writeFile(join(restoreTo, 'manifest.json'), JSON.stringify(data, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(join(restoreTo, 'COMPLETE'), '', { flag: 'wx', mode: 0o600 });
  }
  return data.objects.length;
}

export async function backupObjects(client, bucket, parent) {
  parent = await realpath(parent);
  if (!(await lstat(parent)).isDirectory())
    throw new Error('Backup destination must be a directory.');
  const snapshot = join(
    parent,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
  );
  await mkdir(snapshot, { mode: 0o700 });
  await mkdir(join(snapshot, 'objects'), { mode: 0o700 });
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents || []) {
      if (!object.Key || !object.ETag || !Number.isSafeInteger(object.Size))
        throw new Error('Source listing omitted key, ETag or size.');
      const key = object.Key;
      const file = hashKey(key);
      const source = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: object.ETag }),
      );
      if (!source.Body) throw new Error(`Source object ${file} has no body.`);
      const digest = digestStream();
      await pipeline(
        source.Body,
        digest.stream,
        createWriteStream(join(snapshot, 'objects', file), { flags: 'wx', mode: 0o600 }),
      );
      const { sha256, size } = digest.result();
      if (size !== object.Size) throw new Error(`Source object ${file} changed while backing up.`);
      objects.push({
        key,
        file,
        size,
        sha256,
        etag: object.ETag,
        contentType: source.ContentType,
        contentDisposition: source.ContentDisposition,
        contentEncoding: source.ContentEncoding,
        cacheControl: source.CacheControl,
        metadata: source.Metadata,
      });
    }
    if (page.IsTruncated && !page.NextContinuationToken)
      throw new Error('Incomplete source listing.');
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  const manifest = { format: 'lms-object-backup-v1', createdAt: new Date().toISOString(), objects };
  await writeFile(join(snapshot, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await verifyBackup(snapshot, undefined, true);
  await writeFile(join(snapshot, 'COMPLETE'), '', { flag: 'wx', mode: 0o600 });
  return { snapshot, count: objects.length };
}

/** Restore only into an empty, separately named bucket, and read every object back. */
export async function restoreBucket(client, bucket, snapshot) {
  snapshot = await realpath(snapshot);
  await verifyBackup(snapshot);
  const data = await loadManifest(snapshot);
  const existing = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if (existing.IsTruncated || existing.Contents?.length)
    throw new Error('Restore bucket must be empty.');
  for (const item of data.objects) {
    const path = join(snapshot, 'objects', item.file);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: item.key,
        Body: createReadStream(path),
        ContentLength: item.size,
        ContentType: item.contentType,
        ContentDisposition: item.contentDisposition,
        ContentEncoding: item.contentEncoding,
        CacheControl: item.cacheControl,
        Metadata: item.metadata,
        IfNoneMatch: '*',
      }),
    );
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.key }));
    if (!downloaded.Body) throw new Error(`Restored object ${item.file} has no body.`);
    const digest = digestStream();
    await pipeline(
      downloaded.Body,
      digest.stream,
      new Writable({
        write(_chunk, _encoding, cb) {
          cb();
        },
      }),
    );
    const actual = digest.result();
    if (actual.size !== item.size || actual.sha256 !== item.sha256)
      throw new Error(`Restored object ${item.file} failed verification.`);
  }
  return data.objects.length;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args[1] && args.length === 2) {
    console.log(JSON.stringify({ verifiedObjects: await verifyBackup(args[1]) }));
    return;
  }
  if (args[0] === '--restore-local' && args[1] && args[2] && args.length === 3) {
    console.log(JSON.stringify({ restoredObjects: await verifyBackup(args[1], args[2]) }));
    return;
  }
  if (args[0] === '--restore-bucket' && args[1] && args.length === 2) {
    const {
      S3_BUCKET: source,
      LMS_RESTORE_BUCKET: bucket,
      LMS_RESTORE_ENDPOINT: endpoint,
      LMS_RESTORE_REGION: region,
      LMS_RESTORE_ACCESS_KEY_ID: accessKeyId,
      LMS_RESTORE_SECRET_ACCESS_KEY: secretAccessKey,
      LMS_RESTORE_CONFIRM_EMPTY_BUCKET: confirm,
    } = process.env;
    if (
      !source ||
      !bucket ||
      source === bucket ||
      !accessKeyId ||
      !secretAccessKey ||
      confirm !== 'yes'
    )
      throw new Error(
        'Set source S3_BUCKET, a different LMS_RESTORE_BUCKET and restore credentials; set LMS_RESTORE_CONFIRM_EMPTY_BUCKET=yes.',
      );
    const client = new S3Client({
      region: region || 'auto',
      endpoint: endpoint || undefined,
      forcePathStyle: !!endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
    });
    try {
      console.log(
        JSON.stringify({ restoredObjects: await restoreBucket(client, bucket, args[1]) }),
      );
    } finally {
      client.destroy();
    }
    return;
  }
  if (args.length)
    throw new Error(
      'Usage: backup-objects.mjs [--verify SNAPSHOT | --restore-local SNAPSHOT NEW_DIRECTORY | --restore-bucket SNAPSHOT]',
    );
  const {
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
    LMS_OBJECT_BACKUP_DIR: destination,
    LMS_OBJECT_BACKUP_MOUNT: mount,
  } = process.env;
  if (!bucket || !accessKeyId || !secretAccessKey || !destination || !mount)
    throw new Error(
      'Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, LMS_OBJECT_BACKUP_DIR and LMS_OBJECT_BACKUP_MOUNT.',
    );
  const realMount = await realpath(mount);
  const realDestination = await realpath(destination);
  if (
    realMount === '/' ||
    spawnSync('mountpoint', ['-q', '--', realMount]).status !== 0 ||
    (realDestination !== realMount && !realDestination.startsWith(`${realMount}/`))
  )
    throw new Error('Destination must be on the specified mounted backup volume.');
  const client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2,
  });
  try {
    console.log(JSON.stringify(await backupObjects(client, bucket, destination)));
  } finally {
    client.destroy();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
