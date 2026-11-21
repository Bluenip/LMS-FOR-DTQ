'use client';
import { useState } from 'react';
import { ExternalLink, Eye, Link2, Plus, X } from 'lucide-react';
import {
  LINK_KIND_LABEL,
  MAX_SUBMISSION_LINKS,
  canvaEmbedUrl,
  isCanvaEditLink,
  isWebLink,
  linkKind,
  parseSubmissionLinks,
} from '@/lib/submission-links';
import { Badge, Button, Dialog } from './ui';

/** Editor for the evidence links of a submission; `value` holds one link per line. */
export function SubmissionLinksEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
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
      {rows.length < MAX_SUBMISSION_LINKS && (
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
        Tối đa {MAX_SUBMISSION_LINKS} liên kết, ví dụ bài thuyết trình Canva kèm video trình bày.
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
            <CanvaPreview link={l} />
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

function CanvaPreview({ link }: { link: string }) {
  const [open, setOpen] = useState(false);
  const src = canvaEmbedUrl(link);
  if (!src) return null;
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
