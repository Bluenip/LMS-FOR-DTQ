'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Check,
  Cloud,
  ExternalLink,
  Eye,
  Globe,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type { DriveFile, DriveStatus } from '@/lib/types';
import { api, ApiError } from '@/lib/client';
import { cancelDriveUpload, uploadToDrive } from '@/lib/drive-upload';
import { Badge, Button, Dialog, Empty, Field, Search } from './ui';
import { useLms } from './lms-provider';

const DRIVE_ID = /^[\w-]{10,120}$/;
const formatSize = (bytes: number) =>
  bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(2)} GB`
    : `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;

// ---------------------------------------------------------------------------
// Connection status / admin connect
// ---------------------------------------------------------------------------
let lastStatus: DriveStatus | null = null; // avoids a skeleton flash every time an editor opens
export function useDriveStatus() {
  const [status, setStatus] = useState<DriveStatus | null>(lastStatus);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      lastStatus = await api<DriveStatus>('/api/drive/status', { cache: 'no-store' });
      setStatus(lastStatus);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, error, refresh };
}

const CONNECT_MESSAGES: Record<string, [string, 'success' | 'warning']> = {
  connected: ['Đã kết nối Google Drive.', 'success'],
  denied: ['Bạn đã từ chối cấp quyền cho Google Drive.', 'warning'],
  state: ['Phiên xác thực không hợp lệ hoặc đã hết hạn. Hãy thử kết nối lại.', 'warning'],
  scope: ['Google chưa cấp quyền drive.file. Hãy đồng ý đầy đủ khi kết nối.', 'warning'],
  norefresh: [
    'Google không trả về quyền truy cập lâu dài. Hãy thu hồi quyền của ứng dụng trong tài khoản Google rồi kết nối lại.',
    'warning',
  ],
  'different-account': [
    'Đang kết nối một tài khoản Google khác. Hãy ngắt kết nối hiện tại trước khi đổi tài khoản.',
    'warning',
  ],
  error: ['Không kết nối được Google Drive. Kiểm tra cấu hình OAuth rồi thử lại.', 'warning'],
  login: ['Vui lòng đăng nhập rồi kết nối lại.', 'warning'],
};

export function GoogleDriveConnect() {
  const { status, error, refresh } = useDriveStatus();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const outcome = CONNECT_MESSAGES[params.get('drive') || ''];
  async function disconnect() {
    if (
      !window.confirm(
        'Ngắt kết nối Google Drive? Giáo viên sẽ không tải thêm video được cho đến khi kết nối lại.',
      )
    )
      return;
    setBusy(true);
    try {
      const reply = await api<{ message: string }>('/api/drive/disconnect', {
        method: 'POST',
        body: '{}',
      });
      setMessage(reply.message);
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cleanup() {
    setBusy(true);
    try {
      const r = await api<{ deletedFromDrive: number; removedRecords: number; failed: number }>(
        '/api/drive/maintenance',
        { method: 'POST', body: '{}' },
      );
      setMessage(
        `Đã dọn: xóa ${r.deletedFromDrive} tệp khỏi Drive, ${r.removedRecords} bản ghi${r.failed ? `, ${r.failed} tệp lỗi (sẽ thử lại)` : ''}.`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel drive-connect" aria-labelledby="drive-connect-title">
      <div className="toolbar">
        <h2 id="drive-connect-title">
          <Cloud size={18} /> Google Drive
        </h2>
        {status && (
          <Badge
            tone={status.connected ? 'success' : status.status === 'REVOKED' ? 'danger' : 'neutral'}
          >
            {status.connected
              ? 'Đã kết nối'
              : status.status === 'REVOKED'
                ? 'Đã bị thu hồi'
                : 'Chưa kết nối'}
          </Badge>
        )}
      </div>
      {outcome && <p className={`notice ${outcome[1]}`}>{outcome[0]}</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {status && !status.configured && (
        <p className="notice warning">
          Máy chủ chưa có GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET hoặc DRIVE_ENCRYPTION_KEY. Xem
          docs/GOOGLE_DRIVE.md.
        </p>
      )}
      {status?.connected && (
        <p className="small">
          Tài khoản: <strong>{status.email}</strong>. Tệp tải lên được lưu trong thư mục “LMS Đệ Tử
          Quy” trên Drive; thư mục được tạo ở lượt tải lên đầu tiên.
        </p>
      )}
      <p className="small muted">
        Ứng dụng chỉ xin quyền <code>drive.file</code>: chỉ thấy các tệp do chính hệ thống này tạo,
        không đọc phần Drive còn lại. Chỉ video bài giảng được đặt chế độ “bất kỳ ai có liên kết có
        thể xem” để phát trong bài giảng; học liệu và bài làm của học viên luôn riêng tư.
      </p>
      <div className="row">
        {/* Full-page navigation: the OAuth redirect and state cookie need a real request. */}
        <a className="button primary" href="/api/drive/connect" aria-disabled={!status?.configured}>
          <Cloud size={16} /> {status?.connected ? 'Kết nối lại' : 'Kết nối Google Drive'}
        </a>
        {status?.connected && (
          <Button variant="secondary" disabled={busy} onClick={() => void cleanup()}>
            Dọn tệp mồ côi
          </Button>
        )}
        {(status?.connected || status?.status === 'REVOKED') && (
          <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
            Ngắt kết nối
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
/** Google Drive Preview player (https://drive.google.com/file/d/{id}/preview). */
export function DriveVideoPlayer({ fileId, title }: { fileId?: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [fileId]);
  if (!fileId || !DRIVE_ID.test(fileId))
    return (
      <div className="video-placeholder">
        <Video size={40} strokeWidth={1.3} />
        <h3>Chưa có video</h3>
        <p>Video chưa được gắn vào bài giảng này.</p>
      </div>
    );
  return (
    <div className="drive-player">
      <iframe
        key={fileId}
        src={`https://drive.google.com/file/d/${fileId}/preview`}
        title={title}
        allow="autoplay; fullscreen"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className="drive-player-overlay" role="status">
          <div className="skeleton block" />
          <span className="small">Đang tải trình phát…</span>
        </div>
      )}
      {slow && (
        <p className="drive-player-hint small">
          Video không phát? Google có thể đang xử lý video mới tải lên, trình duyệt chặn cookie của
          bên thứ ba, hoặc bạn chưa có quyền xem.{' '}
          <a
            href={`https://drive.google.com/file/d/${fileId}/view`}
            target="_blank"
            rel="noreferrer"
          >
            Mở trong Google Drive <ExternalLink size={12} />
          </a>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload (browser → Drive resumable session created by the backend)
// ---------------------------------------------------------------------------
type Phase = 'idle' | 'uploading' | 'retrying' | 'done' | 'error' | 'cancelled';

export function UploadProgress({
  name,
  loaded,
  total,
  phase,
  message,
  onCancel,
  onRetry,
}: {
  name: string;
  loaded: number;
  total: number;
  phase: Phase;
  message: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const percent = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
  return (
    <div className="upload-progress" role="status" aria-live="polite">
      <div className="progress-caption">
        <strong>{name}</strong>
        <span>
          {formatSize(loaded)} / {formatSize(total)} · {percent}%
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className={phase === 'error' ? 'error small' : 'small muted'}>{message}</p>
      <div className="row">
        {(phase === 'uploading' || phase === 'retrying') && (
          <Button variant="secondary" onClick={onCancel}>
            <X size={15} /> Hủy tải lên
          </Button>
        )}
        {phase === 'error' && (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={15} /> Thử lại / tiếp tục
          </Button>
        )}
      </div>
    </div>
  );
}

export function VideoUploader({
  classId,
  lessonId,
  kind = 'video',
  accept = 'video/mp4,video/webm,video/quicktime',
  disabled,
  onUploaded,
}: {
  classId: string;
  lessonId?: string;
  kind?: 'video' | 'document';
  accept?: string;
  disabled?: boolean;
  onUploaded: (file: DriveFile) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(0);
  const control = useRef<AbortController | null>(null);
  const job = useRef<string>('');
  const lastPaint = useRef(0);
  useEffect(() => () => control.current?.abort(), []);
  // Leaving the page mid-upload loses the in-memory file handle; warn but keep the server session.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'retrying') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  async function start(selected: File) {
    const abort = new AbortController();
    control.current = abort;
    setFile(selected);
    setLoaded(0);
    setPhase('uploading');
    try {
      const uploaded = await uploadToDrive(selected, {
        classId,
        lessonId,
        kind,
        signal: abort.signal,
        onJob: (id) => (job.current = id),
        onProgress: (n, total) => {
          // XHR fires progress many times a second; repainting every event makes the page stutter.
          const nowMs = performance.now();
          if (n >= total || nowMs - lastPaint.current > 150) {
            lastPaint.current = nowMs;
            setLoaded(n);
          }
        },
        onPhase: (next, text) => {
          setPhase(next);
          setMessage(text);
        },
      });
      setPhase('done');
      setLoaded(selected.size);
      setMessage(
        kind === 'video'
          ? 'Đã tải lên. Google có thể cần vài phút để xử lý video trước khi phát được.'
          : 'Đã tải lên.',
      );
      onUploaded(uploaded);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setPhase('cancelled');
        setMessage('Đã hủy tải lên.');
      } else {
        setPhase('error');
        setMessage(
          e instanceof ApiError && e.status === 410
            ? 'Phiên tải lên đã hết hạn. Chọn lại tệp để bắt đầu lại.'
            : (e as Error).message || 'Tải lên thất bại.',
        );
      }
    }
  }
  async function cancel() {
    control.current?.abort();
    if (job.current) await cancelDriveUpload(job.current);
  }
  const active = phase === 'uploading' || phase === 'retrying';
  return (
    <div className="stack">
      <Field
        label={kind === 'video' ? 'Chọn video MP4, WebM hoặc MOV' : 'Chọn tài liệu'}
        hint={
          kind === 'video'
            ? 'Tối đa 2 GB. Tải trực tiếp lên Google Drive, có thể tiếp tục khi mất kết nối.'
            : 'Tối đa 25 MB.'
        }
      >
        <input
          type="file"
          accept={accept}
          disabled={disabled || active}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = '';
            if (selected) void start(selected);
          }}
        />
      </Field>
      {file && phase !== 'idle' && (
        <UploadProgress
          name={file.name}
          loaded={loaded}
          total={file.size}
          phase={phase}
          message={message}
          onCancel={() => void cancel()}
          onRetry={() => void start(file)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library: list / search / rename / share / delete / pick
// ---------------------------------------------------------------------------
export function VideoManagement({
  classId,
  selectedDriveFileId,
  onSelect,
  refreshKey = 0,
}: {
  classId: string;
  selectedDriveFileId?: string;
  onSelect?: (file: DriveFile) => void;
  refreshKey?: number;
}) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rename, setRename] = useState<DriveFile | null>(null);
  const [name, setName] = useState('');
  const [watch, setWatch] = useState<DriveFile | null>(null);
  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ classId, kind: 'video', ...(q ? { q } : {}) });
      setFiles(
        (await api<{ files: DriveFile[] }>(`/api/drive/files?${query}`, { cache: 'no-store' }))
          .files,
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [classId, q]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q, refreshKey]);
  async function act(fn: () => Promise<unknown>, done: string) {
    setError('');
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const stem = (value: string) => value.slice(0, value.lastIndexOf('.'));
  return (
    <div className="stack video-management">
      <Search value={q} onChange={setQ} placeholder="Tìm video đã tải lên…" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice small" role="status">
          {notice}
        </p>
      )}
      {!files ? (
        <div className="skeleton row" role="status" aria-label="Đang tải video" />
      ) : files.length === 0 ? (
        <Empty
          title="Chưa có video"
          description="Video đã tải lên Google Drive của lớp này sẽ hiện ở đây."
        />
      ) : (
        <ul className="drive-list">
          {files.map((f) => (
            <li key={f.id} className={f.driveFileId === selectedDriveFileId ? 'selected' : ''}>
              <div>
                <strong>{f.title || f.name}</strong>
                <small className="muted">
                  {f.name} · {formatSize(f.size)} {f.lessonId ? '· đang dùng trong bài giảng' : ''}
                </small>
              </div>
              <div className="inline-actions">
                <Badge tone={f.shared ? 'success' : 'warning'}>
                  {f.shared ? (
                    <>
                      <Globe size={12} /> Có liên kết
                    </>
                  ) : (
                    <>
                      <Lock size={12} /> Riêng tư
                    </>
                  )}
                </Badge>
                {onSelect && (
                  <Button
                    variant={f.driveFileId === selectedDriveFileId ? 'secondary' : 'primary'}
                    onClick={() => onSelect(f)}
                  >
                    <Check size={14} />{' '}
                    {f.driveFileId === selectedDriveFileId ? 'Đang chọn' : 'Chọn'}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setWatch(f)}>
                  Xem
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRename(f);
                    setName(stem(f.name));
                  }}
                >
                  <Pencil size={14} /> Đổi tên
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act(
                      () =>
                        api(`/api/drive/files/${f.id}/sharing`, {
                          method: 'POST',
                          body: JSON.stringify({ public: !f.shared }),
                        }),
                      f.shared ? 'Đã thu hồi liên kết xem.' : 'Đã bật chia sẻ bằng liên kết.',
                    )
                  }
                >
                  {f.shared ? 'Thu hồi chia sẻ' : 'Bật chia sẻ'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Xóa “${f.name}” khỏi Google Drive? Không thể hoàn tác.`))
                      void act(
                        () => api(`/api/drive/files/${f.id}`, { method: 'DELETE' }),
                        'Đã xóa video.',
                      );
                  }}
                >
                  <Trash2 size={14} /> Xóa
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!rename} title="Đổi tên video" onClose={() => setRename(null)}>
        {rename && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const extension = rename.name.slice(rename.name.lastIndexOf('.'));
              void act(
                () =>
                  api(`/api/drive/files/${rename.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      name: `${name.trim()}${extension}`,
                      title: name.trim(),
                    }),
                  }),
                'Đã đổi tên video.',
              ).then(() => setRename(null));
            }}
          >
            <Field
              label="Tên mới"
              hint={`Đuôi tệp giữ nguyên (${rename.name.slice(rename.name.lastIndexOf('.'))}).`}
            >
              <input
                value={name}
                maxLength={190}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="dialog-footer">
              <Button variant="secondary" onClick={() => setRename(null)}>
                Đóng
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Lưu
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!watch}
        title={watch?.title || 'Xem video'}
        onClose={() => setWatch(null)}
        wide
      >
        {watch && (
          <div className="video-frame">
            <DriveVideoPlayer fileId={watch.driveFileId} title={watch.title || watch.name} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson editor integration
// ---------------------------------------------------------------------------
export function CourseLessonVideo({
  classId,
  lessonId,
  driveFileId,
  title,
  onChange,
}: {
  classId: string;
  lessonId?: string;
  driveFileId: string;
  title: string;
  onChange: (driveFileId: string) => void;
}) {
  const { status, error } = useDriveStatus();
  const { state } = useLms();
  const [refreshKey, setRefreshKey] = useState(0);
  if (error) return <p className="error">{error}</p>;
  if (!status)
    return <div className="skeleton row" role="status" aria-label="Đang kiểm tra Google Drive" />;
  if (!status.configured || !status.connected)
    return (
      <p className="notice warning">
        Google Drive chưa sẵn sàng.{' '}
        {state.user.isAdmin ? (
          <a href="/admin">Kết nối trong trang Quản trị</a>
        ) : (
          'Hãy nhờ quản trị viên kết nối Google Drive.'
        )}
      </p>
    );
  return (
    <div className="stack">
      <VideoUploader
        classId={classId}
        lessonId={lessonId}
        onUploaded={(f) => {
          if (f.driveFileId) onChange(f.driveFileId);
          setRefreshKey((k) => k + 1);
        }}
      />
      {driveFileId && (
        <div className="video-frame">
          <DriveVideoPlayer fileId={driveFileId} title={title || 'Video bài giảng'} />
        </div>
      )}
      <details>
        <summary>
          <Upload size={14} /> Chọn từ video đã tải lên
        </summary>
        <VideoManagement
          classId={classId}
          selectedDriveFileId={driveFileId}
          refreshKey={refreshKey}
          onSelect={(f) => f.driveFileId && onChange(f.driveFileId)}
        />
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewing private files (assignment attachments, lesson materials) in the page
// ---------------------------------------------------------------------------
const VIEWABLE = /^(video\/|image\/|application\/pdf$)/;
const isDriveFile = (file: { url?: string }) => !!file.url?.startsWith('/api/drive/files/');

/** "Xem" button + dialog for files stored in Drive that a browser can render (video, PDF, image). */
export function AttachmentViewer({
  file,
}: {
  file: { id: string; name: string; mimeType: string; url?: string };
}) {
  const [open, setOpen] = useState(false);
  if (!isDriveFile(file) || !VIEWABLE.test(file.mimeType)) return null;
  const src = `/api/drive/files/${file.id}/view`;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label={`Xem ${file.name}`}>
        <Eye size={15} /> Xem
      </Button>
      <Dialog open={open} title={file.name} onClose={() => setOpen(false)} wide>
        {open &&
          (file.mimeType.startsWith('video/') ? (
            <div className="video-frame">
              <video controls autoPlay preload="metadata" src={src} />
            </div>
          ) : file.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="attachment-image" src={src} alt={file.name} />
          ) : (
            <iframe className="attachment-pdf" src={src} title={file.name} />
          ))}
      </Dialog>
    </>
  );
}
