import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import type { StoredFile } from '@/lib/types';
import { HttpError } from './auth';
export const MAX_DOCUMENT = 25 * 1024 * 1024;
export const MAX_VIDEO = 2 * 1024 * 1024 * 1024;
const formats: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  webm: 'video/webm',
};
export function storage() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY)
    throw new HttpError(
      503,
      'Tải tệp chưa sẵn sàng. Quản trị viên cần cấu hình kho S3/R2; bạn vẫn có thể viết bài trực tiếp.',
    );
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
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
  const extension = v.name.split('.').pop()?.toLowerCase() || '';
  const mime = formats[extension];
  if (!mime || mime !== v.mimeType || (v.kind === 'video') !== mime.startsWith('video/'))
    throw new HttpError(
      400,
      'Định dạng tệp không hợp lệ. Dùng PDF, DOCX, JPG, PNG cho bài tập hoặc MP4, WebM cho video.',
    );
  if (v.size > (v.kind === 'video' ? MAX_VIDEO : MAX_DOCUMENT))
    throw new HttpError(
      413,
      v.kind === 'video' ? 'Video tối đa 2 GB.' : 'Tệp bài tập tối đa 25 MB.',
    );
  return v;
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
export async function putDocument(file: StoredFile, bytes: Buffer) {
  if (bytes.length !== file.size || !signature(bytes, file.mimeType))
    throw new HttpError(
      400,
      'Nội dung tệp không khớp định dạng đã khai báo. Vui lòng xuất lại tệp đúng định dạng.',
    );
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
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.key }));
    throw new HttpError(400, 'Kích thước hoặc định dạng tệp không khớp. Vui lòng tải lại.');
  }
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      ...(file.mimeType.startsWith('video/') ? { Range: 'bytes=0-4095' } : {}),
    }),
  );
  const bytes = Buffer.from(await result.Body!.transformToByteArray());
  if (result.ETag !== head.ETag)
    throw new HttpError(409, 'Tệp đã thay đổi trong khi xác thực. Vui lòng tải lại.');
  if (!signature(bytes, file.mimeType)) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.key }));
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
    { expiresIn: 300 },
  );
}

export async function finalizeObject(file: StoredFile, etag: string | undefined) {
  const s3 = storage();
  const finalKey = `verified/${file.key}`;
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
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.key }));
  return finalKey;
}
