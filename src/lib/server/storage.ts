import { createHash, randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import type { StoredFile } from '@/lib/types';
import { expectedMime, uploadMime } from '@/lib/file-mime';
import { HttpError } from './auth';
export const MAX_DOCUMENT = 25 * 1024 * 1024;
export const MAX_VIDEO = 2 * 1024 * 1024 * 1024;
let storageClient: S3Client | undefined;
let copyClient: S3Client | undefined;
function assertStorageConfigured() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY)
    throw new HttpError(
      503,
      'Tải tệp chưa sẵn sàng. Quản trị viên cần cấu hình kho S3/R2; bạn vẫn có thể viết bài trực tiếp.',
    );
}
function createClient(requestTimeout: number) {
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 10000, requestTimeout },
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}
export function storage() {
  assertStorageConfigured();
  return (storageClient ??= createClient(60000));
}
/** Server-side copies of large videos may stay silent for minutes before responding. */
function copyStorage() {
  assertStorageConfigured();
  return (copyClient ??= createClient(15 * 60 * 1000));
}
export function validateUpload(raw: unknown) {
  const v = z
    .object({
      classId: z.string().min(1),
      name: z.string().min(1).max(255),
      size: z.number().int().positive(),
      mimeType: z.string(),
      kind: z.enum(['document', 'video']).default('document'),
    })
    .parse(raw);
  const mime = expectedMime(v.name);
  const normalizedMime = uploadMime(v.name, v.mimeType);
  if (!mime || mime !== normalizedMime || (v.kind === 'video') !== mime.startsWith('video/'))
    throw new HttpError(
      400,
      'Định dạng tệp không hợp lệ. Dùng PDF, DOCX, JPG, PNG cho bài tập hoặc MP4, WebM cho video.',
    );
  if (v.size > (v.kind === 'video' ? MAX_VIDEO : MAX_DOCUMENT))
    throw new HttpError(
      413,
      v.kind === 'video' ? 'Video tối đa 2 GB.' : 'Tệp bài tập tối đa 25 MB.',
    );
  return { ...v, mimeType: normalizedMime };
}
export function fileRecord(ownerId: string, v: ReturnType<typeof validateUpload>): StoredFile {
  const id = randomUUID();
  return {
    id,
    ownerId,
    classId: v.classId,
    key: `classes/${v.classId}/${ownerId}/${id}.${v.name.split('.').pop()?.toLowerCase()}`,
    name: v.name,
    size: v.size,
    mimeType: v.mimeType,
    verified: false,
    createdAt: new Date().toISOString(),
  };
}
export async function presign(file: StoredFile) {
  return getSignedUrl(
    storage(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      ContentType: file.mimeType,
      ContentLength: file.size,
    }),
    { expiresIn: 600 },
  );
}
function signature(data: Buffer, mime: string) {
  switch (mime) {
    case 'application/pdf':
      return data.subarray(0, 5).toString() === '%PDF-';
    case 'image/jpeg':
      return data[0] === 255 && data[1] === 216 && data[2] === 255;
    case 'image/png':
      return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return (
        data[0] === 80 &&
        data[1] === 75 &&
        data.includes(Buffer.from('[Content_Types].xml')) &&
        data.includes(Buffer.from('word/document.xml'))
      );
    case 'video/mp4':
      return data.subarray(4, 8).toString() === 'ftyp';
    case 'video/webm':
      return data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
    default:
      return false;
  }
}
export function validateDocument(file: StoredFile, bytes: Buffer) {
  if (bytes.length !== file.size || !signature(bytes, file.mimeType))
    throw new HttpError(
      400,
      'Nội dung tệp không khớp định dạng đã khai báo. Vui lòng xuất lại tệp đúng định dạng.',
    );
}
export async function putDocument(file: StoredFile, bytes: Buffer) {
  validateDocument(file, bytes);
  await storage().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      Body: bytes,
      ContentType: file.mimeType,
      ContentLength: bytes.length,
    }),
  );
}
export async function verifyObject(file: StoredFile) {
  const s3 = storage();
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.key }),
  );
  if (head.ContentLength !== file.size || head.ContentType !== file.mimeType) {
    throw new HttpError(400, 'Kích thước hoặc định dạng tệp không khớp. Vui lòng tải lại.');
  }
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      IfMatch: head.ETag,
      ...(file.mimeType.startsWith('video/') ? { Range: 'bytes=0-4095' } : {}),
    }),
  );
  if (!head.ETag || !result.Body)
    throw new HttpError(502, 'Kho tệp không trả về thông tin xác thực.');
  const limit = file.mimeType.startsWith('video/') ? 4096 : MAX_DOCUMENT;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, 'Nội dung tệp vượt quá giới hạn.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, length);
  if (result.ETag !== head.ETag)
    throw new HttpError(409, 'Tệp đã thay đổi trong khi xác thực. Vui lòng tải lại.');
  if (!signature(bytes, file.mimeType)) {
    throw new HttpError(400, 'Tệp không đúng định dạng thực tế.');
  }
  return result.ETag;
}
export async function downloadUrl(file: StoredFile) {
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      ResponseContentType: file.mimeType,
      ResponseContentDisposition: `${file.mimeType.startsWith('video/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    }),
    // Media players issue range requests against the signed URL for the whole
    // viewing session, so videos get a longer lifetime than documents.
    { expiresIn: file.mimeType.startsWith('video/') ? 4 * 3600 : 300 },
  );
}

export async function finalizeObject(file: StoredFile, etag: string | undefined) {
  const s3 = copyStorage();
  if (!etag) throw new HttpError(502, 'Kho tệp không trả về phiên bản tệp.');
  // Each validated source version has an immutable destination. A concurrent re-upload
  // cannot overwrite a version already committed by another completion request.
  const version = createHash('sha256').update(etag).digest('hex').slice(0, 32);
  const finalKey = `verified/${file.key.replace(/(\.[^.]+)$/, `-${version}$1`)}`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: finalKey,
      CopySource: `${process.env.S3_BUCKET}/${file.key.split('/').map(encodeURIComponent).join('/')}`,
      ContentType: file.mimeType,
      MetadataDirective: 'REPLACE',
      CopySourceIfMatch: etag,
    }),
  );
  return finalKey;
}

export async function deleteObject(key: string) {
  await storage().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

/** Never remove the retriable source until the database has durably committed. */
export async function completeStoredUpload(
  file: StoredFile,
  commit: (key: string) => Promise<StoredFile>,
  operations = { verifyObject, finalizeObject, deleteObject },
) {
  if (file.verified) return file;
  const etag = await operations.verifyObject(file);
  const key = await operations.finalizeObject(file, etag);
  const committed = await commit(key);
  if (!committed.verified) throw new Error('File completion did not commit');
  // A failed cleanup must not turn a successful commit into a failed upload.
  // The pruning job removes leftover source/copy objects after the retention period.
  await operations.deleteObject(file.key).catch(() => {});
  return committed;
}

type StorageStatus = 'unconfigured' | 'reachable' | 'unavailable';
let storageProbe: { expires: number; result: Promise<StorageStatus> } | undefined;
/** Connectivity/credentials probe only; browser PUT/GET and CORS still need a setup test. */
export async function storageStatus(): Promise<StorageStatus> {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY)
    return 'unconfigured';
  if (storageProbe && storageProbe.expires > Date.now()) return storageProbe.result;
  const result = (async (): Promise<StorageStatus> => {
    const s3 = storage();
    try {
      await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(3000),
      });
      return 'reachable';
    } catch {
      return 'unavailable';
    }
  })();
  storageProbe = { expires: Date.now() + 60000, result };
  return result;
}
