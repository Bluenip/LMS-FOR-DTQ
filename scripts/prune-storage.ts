/** Conservatively identify orphaned LMS objects. Dry-run unless --apply is supplied. */
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { withDatabase } from '../src/lib/server/repository';
import { storage } from '../src/lib/server/storage';
import { orphanedStorageKeys } from '../src/lib/storage-cleanup';

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 30;
  if (!Number.isInteger(days) || days < 30) throw new Error('Retention must be at least 30 days.');
  if (!process.env.S3_BUCKET)
    throw new Error('Configure an S3 bucket before auditing stored objects.');
  const cutoff = Date.now() - days * 86400000;
  const s3 = storage();
  const result = await withDatabase(async (db) => {
    const candidates: string[] = [];
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
        candidates.push(...orphanedStorageKeys(db, page.Contents || [], cutoff));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !token)
          throw new Error('Storage listing was truncated without a continuation token.');
      } while (token);
    }
    if (apply) {
      for (const key of candidates)
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      const removed = new Set(candidates);
      db.files = db.files.filter((file) => !removed.has(file.key));
    }
    return {
      candidates: candidates.length,
      deleted: apply ? candidates.length : 0,
      retentionDays: days,
    };
  }, apply);
  console.log(JSON.stringify(result));
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
