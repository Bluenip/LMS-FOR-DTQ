/** Conservatively identify orphaned LMS objects. Dry-run unless --apply is supplied. */
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import type { Database } from '../src/lib/types';
import { withDatabase } from '../src/lib/server/repository';
import { storage } from '../src/lib/server/storage';
import {
  managedKeyParts,
  orphanedStorageKeys,
  planClassStorageCleanup,
} from '../src/lib/storage-cleanup';

type ObjectInfo = { Key?: string; LastModified?: Date };

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 30;
  if (!Number.isInteger(days) || days < 30) throw new Error('Retention must be at least 30 days.');
  if (!process.env.S3_BUCKET)
    throw new Error('Configure an S3 bucket before auditing stored objects.');
  // JSON snapshots have an in-process mutex only; a separate script cannot coordinate
  // safely with the server. Auditing remains available in demo mode.
  if (apply && !process.env.DATABASE_URL)
    throw new Error('Applying storage cleanup requires PostgreSQL for cross-process locking.');
  const cutoff = Date.now() - days * 86400000;
  const cutoffIso = new Date(cutoff).toISOString();
  const s3 = storage();
  const objects: ObjectInfo[] = [];
  for (const prefix of ['classes/', 'verified/classes/']) {
    let token: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: process.env.S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      objects.push(...(page.Contents || []));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token)
        throw new Error('Storage listing was truncated without a continuation token.');
    } while (token);
  }
  if (!process.env.DATABASE_URL) {
    const db = await withDatabase((snapshot) => structuredClone(snapshot));
    console.log(
      JSON.stringify({
        candidates: orphanedStorageKeys(db, objects, cutoff).length,
        deleted: 0,
        retentionDays: days,
      }),
    );
    return;
  }

  const pg = new PrismaClient();
  try {
    const allKeys = new Set(objects.flatMap((object) => (object.Key ? [object.Key] : [])));
    const oldKeys = new Set(
      objects.flatMap((object) =>
        object.Key &&
        managedKeyParts(object.Key) &&
        object.LastModified &&
        object.LastModified.getTime() <= cutoff
          ? [object.Key]
          : [],
      ),
    );
    const groups = new Map<string, Map<string, string[]>>();
    const groupFor = (classId: string, id: string) => {
      let byId = groups.get(classId);
      if (!byId) groups.set(classId, (byId = new Map()));
      let keys = byId.get(id);
      if (!keys) byId.set(id, (keys = []));
      return keys;
    };
    for (const key of oldKeys) {
      const { classId, fileId } = managedKeyParts(key)!;
      groupFor(classId, fileId).push(key);
    }
    // Include old reservations even if no object was successfully uploaded.
    for (const file of await pg.storedFile.findMany({
      where: { createdAt: { lte: cutoffIso } },
      select: { classId: true, id: true },
    }))
      groupFor(file.classId, file.id);
    let candidates = 0;
    let deleted = 0;
    let removedRecords = 0;
    for (const [classId, byId] of groups) {
      const allIds = [...byId.keys()];
      for (let offset = 0; offset < allIds.length; offset += 250) {
        const ids = allIds.slice(offset, offset + 250);
        const keys = ids.flatMap((id) => byId.get(id)!);
        const result = await pg.$transaction(
          async (tx) => {
            // The same lock order as scoped application writes: global shared, then class.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(42719823)`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719825, hashtext(${`class:${classId}`}))`;
            const [files, lessons, submissions, matching] = await Promise.all([
              tx.storedFile.findMany({
                where: { classId, id: { in: ids }, createdAt: { lte: cutoffIso } },
              }),
              tx.lesson.findMany({
                where: { classId },
                select: { videoFileId: true, documents: true },
              }),
              tx.submission.findMany({
                where: { assignment: { classId } },
                select: { attachments: true },
              }),
              tx.storedFile.findMany({ where: { id: { in: ids } }, select: { id: true } }),
            ]);
            const db = { files, lessons, submissions } as unknown as Database;
            const plan = planClassStorageCleanup(
              db,
              classId,
              keys,
              allKeys,
              oldKeys,
              matching.map((file) => file.id),
              cutoff,
            );
            if (apply && plan.removedIds.length)
              await tx.storedFile.deleteMany({ where: { classId, id: { in: plan.removedIds } } });
            return { keys: plan.keys, removed: plan.removedIds.length };
          },
          { maxWait: 10000, timeout: 30000 },
        );
        candidates += result.keys.length;
        if (!apply) continue;
        removedRecords += result.removed;
        // The DB commit has removed every corresponding file id before any object is
        // deleted. A completion that copied outside the lock can no longer commit.
        // UUIDs are assigned by the server and are never reused for new reservations.
        for (let i = 0; i < result.keys.length; i += 1000) {
          const batch = result.keys.slice(i, i + 1000);
          const response = await s3.send(
            new DeleteObjectsCommand({
              Bucket: process.env.S3_BUCKET,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          if (response.Errors?.length)
            throw new Error(
              `Storage cleanup failed for ${response.Errors.length} object(s); rerun to retry.`,
            );
          deleted += batch.length;
        }
      }
    }
    console.log(JSON.stringify({ candidates, deleted, removedRecords, retentionDays: days }));
  } finally {
    await pg.$disconnect();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
