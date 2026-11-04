'use client';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Search as SearchIcon, X, BookOpen } from 'lucide-react';
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <button type="button" className={`button ${variant} ${className}`} {...props} />;
}
export function IconButton({
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      {...props}
    />
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={32} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <IconButton label="Đóng" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageHeading({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="page-heading">
      {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
      <div className="heading-row">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="heading-actions">{actions}</div>}
      </div>
    </div>
  );
}
export function Search({
  value,
  onChange,
  placeholder = 'Tìm kiếm…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <SearchIcon size={19} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button
          type="button"
          key={i.id}
          role="tab"
          aria-selected={value === i.id}
          className={value === i.id ? 'selected' : ''}
          onClick={() => onChange(i.id)}
        >
          {i.label}
          {i.count !== undefined && <span className="tab-count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}
/**
 * Plays a stored video through its signed, expiring URL. If the signed URL
 * expires mid-playback (seeking after a long pause, for example), a new URL is
 * requested once and playback resumes from the same position.
 */
export function StoredVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const retried = useRef(0);
  useEffect(() => {
    retried.current = 0;
  }, [src]);
  return (
    <video
      ref={ref}
      className={className}
      poster="/video-poster.svg"
      controls
      preload="metadata"
      src={src}
      onError={() => {
        const video = ref.current;
        if (!video || retried.current >= 2) return;
        retried.current++;
        const position = video.currentTime;
        const playing = !video.paused;
        video.src = `${src}${src.includes('?') ? '&' : '?'}renew=${Date.now()}`;
        video.addEventListener(
          'loadedmetadata',
          () => {
            video.currentTime = position;
            if (playing) void video.play().catch(() => {});
          },
          { once: true },
        );
      }}
      onPlaying={() => {
        retried.current = 0;
      }}
    />
  );
}
