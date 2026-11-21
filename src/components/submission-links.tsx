'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ExternalLink, Eye, Link2, MonitorPlay, Plus, X } from 'lucide-react';
import { api } from '@/lib/client';
import {
  LINK_KIND_LABEL,
  MAX_SUBMISSION_LINKS,
  canvaEmbedUrl,
  isCanvaEditLink,
  isCanvaShortLink,
  isWebLink,
  linkKind,
  parseSubmissionLinks,
} from '@/lib/submission-links';
import { Badge, Button, Dialog } from './ui';

/**
 * Editor for the evidence links of a submission; `value` holds one link per line. `max` caps the
 * rows (fewer when links were already handed in) and `hint` replaces the default limit note.
 */
export function SubmissionLinksEditor({
  value,
  disabled,
  onChange,
  max = MAX_SUBMISSION_LINKS,
  hint,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  max?: number;
  hint?: string;
}) {
  // Keep empty rows while editing; only the saved value drops them.
  const rows = value.split('\n');
  const [added, setAdded] = useState(-1);
  const set = (next: string[]) => onChange(next.join('\n'));
  const filled = rows.map((r) => r.trim()).filter(Boolean);
  const hasCanva = filled.some((l) => linkKind(l) === 'canva');
  const canvaEdit = filled.some(isCanvaEditLink);
  const invalid = filled.some((l) => !isWebLink(l));
  return (
    <div className="field submission-links">
      <span>Liên kết bài thuyết trình / minh chứng (không bắt buộc)</span>
      {rows.map((row, i) => (
        <div className="submission-link-row" key={i}>
          <input
            type="url"
            value={row}
            disabled={disabled}
            autoFocus={i === added}
            aria-label={
              rows.length > 1 ? `Liên kết ${i + 1}` : 'Liên kết bài thuyết trình / minh chứng'
            }
            placeholder="Dán link Canva, Google Slides, Drive, YouTube…"
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value.replace(/\s*\n\s*/g, '');
              set(next);
            }}
          />
          {row.trim() && isWebLink(row.trim()) && (
            <Badge>{LINK_KIND_LABEL[linkKind(row.trim())]}</Badge>
          )}
          {rows.length > 1 && (
            <button
              type="button"
              className="icon-button"
              disabled={disabled}
              aria-label={`Xoá liên kết ${i + 1}`}
              onClick={() => set(rows.filter((_, j) => j !== i))}
            >
              <X size={15} />
            </button>
          )}
        </div>
      ))}
      {rows.length < max && (
        <div>
          <Button
            variant="ghost"
            disabled={disabled || !rows[rows.length - 1].trim()}
            onClick={() => {
              setAdded(rows.length);
              set([...rows, '']);
            }}
          >
            <Plus size={15} /> Thêm liên kết
          </Button>
        </div>
      )}
      <small>
        {hint ??
          `Tối đa ${MAX_SUBMISSION_LINKS} liên kết, ví dụ bài thuyết trình Canva kèm video trình bày.`}
      </small>
      {invalid && (
        <small className="error">Liên kết phải bắt đầu bằng http:// hoặc https://.</small>
      )}
      {hasCanva && (
        <p className="notice warning">
          <Link2 size={16} />
          <span>
            Với Canva, hãy bấm <strong>Chia sẻ → Quyền truy cập: Bất kỳ ai có liên kết</strong> rồi
            sao chép liên kết <strong>xem</strong>. Nếu không, giáo viên sẽ không mở được bài.
            {canvaEdit &&
              ' Liên kết bạn dán là liên kết chỉnh sửa (/edit); nên dùng liên kết xem để giáo viên mở được.'}
          </span>
        </p>
      )}
    </div>
  );
}

/** Read-only list of a submission's evidence links, with an in-page preview for Canva designs. */
export function SubmissionLinkList({ link }: { link: string | undefined }) {
  const links = parseSubmissionLinks(link);
  if (!links.length) return null;
  return (
    <ul className="submission-link-list">
      {links.map((l, i) => (
        <li key={`${i}-${l}`}>
          <Badge>{LINK_KIND_LABEL[linkKind(l)]}</Badge>
          <a className="text-link" href={l} target="_blank" rel="noopener noreferrer">
            {l}
          </a>
          <span className="submission-link-actions">
            <CanvaActions link={l} />
            <a
              className="button ghost"
              href={l}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Mở ${LINK_KIND_LABEL[linkKind(l)]} ${i + 1}`}
            >
              <ExternalLink size={15} /> Mở
            </a>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The embeddable view of a Canva link: worked out directly for canva.com design links, asked of the
 * server for canva.link short links (it reads where they redirect). null while unknown or when the
 * link is not a design.
 */
function useCanvaEmbed(link: string) {
  const direct = canvaEmbedUrl(link);
  const short = !direct && isCanvaShortLink(link);
  const [resolved, setResolved] = useState<{ link: string; embed: string | null } | null>(null);
  useEffect(() => {
    if (!short) return;
    let live = true;
    api<{ embed: string | null }>(`/api/canva/resolve?url=${encodeURIComponent(link)}`)
      .then((r) => live && setResolved({ link, embed: r.embed }))
      .catch(() => live && setResolved({ link, embed: null }));
    return () => {
      live = false;
    };
  }, [link, short]);
  return direct ?? (resolved?.link === link ? resolved.embed : null);
}

function CanvaActions({ link }: { link: string }) {
  const src = useCanvaEmbed(link);
  if (!src) return null;
  return (
    <>
      <CanvaPresent src={src} />
      <CanvaPreview src={src} />
    </>
  );
}

function CanvaPreview({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label="Xem trước bài Canva">
        <Eye size={15} /> Xem trước
      </Button>
      <Dialog open={open} title="Bài thuyết trình Canva" onClose={() => setOpen(false)} wide>
        {open && (
          <div className="video-frame">
            <iframe
              src={src}
              title="Bài thuyết trình Canva"
              allow="fullscreen"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}
        <p className="small muted">
          Nếu khung trống, học viên chưa bật chia sẻ công khai; hãy bấm “Mở” để xem trên Canva.
        </p>
      </Dialog>
    </>
  );
}

/**
 * "Trình chiếu": shows a shared Canva design across the whole screen so a teacher can present it in
 * class without downloading anything. It is a modal <dialog>, so it also sits above the grading
 * dialog it is opened from. Uses the browser's full-screen mode where page content may use it
 * (desktop, Android); on iPhone, which allows it only for videos, it simply covers the window.
 * Esc, the close button or leaving full screen ends it.
 */
function CanvaPresent({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  const stage = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    // Leaving full screen with the browser's own Esc or gesture ends the presentation too.
    const onFullscreen = () => {
      if (!document.fullscreenElement) setOpen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [open]);
  return (
    <>
      <Button
        variant="secondary"
        aria-label="Trình chiếu bài Canva toàn màn hình"
        onClick={() => {
          // Render the stage now so it can be shown and put in full screen within this click.
          flushSync(() => setOpen(true));
          const el = stage.current;
          if (!el) return;
          if (!el.open) el.showModal();
          void el.requestFullscreen?.().catch(() => {});
        }}
      >
        <MonitorPlay size={15} /> Trình chiếu
      </Button>
      {open &&
        createPortal(
          <dialog
            className="canva-stage"
            ref={stage}
            aria-label="Trình chiếu bài Canva"
            onCancel={(e) => {
              // React passes portal events up to the grading dialog, which would close too.
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* First in the dialog so it, not the Canva frame, gets the focus. */}
            <button
              type="button"
              className="canva-stage-close"
              aria-label="Thoát trình chiếu"
              autoFocus
              onClick={() => setOpen(false)}
            >
              <X size={20} /> Thoát
            </button>
            <iframe src={src} title="Bài thuyết trình Canva" allow="fullscreen" allowFullScreen />
          </dialog>,
          document.body,
        )}
    </>
  );
}
