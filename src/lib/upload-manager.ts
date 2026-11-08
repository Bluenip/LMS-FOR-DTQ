'use client';
import { useSyncExternalStore } from 'react';
import { api } from './client';
import { cancelDriveUpload, uploadToDrive } from './drive-upload';
import type { DriveFile } from './types';

/**
 * Uploads live here, not in a component, so they keep running while the teacher saves the lesson,
 * switches lessons or opens another page of the app (a full reload still ends them).
 */
export type UploadPhase = 'uploading' | 'retrying' | 'done' | 'error' | 'cancelled';
export interface UploadItem {
  id: string;
  file: File;
  classId: string;
  lessonId?: string;
  assignmentId?: string;
  /** Free label of the owner (for example the assignment a submission file belongs to). */
  tag?: string;
  kind: 'video' | 'document';
  phase: UploadPhase;
  loaded: number;
  message: string;
  jobId: string;
  result?: DriveFile;
  attached: boolean;
}

let items: UploadItem[] = [];
const listeners = new Set<() => void>();
const controls = new Map<string, AbortController>();
const emit = () => {
  items = [...items];
  listeners.forEach((l) => l());
};
const patch = (id: string, change: Partial<UploadItem>) => {
  items = items.map((i) => (i.id === id ? { ...i, ...change } : i));
  listeners.forEach((l) => l());
};
const isActive = (i: UploadItem) => i.phase === 'uploading' || i.phase === 'retrying';

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (event) => {
    if (items.some(isActive)) event.preventDefault();
  });

async function attach(item: UploadItem) {
  if (!item.lessonId || !item.result || item.attached) return;
  try {
    await api(`/api/drive/files/${item.result.id}/attach`, {
      method: 'POST',
      body: JSON.stringify({ lessonId: item.lessonId }),
    });
    patch(item.id, { attached: true, message: 'Đã gắn vào bài giảng.' });
    window.dispatchEvent(new Event('lms:refresh'));
  } catch (e) {
    patch(item.id, { message: `Đã tải lên nhưng chưa gắn được vào bài: ${(e as Error).message}` });
  }
}

export function startUpload(input: {
  file: File;
  classId: string;
  lessonId?: string;
  assignmentId?: string;
  tag?: string;
  kind: 'video' | 'document';
}) {
  const id = crypto.randomUUID();
  const abort = new AbortController();
  controls.set(id, abort);
  items = [
    ...items,
    {
      ...input,
      id,
      phase: 'uploading',
      loaded: 0,
      message: 'Đang tải lên Google Drive…',
      jobId: '',
      attached: false,
    },
  ];
  emit();
  let lastPaint = 0;
  void uploadToDrive(input.file, {
    classId: input.classId,
    lessonId: input.lessonId,
    assignmentId: input.assignmentId,
    kind: input.kind,
    signal: abort.signal,
    onJob: (jobId) => patch(id, { jobId }),
    onProgress: (n, total) => {
      const now = performance.now();
      if (n >= total || now - lastPaint > 250) {
        lastPaint = now;
        patch(id, { loaded: n });
      }
    },
    onPhase: (phase, message) =>
      patch(id, { phase: phase === 'retrying' ? 'retrying' : 'uploading', message }),
  })
    .then((result) => {
      patch(id, {
        phase: 'done',
        loaded: input.file.size,
        result,
        message:
          input.kind === 'video'
            ? 'Đã tải lên. Google có thể cần vài phút để xử lý video trước khi phát được.'
            : 'Đã tải lên.',
      });
      const current = items.find((i) => i.id === id);
      if (current) void attach(current);
    })
    .catch((e) => {
      if (abort.signal.aborted) patch(id, { phase: 'cancelled', message: 'Đã hủy tải lên.' });
      else patch(id, { phase: 'error', message: (e as Error).message || 'Tải lên thất bại.' });
    });
  return id;
}

export async function cancelUpload(id: string) {
  controls.get(id)?.abort();
  const job = items.find((i) => i.id === id)?.jobId;
  if (job) await cancelDriveUpload(job);
}
export const dismissUpload = (id: string) => {
  items = items.filter((i) => i.id !== id);
  controls.delete(id);
  emit();
};

/** Called after a new lesson is saved: uploads started before it existed now belong to it. */
export function bindUploads(classId: string, lessonId: string) {
  items
    .filter((i) => i.classId === classId && !i.lessonId && i.phase !== 'cancelled')
    .forEach((i) => {
      patch(i.id, { lessonId });
      const bound = items.find((x) => x.id === i.id);
      if (bound?.phase === 'done') void attach(bound);
    });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
export function useUploads(filter: (i: UploadItem) => boolean) {
  return useSyncExternalStore(subscribe, snapshot, snapshot).filter(filter);
}
export const uploadActive = isActive;

/** Marks an upload as consumed by its owner so it is not added twice. */
export const markUploadUsed = (id: string) => patch(id, { attached: true });
