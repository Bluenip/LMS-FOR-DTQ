import type { Attachment, DriveFile } from './types';
import { api, ApiError } from './client';

/**
 * Browser side of the resumable Google Drive upload used by every upload in the app
 * (lesson videos, lesson materials and assignment attachments). The backend creates the
 * session; chunks then go straight to Drive and the byte offset is re-read from Drive on retry.
 */
const DRIVE_ID = /^[\w-]{10,120}$/;
const MAX_RETRIES = 6;
const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};
/** Browsers often leave File.type empty for DOCX/PPTX; the server validates by extension anyway. */
export function mimeFor(file: File) {
  return MIME[file.name.split('.').pop()?.toLowerCase() || ''] || file.type;
}

interface Session {
  job: DriveFile;
  uploadUrl?: string;
  offset?: number;
  chunkSize?: number;
  done?: boolean;
}
interface ChunkResult {
  status: number;
  range: string | null;
  body: string;
}
class Transient extends Error {}
export interface UploadHandlers {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  onPhase?: (phase: 'uploading' | 'retrying', message: string) => void;
  onJob?: (jobId: string) => void;
}
export interface UploadOptions extends UploadHandlers {
  classId: string;
  lessonId?: string;
  kind: 'video' | 'document';
  title?: string;
}

function putChunk(
  url: string,
  chunk: Blob,
  start: number,
  total: number,
  signal: AbortSignal | undefined,
  onBytes: (loaded: number) => void,
): Promise<ChunkResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${start + chunk.size - 1}/${total}`);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        range: xhr.getResponseHeader('Range'),
        body: xhr.responseText,
      });
    xhr.onerror = () => reject(new Transient('Mất kết nối khi tải lên.'));
    xhr.ontimeout = () => reject(new Transient('Quá thời gian chờ khi tải lên.'));
    xhr.onabort = () => reject(new DOMException('Đã hủy', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(chunk);
  });
}
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Đã hủy', 'AbortError'));
      },
      { once: true },
    );
  });
const complete = (jobId: string, driveFileId?: string) =>
  api<{ job: DriveFile }>(`/api/drive/uploads/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify(driveFileId && DRIVE_ID.test(driveFileId) ? { driveFileId } : {}),
  }).then((reply) => reply.job);

export async function uploadToDrive(file: File, options: UploadOptions): Promise<DriveFile> {
  const { signal, onProgress, onPhase, onJob } = options;
  onPhase?.('uploading', 'Đang tải lên Google Drive…');
  let session = await api<Session>('/api/drive/uploads', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      classId: options.classId,
      lessonId: options.lessonId ?? null,
      name: file.name,
      size: file.size,
      mimeType: mimeFor(file),
      kind: options.kind,
      title: options.title ?? file.name,
    }),
  });
  onJob?.(session.job.id);
  let failures = 0;
  for (;;) {
    if (session.done) return complete(session.job.id);
    let offset = session.offset ?? 0;
    const chunkSize = session.chunkSize ?? 8388608;
    let driveId = '';
    try {
      onProgress?.(offset, file.size);
      while (offset < file.size) {
        const end = Math.min(offset + chunkSize, file.size);
        const base = offset;
        const result = await putChunk(
          session.uploadUrl!,
          file.slice(offset, end),
          offset,
          file.size,
          signal,
          (n) => onProgress?.(base + n, file.size),
        );
        if (result.status === 200 || result.status === 201) {
          driveId = (JSON.parse(result.body || '{}') as { id?: string }).id || '';
          offset = file.size;
          onProgress?.(file.size, file.size);
        } else if (result.status === 308) {
          const match = /bytes=0-(\d+)/.exec(result.range || '');
          offset = match ? Number(match[1]) + 1 : end;
          onProgress?.(offset, file.size);
          failures = 0;
        } else if (result.status === 429 || result.status >= 500)
          throw new Transient('Google Drive đang bận.');
        else throw new Error('Google Drive từ chối đoạn dữ liệu. Hãy tải lại từ đầu.');
      }
      return await complete(session.job.id, driveId);
    } catch (e) {
      if (signal?.aborted) throw e;
      const transient =
        e instanceof Transient || (e instanceof ApiError && (e.status >= 500 || e.status === 429));
      if (!transient || ++failures > MAX_RETRIES) throw e;
      onPhase?.('retrying', `Mất kết nối, thử lại lần ${failures}/${MAX_RETRIES}…`);
      await wait(Math.min(30000, 1000 * 2 ** failures), signal);
      // Resume from the byte Drive reports, not from what the browser believes was sent.
      session = await api<Session>(`/api/drive/uploads/${session.job.id}/resume`, {
        method: 'POST',
        body: '{}',
        signal,
      });
      onPhase?.('uploading', 'Đang tiếp tục tải lên…');
    }
  }
}
export function cancelDriveUpload(jobId: string) {
  return api(`/api/drive/uploads/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
}

/** Drop-in replacement for the former S3 uploader: every file now goes to Google Drive. */
export async function uploadFile(
  file: File,
  classId: string,
  kind: 'assignment' | 'video' | 'document',
  handlers: UploadHandlers = {},
): Promise<Attachment> {
  const uploaded = await uploadToDrive(file, {
    ...handlers,
    classId,
    kind: kind === 'video' || mimeFor(file).startsWith('video/') ? 'video' : 'document',
  });
  return {
    id: uploaded.id,
    name: uploaded.name,
    size: uploaded.size,
    mimeType: uploaded.mimeType,
    url: uploaded.previewUrl || `/api/drive/files/${uploaded.id}/download`,
  };
}
