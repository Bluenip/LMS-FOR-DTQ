'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button, Field } from '@/components/ui';
import { AuthError, AuthLayout, PasswordField } from '@/components/auth';
import { api } from '@/lib/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  async function login() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: { role: string; isAdmin?: boolean } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      router.push(
        result.user.isAdmin
          ? '/admin'
          : result.user.role === 'TEACHER'
            ? '/teacher/classes'
            : '/classes',
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Chào mừng trở lại"
      description="Đăng nhập để tiếp tục hành trình học tập của bạn."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void login();
        }}
      >
        <Field label="Địa chỉ email">
          <input
            type="email"
            autoComplete="username"
            required
            maxLength={200}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@example.com"
          />
        </Field>
        <PasswordField
          label="Mật khẩu"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          minLength={1}
        />
        <AuthError error={error} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          <ArrowRight size={17} />
        </Button>
      </form>
    </AuthLayout>
  );
}
