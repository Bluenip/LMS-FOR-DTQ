'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  KeyRound,
  LockKeyhole,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  UserRoundPlus,
} from 'lucide-react';
import { useLms } from '@/components/lms-provider';
import { Badge, Button, Dialog, Empty, Field, PageHeading, Search, Tabs } from '@/components/ui';
import { GoogleDriveConnect } from '@/components/drive';
import { AuditLogPanel } from '@/components/audit';
import { api, ApiError, fold, initials } from '@/lib/client';
import type { AdminState, AdminUser, Role } from '@/lib/types';

function useAdminAccounts(enabled: boolean, userId: string) {
  const [data, setData] = useState<AdminState | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const snapshot = useRef('');
  const router = useRouter();
  const refresh = useCallback(
    async (background = false) => {
      if (!enabled || (background && active.current)) return;
      active.current?.abort();
      const version = ++generation.current;
      const controller = new AbortController();
      active.current = controller;
      try {
        const next = await api<AdminState>('/api/admin/users', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted || version !== generation.current) return;
        const serialized = JSON.stringify(next);
        if (snapshot.current !== serialized) {
          snapshot.current = serialized;
          setData(next);
        }
        setError('');
      } catch (cause) {
        if (controller.signal.aborted || version !== generation.current) return;
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
          snapshot.current = '';
          setData(null);
          if (cause.status === 401) router.replace('/login');
        }
        setError((cause as Error).message);
      } finally {
        if (version === generation.current) active.current = null;
      }
    },
    [enabled, router, userId],
  );

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    snapshot.current = '';
    setError('');
    if (!enabled) return;
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed) timer = setTimeout(tick, 3000);
    };
    const tick = async () => {
      if (disposed) return;
      if (document.visibilityState === 'visible' && navigator.onLine) await refresh(true);
      schedule();
    };
    const wake = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void tick();
    };
    void refresh().then(schedule);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      generation.current++;
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [enabled, userId, refresh]);
  return { data, error, refresh };
}

type Editor =
  | { kind: 'create'; role: Role }
  | { kind: 'edit' | 'password' | 'activate' | 'delete'; userId: string }
  | { kind: 'status'; userId: string; disabled: boolean }
  | null;
function status(user: AdminUser) {
  return user.disabled ? 'Đã khóa' : user.emailVerified ? 'Đang hoạt động' : 'Chờ kích hoạt';
}
function ErrorLine({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

export function AdminAccounts() {
  const { state, refresh: refreshLms } = useLms();
  const { data, error, refresh } = useAdminAccounts(!!state.user.isAdmin, state.user.id);
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const role = params.get('role') === 'students' ? 'students' : 'teachers';
  const filter = params.get('status') || 'all';
  const search = params.get('q') || '';
  const requestedPage = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  function query(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  async function mutate(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: Record<string, unknown>,
  ) {
    const reply = await api<{ message?: string; temporaryPassword?: string }>(path, {
      method,
      body: JSON.stringify(body),
    });
    setEditor(null);
    setNotice(reply.message || 'Thay đổi đã được lưu.');
    if (reply.temporaryPassword) setTemporaryPassword(reply.temporaryPassword);
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('dtq-state');
      channel.postMessage('state-changed');
      channel.close();
    }
    await Promise.all([refresh(), refreshLms()]);
  }
  if (!state.user.isAdmin)
    return (
      <Empty
        title="Trang dành cho quản trị viên"
        description="Tài khoản của bạn chưa được cấp quyền quản trị. Liên hệ người quản lý hệ thống nếu bạn cần hỗ trợ."
      />
    );
  const visible =
    data?.users.filter(
      (user) =>
        user.role === (role === 'teachers' ? 'TEACHER' : 'STUDENT') &&
        fold(`${user.name} ${user.email}`).includes(fold(search)) &&
        (filter === 'all' ||
          (filter === 'disabled'
            ? user.disabled
            : filter === 'pending'
              ? !user.disabled && !user.emailVerified
              : !user.disabled && user.emailVerified)),
    ) || [];
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const page = Math.min(requestedPage, pages);
  const selected =
    editor && editor.kind !== 'create'
      ? data?.users.find((user) => user.id === editor.userId)
      : undefined;
  const dialogTitle =
    editor?.kind === 'create'
      ? 'Tạo tài khoản'
      : editor?.kind === 'edit'
        ? 'Sửa tài khoản'
        : editor?.kind === 'password'
          ? 'Đặt lại mật khẩu'
          : editor?.kind === 'activate'
            ? 'Kích hoạt tài khoản'
            : editor?.kind === 'delete'
              ? 'Xóa tài khoản'
              : editor?.kind === 'status' && !editor.disabled
                ? 'Mở khóa tài khoản'
                : 'Khóa tài khoản';
  const close = () => setEditor(null);

  return (
    <div className="admin-workspace">
      <PageHeading
        title="Quản trị tài khoản"
        description="Cấp tài khoản giáo viên, học viên và quản lý quyền truy cập giảng đường."
        actions={
          <Button
            onClick={() => {
              setNotice('');
              setEditor({ kind: 'create', role: role === 'students' ? 'STUDENT' : 'TEACHER' });
            }}
          >
            <UserRoundPlus size={17} />
            Tạo tài khoản
          </Button>
        }
      />
      {data && (
        <div className="stat-row" aria-label="Tổng quan hệ thống">
          <div className="stat">
            <strong>{data.summary.teachers}</strong>
            <span>Giáo viên</span>
          </div>
          <div className="stat">
            <strong>{data.summary.students}</strong>
            <span>Học viên</span>
          </div>
          <div className="stat">
            <strong>{data.summary.classes}</strong>
            <span>Lớp học</span>
          </div>
          <div className="stat">
            <strong>{data.summary.disabled}</strong>
            <span>Tài khoản đã khóa</span>
          </div>
        </div>
      )}
      {error && (
        <div className="admin-fetch-error">
          <ErrorLine message={error} />
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw size={16} />
            Thử lại
          </Button>
        </div>
      )}
      {state.user.isAdmin && <GoogleDriveConnect />}
      {state.user.isAdmin && <AuditLogPanel />}
      {notice && (
        <p className="notice admin-notice" role="status">
          {notice}
        </p>
      )}
      {!data && !error ? (
        <div className="panel" role="status" aria-label="Đang tải tài khoản">
          <div className="skeleton title" />
          <div className="skeleton row" />
          <div className="skeleton row" />
          <div className="skeleton row" />
        </div>
      ) : (
        data && (
          <section className="panel admin-accounts-panel">
            <div className="toolbar admin-toolbar">
              <Tabs
                value={role}
                onChange={(value) => query('role', value)}
                items={[
                  { id: 'teachers', label: 'Giáo viên', count: data.summary.teachers },
                  { id: 'students', label: 'Học viên', count: data.summary.students },
                ]}
              />
              <Search
                value={search}
                onChange={(value) => query('q', value)}
                placeholder="Tìm tên hoặc email…"
              />
              <label className="field admin-status-filter">
                <span className="sr-only">Trạng thái tài khoản</span>
                <select
                  aria-label="Trạng thái tài khoản"
                  value={filter}
                  onChange={(event) => query('status', event.target.value)}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="pending">Chờ kích hoạt</option>
                  <option value="disabled">Đã khóa</option>
                </select>
              </label>
            </div>
            <div className="admin-table-wrap">
              <table className="table admin-table" aria-label="Tài khoản trên hệ thống">
                <thead>
                  <tr>
                    <th>Họ tên & email</th>
                    <th>Quyền tài khoản</th>
                    <th>Trạng thái</th>
                    <th>{role === 'teachers' ? 'Lớp giảng dạy' : 'Lớp tham gia'}</th>
                    <th>Kích hoạt</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice((page - 1) * 10, page * 10).map((user) => (
                    <tr key={user.id}>
                      <td data-label="Họ tên & email">
                        <div className="admin-user">
                          <span className="avatar">{initials(user.name)}</span>
                          <div>
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Quyền tài khoản">
                        <div className="admin-role-tags">
                          <span>
                            {user.isAdmin
                              ? 'Quản trị viên'
                              : user.role === 'TEACHER'
                                ? 'Giáo viên'
                                : 'Học viên'}
                          </span>
                          {user.isDemo && <Badge>Mẫu</Badge>}
                        </div>
                      </td>
                      <td data-label="Trạng thái">
                        <Badge
                          tone={
                            user.disabled ? 'danger' : user.emailVerified ? 'success' : 'warning'
                          }
                        >
                          {status(user)}
                        </Badge>
                      </td>
                      <td data-label={role === 'teachers' ? 'Lớp giảng dạy' : 'Lớp tham gia'}>
                        {user.role === 'TEACHER' ? user.classCount : user.enrollmentCount}
                      </td>
                      <td data-label="Kích hoạt">
                        <span className="small muted">
                          {user.emailVerified ? 'Đã kích hoạt' : 'Chưa kích hoạt'}
                        </span>
                      </td>
                      <td data-label="Thao tác">
                        <div className="admin-row-actions">
                          <Button
                            variant="ghost"
                            onClick={() => setEditor({ kind: 'edit', userId: user.id })}
                          >
                            <Pencil size={14} />
                            Sửa tài khoản
                          </Button>
                          {!user.isAdmin && (
                            <>
                              {!user.emailVerified && (
                                <Button
                                  variant="secondary"
                                  onClick={() => setEditor({ kind: 'activate', userId: user.id })}
                                >
                                  <ShieldCheck size={14} />
                                  Kích hoạt
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                onClick={() => setEditor({ kind: 'password', userId: user.id })}
                              >
                                <KeyRound size={14} />
                                Đặt lại mật khẩu
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setEditor({
                                    kind: 'status',
                                    userId: user.id,
                                    disabled: !user.disabled,
                                  })
                                }
                              >
                                {user.disabled ? (
                                  <UnlockKeyhole size={14} />
                                ) : (
                                  <LockKeyhole size={14} />
                                )}
                                {user.disabled ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
                              </Button>
                              <Button
                                variant="ghost"
                                className="admin-delete"
                                onClick={() => setEditor({ kind: 'delete', userId: user.id })}
                              >
                                <Trash2 size={14} />
                                Xóa tài khoản
                              </Button>
                            </>
                          )}
                          {user.isAdmin && (
                            <span className="admin-protected">
                              <ShieldCheck size={13} />
                              {user.id === state.user.id ? (
                                <Link href="/profile" className="text-link">
                                  Thông tin cá nhân
                                </Link>
                              ) : (
                                'Tài khoản quản trị được bảo vệ'
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && (
              <Empty
                title="Không tìm thấy tài khoản phù hợp"
                description="Thử thay đổi từ khóa hoặc trạng thái để xem các tài khoản trên hệ thống."
              />
            )}
            <div className="pagination">
              <span>
                {visible.length} tài khoản, trang {page}/{pages}
              </span>
              <div className="inline-actions">
                <Button
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => query('page', String(page - 1))}
                >
                  Trước
                </Button>
                <Button
                  variant="ghost"
                  disabled={page >= pages}
                  onClick={() => query('page', String(page + 1))}
                >
                  Sau
                </Button>
              </div>
            </div>
          </section>
        )
      )}
      <div className="notice admin-access-note">
        <ShieldCheck size={18} />
        <p>
          Tài khoản giáo viên và học viên do quản trị viên cấp. Bạn chuyển thông tin đăng nhập riêng
          cho từng người. Khóa tài khoản vẫn giữ nguyên dữ liệu học tập; xóa tài khoản thì không
          khôi phục được.
        </p>
      </div>
      {data && data.managedClasses.length > 0 && (
        <ClassOwnershipManager
          data={data}
          onTransfer={(classId, teacherId, expectedTeacherId) =>
            mutate(`/api/admin/classes/${classId}/owner`, 'POST', { teacherId, expectedTeacherId })
          }
        />
      )}
      <Dialog open={!!editor} title={dialogTitle} onClose={close}>
        {editor?.kind === 'create' ? (
          <CreateAccountForm
            defaultRole={editor.role}
            onClose={close}
            onSave={(values) => mutate('/api/admin/users', 'POST', values)}
          />
        ) : selected ? (
          editor?.kind === 'edit' ? (
            <NameForm
              key={`name-${selected.id}`}
              user={selected}
              onClose={close}
              onSave={(name, role) =>
                mutate(`/api/admin/users/${selected.id}`, 'PATCH', {
                  name,
                  ...(selected.isAdmin ? {} : { role }),
                })
              }
            />
          ) : editor?.kind === 'password' ? (
            <ResetAccountForm
              key={`password-${selected.id}`}
              user={selected}
              onClose={close}
              onSave={(values) =>
                mutate(`/api/admin/users/${selected.id}/reset-password`, 'POST', values)
              }
            />
          ) : editor?.kind === 'delete' ? (
            <DeleteAccountForm
              key={`delete-${selected.id}`}
              user={selected}
              onClose={close}
              onSave={(confirmEmail) =>
                mutate(`/api/admin/users/${selected.id}`, 'DELETE', { confirmEmail })
              }
            />
          ) : editor?.kind === 'activate' ? (
            <ActivationForm
              key={`activate-${selected.id}`}
              user={selected}
              onClose={close}
              onSave={() =>
                mutate(`/api/admin/users/${selected.id}`, 'PATCH', { emailVerified: true })
              }
            />
          ) : (
            <StatusForm
              key={`status-${selected.id}`}
              user={selected}
              targetDisabled={editor?.kind === 'status' ? editor.disabled : selected.disabled}
              onClose={close}
              onSave={() =>
                mutate(`/api/admin/users/${selected.id}`, 'PATCH', {
                  disabled: editor?.kind === 'status' ? editor.disabled : selected.disabled,
                })
              }
            />
          )
        ) : (
          editor && (
            <Empty
              title="Tài khoản không còn trong danh sách"
              description="Đóng cửa sổ và tải lại danh sách để tiếp tục quản lý."
            />
          )
        )}
      </Dialog>
      <Dialog
        open={!!temporaryPassword}
        title="Mật khẩu tạm"
        onClose={() => setTemporaryPassword('')}
      >
        <div className="stack">
          <p>
            Mật khẩu tạm chỉ được hiển thị lần này. Hãy sao chép và chuyển riêng cho người dùng.
          </p>
          <p className="notice">
            <strong>{temporaryPassword}</strong>
          </p>
          <p className="small muted">Người dùng phải đổi mật khẩu trước khi vào lớp.</p>
          <div className="dialog-footer">
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(temporaryPassword)}
            >
              Sao chép
            </Button>
            <Button onClick={() => setTemporaryPassword('')}>Đã lưu lại</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ClassOwnershipManager({
  data,
  onTransfer,
}: {
  data: AdminState;
  onTransfer: (classId: string, teacherId: string, expectedTeacherId: string) => Promise<void>;
}) {
  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const classroom = data.managedClasses.find((c) => c.id === classId);
  return (
    <details className="panel stack">
      <summary>Chuyển quyền quản lý lớp</summary>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !classroom ||
            !window.confirm(`Chuyển quyền quản lý lớp ${classroom.title} cho giáo viên đã chọn?`)
          )
            return;
          setBusy(true);
          setError('');
          try {
            await onTransfer(classroom.id, teacherId, classroom.teacherId);
            setClassId('');
            setTeacherId('');
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small muted">
          Dùng khi người quản lý lớp thay đổi hoặc tài khoản cũ bị khóa. Bài học và danh sách giáo
          viên vẫn được giữ.
        </p>
        <Field label="Lớp học">
          <select required value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Chọn lớp</option>
            {data.managedClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        {classroom && (
          <p className="small">
            Người quản lý hiện tại:{' '}
            {data.users.find((u) => u.id === classroom.teacherId)?.name || 'Không còn khả dụng'}
          </p>
        )}
        <Field label="Người quản lý mới">
          <select required value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Chọn giáo viên</option>
            {data.users
              .filter((u) => u.role === 'TEACHER' && !u.disabled && u.emailVerified)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
          </select>
        </Field>
        <ErrorLine message={error} />
        <Button
          type="submit"
          disabled={busy || !classroom || !teacherId || teacherId === classroom?.teacherId}
        >
          Chuyển quyền
        </Button>
      </form>
    </details>
  );
}

function CreateAccountForm({
  defaultRole,
  onClose,
  onSave,
}: {
  defaultRole: Role;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [role, setRole] = useState<Role>(defaultRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSave({ role, name: name.trim(), email: email.trim() });
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Vai trò">
        <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="TEACHER">Giáo viên</option>
          <option value="STUDENT">Học viên</option>
        </select>
      </Field>
      <Field label="Họ và tên">
        <input
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Họ tên người dùng"
        />
      </Field>
      <Field label="Địa chỉ email">
        <input
          required
          type="email"
          maxLength={200}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="nguoidung@example.com"
        />
      </Field>
      <p className="small muted">
        Hệ thống tạo mật khẩu tạm riêng và yêu cầu người dùng đổi mật khẩu sau khi đăng nhập.
      </p>
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button type="submit" disabled={busy}>
          <UserRoundPlus size={16} />
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </Button>
      </div>
    </form>
  );
}
function NameForm({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (name: string, role: Role) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSave(name.trim(), role);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="small muted">{user.email}</p>
      <Field label="Họ và tên">
        <input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {!user.isAdmin && (
        <Field label="Vai trò">
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="STUDENT">Học viên</option>
            <option value="TEACHER">Giáo viên</option>
          </select>
        </Field>
      )}
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </Button>
      </div>
    </form>
  );
}
function ResetAccountForm({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (user.isAdmin) {
          setError('Tài khoản quản trị viên đổi mật khẩu trong Thông tin cá nhân.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          await onSave({});
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Tạo mật khẩu tạm mới cho <strong>{user.name}</strong> ({user.email})?
      </p>
      <p className="small muted">
        Các phiên đăng nhập hiện tại sẽ hết hiệu lực. Người dùng phải đổi mật khẩu sau khi đăng
        nhập.
      </p>
      <label className="check-label">
        <input
          required
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>Tôi hiểu người dùng sẽ phải đăng nhập lại bằng mật khẩu tạm mới.</span>
      </label>
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button type="submit" disabled={busy || user.isAdmin}>
          <KeyRound size={16} />
          {busy ? 'Đang đặt lại…' : 'Đặt lại mật khẩu'}
        </Button>
      </div>
    </form>
  );
}
function StatusForm({
  user,
  targetDisabled,
  onClose,
  onSave,
}: {
  user: AdminUser;
  targetDisabled: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <p>
        {targetDisabled ? 'Tạm ngừng' : 'Cho phép'} <strong>{user.name}</strong> ({user.email}) đăng
        nhập vào hệ thống?
      </p>
      <p className="notice">
        {targetDisabled
          ? 'Các phiên đăng nhập hiện tại sẽ kết thúc. Lớp học, bài giảng và bài nộp vẫn được giữ nguyên.'
          : 'Người dùng có thể đăng nhập lại bằng mật khẩu hiện tại.'}
      </p>
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button
          variant={targetDisabled ? 'danger' : 'primary'}
          disabled={busy || user.isAdmin}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onSave();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Đang lưu…' : targetDisabled ? 'Xác nhận khóa' : 'Xác nhận mở khóa'}
        </Button>
      </div>
    </div>
  );
}

function DeleteAccountForm({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (confirmEmail: string) => Promise<void>;
}) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = confirmEmail.trim().toLowerCase() === user.email.toLowerCase();
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!matches) return;
        setBusy(true);
        setError('');
        try {
          await onSave(confirmEmail.trim());
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Xóa vĩnh viễn tài khoản <strong>{user.name}</strong> ({user.email})?
      </p>
      <p className="notice">
        <span>
          {user.role === 'STUDENT'
            ? 'Bài nộp, điểm, tiến độ, ghi chép, thảo luận và tệp của học viên sẽ bị xóa và không khôi phục được.'
            : 'Ghi chép, thảo luận và tệp riêng của giáo viên sẽ bị xóa; học liệu đang dùng trong bài giảng được chuyển cho chủ lớp. Giáo viên đang quản lý lớp phải chuyển quyền quản lý trước.'}{' '}
          Nếu chỉ muốn chặn đăng nhập, hãy dùng <strong>Khóa tài khoản</strong>.
        </span>
      </p>
      <Field label={`Nhập email ${user.email} để xác nhận`}>
        <input
          type="email"
          autoComplete="off"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          disabled={busy}
        />
      </Field>
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button type="submit" variant="danger" disabled={busy || !matches || user.isAdmin}>
          <Trash2 size={16} />
          {busy ? 'Đang xóa…' : 'Xóa vĩnh viễn'}
        </Button>
      </div>
    </form>
  );
}

function ActivationForm({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <p>
        Kích hoạt tài khoản <strong>{user.name}</strong> ({user.email}) để sử dụng giảng đường?
      </p>
      <p className="notice">
        {user.disabled
          ? 'Tài khoản đang bị khóa. Sau khi kích hoạt, bạn cần mở khóa để cho phép đăng nhập.'
          : 'Người dùng có thể đăng nhập bằng mật khẩu đã được cấp sau khi kích hoạt.'}
      </p>
      <ErrorLine message={error} />
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button
          disabled={busy || user.isAdmin || user.emailVerified}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onSave();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Đang kích hoạt…' : user.emailVerified ? 'Đã kích hoạt' : 'Xác nhận kích hoạt'}
        </Button>
      </div>
    </div>
  );
}
