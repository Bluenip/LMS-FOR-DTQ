'use client';

import { useState } from 'react';
import { KeyRound, Save, UserRound } from 'lucide-react';
import { useLms } from '@/components/lms-provider';
import { AuthError, PasswordField } from '@/components/auth';
import { Badge, Button, Field, PageHeading } from '@/components/ui';
import { initials } from '@/lib/client';

export default function Profile() {
  const { state, updateProfile } = useLms();
  const user = state.user;
  const [name, setName] = useState(user.name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameMessage, setNameMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const busy = nameBusy || passwordBusy;
  return (
    <>
      <PageHeading
        title="Thông tin cá nhân"
        description="Cập nhật họ tên và mật khẩu đăng nhập của bạn."
      />
      <div className="two-col">
        <section className="panel stack">
          <div className="section-heading">
            <h2>
              <UserRound size={20} /> Hồ sơ của bạn
            </h2>
            <Badge>
              {user.isAdmin ? 'Quản trị viên' : user.role === 'TEACHER' ? 'Giáo viên' : 'Học viên'}
            </Badge>
          </div>
          <div className="member-profile">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <p>{user.email}</p>
            </div>
          </div>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setNameBusy(true);
              setNameError('');
              setNameMessage('');
              try {
                const result = await updateProfile({ name: name.trim() });
                setName(result.user.name);
                setNameMessage(result.message);
              } catch (e) {
                setNameError((e as Error).message);
              } finally {
                setNameBusy(false);
              }
            }}
          >
            <Field label="Họ và tên">
              <input
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameMessage('');
                }}
              />
            </Field>
            <Field label="Email đăng nhập" hint="Email đăng nhập do quản trị viên cấp.">
              <input type="email" value={user.email} readOnly />
            </Field>
            <AuthError error={nameError} />
            {nameMessage && (
              <p className="notice success" role="status">
                {nameMessage}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy}>
                <Save size={16} />
                {nameBusy ? 'Đang lưu…' : 'Lưu thông tin'}
              </Button>
            </div>
          </form>
        </section>
        <section className="panel stack">
          <div className="section-heading">
            <h2>
              <KeyRound size={20} /> Đổi mật khẩu
            </h2>
          </div>
          <p className="small muted">
            Nhập mật khẩu hiện tại để đặt mật khẩu riêng cho tài khoản của bạn.
          </p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setPasswordError('');
              setPasswordMessage('');
              if (newPassword !== confirmation) {
                setPasswordError('Mật khẩu nhập lại chưa khớp. Vui lòng kiểm tra lại.');
                return;
              }
              setPasswordBusy(true);
              try {
                const result = await updateProfile({
                  currentPassword,
                  newPassword,
                  confirmPassword: confirmation,
                });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmation('');
                setPasswordMessage(result.message);
              } catch (e) {
                setPasswordError((e as Error).message);
              } finally {
                setPasswordBusy(false);
              }
            }}
          >
            <PasswordField
              label="Mật khẩu hiện tại"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              minLength={1}
            />
            <PasswordField
              label="Mật khẩu mới"
              value={newPassword}
              onChange={setNewPassword}
              hint="Từ 8 đến 128 ký tự."
            />
            <PasswordField
              label="Nhập lại mật khẩu mới"
              value={confirmation}
              onChange={setConfirmation}
            />
            <p className="auth-help">
              Các phiên đăng nhập cũ trên thiết bị khác sẽ hết hiệu lực. Bạn vẫn tiếp tục sử dụng
              trên trang này.
            </p>
            <AuthError error={passwordError} />
            {passwordMessage && (
              <p className="notice success" role="status">
                {passwordMessage}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy}>
                <KeyRound size={16} />
                {passwordBusy ? 'Đang đổi mật khẩu…' : 'Lưu mật khẩu mới'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
