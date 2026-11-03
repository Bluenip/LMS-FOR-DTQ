'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { BookOpen, Eye, EyeOff } from 'lucide-react';
import { APP_NAME } from '@/lib/brand';
import { IconButton } from '@/components/ui';

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="login-layout auth-layout">
      <section className="login-story">
        <Link href="/login" className="brand" aria-label={`${APP_NAME}, trang đăng nhập`}>
          <span className="brand-mark">
            <BookOpen size={25} />
          </span>
          <span>
            <strong>{APP_NAME}</strong>
            <small>Giảng đường trực tuyến</small>
          </span>
        </Link>
        <div>
          <blockquote>
            Học để biết.
            <br />
            Hành để trưởng thành.
          </blockquote>
          <p>
            Mỗi bài học là một cơ hội vun bồi lòng hiếu kính, sự chân thành và những thói quen tốt.
          </p>
        </div>
        <footer>Nền tảng học tập đạo đức & nhân cách truyền thống</footer>
      </section>
      <section className="login-main">
        <div className="login-form">
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'new-password',
  hint,
  minLength = 8,
  action,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: 'current-password' | 'new-password';
  hint?: string;
  minLength?: number;
  action?: ReactNode;
  invalid?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field auth-password-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className="auth-password-control">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <IconButton
          label={`${visible ? 'Ẩn' : 'Hiện'} ${label.toLocaleLowerCase('vi-VN')}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </IconButton>
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function AuthError({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
