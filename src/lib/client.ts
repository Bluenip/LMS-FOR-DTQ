import type { Attachment } from './types';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });
  const data = await res
    .json()
    .catch(() => ({ error: 'Máy chủ không phản hồi. Vui lòng thử lại.' }));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Không thể thực hiện yêu cầu.');
  return data as T;
}
export async function uploadFile(
  file: File,
  classId: string,
  kind: 'assignment' | 'video' | 'document',
): Promise<Attachment> {
  if (kind === 'video') {
    const p = await api<{ fileId: string; uploadUrl: string }>('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify({
        classId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        kind: 'video',
      }),
    });
    const response = await fetch(p.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!response.ok) throw new Error('Không thể tải video lên kho lưu trữ.');
    return api<Attachment>('/api/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ fileId: p.fileId }),
    });
  }
  const form = new FormData();
  form.set('file', file);
  form.set('classId', classId);
  form.set('kind', 'document');
  return api<Attachment>('/api/uploads', { method: 'POST', body: form });
}
export function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}
export function initials(name: string) {
  return name
    .split(' ')
    .slice(-2)
    .map((v) => v[0])
    .join('');
}
export function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
export function youtubeId(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).match(/^[\w-]{11}$/)?.[0];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname))
      return (u.searchParams.get('v') || u.pathname.split('/').pop() || '').match(
        /^[\w-]{11}$/,
      )?.[0];
  } catch {}
  return undefined;
}
