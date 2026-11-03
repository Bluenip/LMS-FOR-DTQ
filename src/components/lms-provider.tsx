'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Bell, LogOut, Menu, GraduationCap, RefreshCw } from 'lucide-react';
import type { AppState } from '@/lib/types';
import { APP_NAME } from '@/lib/brand';
import { PUBLIC_AUTH_ROUTES } from '@/lib/auth-routes';
import { managesClass } from '@/lib/class-teachers';
import { api, ApiError, dateTime, initials } from '@/lib/client';
import { Button, Dialog, IconButton } from './ui';
const Context = createContext<{
  state: AppState;
  action: (name: string, payload?: Record<string, unknown>) => Promise<unknown>;
  refresh: () => Promise<void>;
  updateProfile: (
    payload: Record<string, unknown>,
  ) => Promise<{ user: AppState['user']; message: string }>;
} | null>(null);
export function useLms() {
  const c = useContext(Context);
  if (!c) throw new Error('LMS provider is required');
  return c;
}
export function Brand({ href = '/classes' }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-mark">
        <BookOpen size={25} strokeWidth={1.6} />
      </span>
      <span>
        <strong>{APP_NAME}</strong>
        <small>Giảng đường trực tuyến</small>
      </span>
    </Link>
  );
}
export function LmsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [readingNotifications, setReadingNotifications] = useState(false);
  const pathname = usePathname();
  const publicAuthPage = PUBLIC_AUTH_ROUTES.includes(pathname);
  const router = useRouter();
  const requestVersion = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const snapshot = useRef('');
  const channel = useRef<BroadcastChannel | null>(null);
  const pendingMutations = useRef(0);
  const cancelRefresh = useCallback(() => {
    requestVersion.current++;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
  }, []);
  const refresh = useCallback(
    async (background = false) => {
      // A mutation must fetch after its write even if an older background read is in flight.
      if (background && (pendingRequest.current || pendingMutations.current > 0)) return;
      cancelRefresh();
      const version = requestVersion.current;
      const controller = new AbortController();
      pendingRequest.current = controller;
      try {
        const data = await api<AppState>('/api/state', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted || version !== requestVersion.current) return;
        const nextSnapshot = JSON.stringify(data);
        if (snapshot.current !== nextSnapshot) {
          snapshot.current = nextSnapshot;
          setState(data);
        }
        setError('');
      } catch (e) {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        if (e instanceof ApiError && e.status === 401) {
          snapshot.current = '';
          setState(null);
          router.replace('/login');
        } else setError((e as Error).message);
      } finally {
        if (version === requestVersion.current) pendingRequest.current = null;
      }
    },
    [cancelRefresh, router],
  );
  useEffect(() => {
    if (publicAuthPage) {
      cancelRefresh();
      snapshot.current = '';
      setState(null);
      setError('');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible' && navigator.onLine) await refresh(true);
      schedule();
    };
    const wake = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('dtq-state');
      channel.current.onmessage = wake;
    }
    void refresh().then(schedule);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      channel.current?.close();
      channel.current = null;
      cancelRefresh();
    };
  }, [cancelRefresh, refresh, pathname, publicAuthPage]);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (state?.user.mustChangePassword && pathname !== '/profile' && !publicAuthPage)
      router.replace('/profile');
  }, [state?.user.mustChangePassword, pathname, publicAuthPage, router]);
  if (publicAuthPage) return children;
  const action = async (name: string, payload: Record<string, unknown> = {}) => {
    pendingMutations.current++;
    cancelRefresh();
    try {
      const result = await api<{ ok: boolean; result: unknown }>('/api/actions', {
        method: 'POST',
        body: JSON.stringify({ action: name, ...payload }),
      });
      channel.current?.postMessage('state-changed');
      await refresh();
      return result.result;
    } finally {
      pendingMutations.current--;
    }
  };
  const updateProfile = async (payload: Record<string, unknown>) => {
    pendingMutations.current++;
    cancelRefresh();
    try {
      const result = await api<{ user: AppState['user']; message: string }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      channel.current?.postMessage('state-changed');
      await refresh();
      return result;
    } finally {
      pendingMutations.current--;
    }
  };
  if (!state)
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="container header-inner">
            <Brand />
          </div>
        </header>
        <main className="container loading-screen">
          {error ? (
            <div className="stack">
              <p className="error" role="alert">
                {error}
              </p>
              <Button onClick={() => void refresh()}>
                <RefreshCw size={16} />
                Thử lại
              </Button>
              <Link href="/login" className="text-link">
                Đăng nhập
              </Link>
            </div>
          ) : (
            <div role="status" aria-label="Đang tải lớp học">
              <div className="skeleton title" />
              <div className="skeleton block" />
              <div className="skeleton row" />
            </div>
          )}
        </main>
      </div>
    );
  const teacher = state.user.role === 'TEACHER';
  const admin = state.user.isAdmin === true;
  const sortedNotifications = [...state.notifications].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const unreadNotifications = sortedNotifications.filter((n) => !n.read);
  const markRead = async (ids: string[]) => {
    setReadingNotifications(true);
    try {
      for (let i = 0; i < ids.length; i += 2000)
        await action('markNotificationsRead', { ids: ids.slice(i, i + 2000) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReadingNotifications(false);
    }
  };
  const nav = teacher
    ? [
        ['/teacher/classes', 'Lớp giảng dạy'],
        ['/teacher/lessons', 'Kho bài giảng'],
        ['/teacher/assignments', 'Bài cần chấm'],
        ['/classes', 'Lớp của tôi'],
        ['/assignments', 'Bài tập của tôi'],
      ]
    : [
        ['/classes', 'Lớp của tôi'],
        ['/assignments', 'Bài tập của tôi'],
      ];
  if (admin) nav.push(['/admin', 'Quản trị']);
  nav.push(['/profile', 'Thông tin cá nhân']);
  return (
    <Context.Provider key={state.user.id} value={{ state, action, refresh, updateProfile }}>
      <div className="app-shell">
        <header className="app-header">
          <div className="container header-inner">
            <Brand href={teacher ? '/teacher/classes' : '/classes'} />
            <nav aria-label="Điều hướng chính" className={`header-nav ${menu ? 'open' : ''}`}>
              {nav.map(([href, label]) => (
                <Link className={pathname.startsWith(href) ? 'active' : ''} key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
            <div className="header-account">
              <IconButton
                className="notification-button"
                label={`Thông báo (${unreadNotifications.length} chưa đọc)`}
                onClick={() => setNotifications(true)}
              >
                <Bell size={20} />
                {unreadNotifications.length > 0 && (
                  <span className="notification-badge" aria-hidden="true">
                    {unreadNotifications.length > 99 ? '99+' : unreadNotifications.length}
                  </span>
                )}
              </IconButton>
              <div className="account-name">
                <strong>{state.user.name}</strong>
                <span>
                  {admin ? 'Quản trị viên' : teacher ? 'Giáo viên phụ trách' : 'Học viên'}
                </span>
              </div>
              <span className="avatar">{initials(state.user.name)}</span>
              <IconButton
                label="Đăng xuất"
                onClick={async () => {
                  await api('/api/auth/logout', { method: 'POST' });
                  cancelRefresh();
                  channel.current?.postMessage('state-changed');
                  snapshot.current = '';
                  setState(null);
                  router.push('/login');
                }}
              >
                <LogOut size={17} />
              </IconButton>
              <button
                className="icon-button mobile-menu"
                aria-label="Mở menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Menu size={20} />
              </button>
            </div>
          </div>
        </header>
        <main className="container app-main">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {unreadNotifications.length > 0 && (
            <aside className="notice unread-notification" role="status" aria-live="polite">
              <Bell size={20} aria-hidden="true" />
              <div>
                <strong>Bạn có {unreadNotifications.length} thông báo chưa đọc</strong>
                <p>{unreadNotifications[0].content}</p>
              </div>
              <Button variant="secondary" onClick={() => setNotifications(true)}>
                Xem thông báo
              </Button>
            </aside>
          )}
          {children}
        </main>
        <footer className="app-footer">
          <div className="container footer-inner">
            <span className="footer-brand">{APP_NAME}</span>
            {state.demo && (
              <span className="demo-label">
                <GraduationCap size={15} />
                Bản trải nghiệm với dữ liệu minh họa
              </span>
            )}
            <span>Tu dưỡng đức hạnh, vun bồi tri thức.</span>
          </div>
        </footer>
        <Dialog open={notifications} title="Thông báo" onClose={() => setNotifications(false)}>
          {unreadNotifications.length > 0 && (
            <div className="row between">
              <span className="small muted">{unreadNotifications.length} chưa đọc</span>
              <Button
                variant="ghost"
                disabled={readingNotifications}
                onClick={() => void markRead(unreadNotifications.map((n) => n.id))}
              >
                Đánh dấu tất cả đã đọc
              </Button>
            </div>
          )}
          <div className="notification-list">
            {state.notifications.length ? (
              sortedNotifications.map((n) => (
                <div className={`notification-item ${n.read ? '' : 'unread'}`} key={n.id}>
                  {!n.read && <strong className="small accent">Chưa đọc</strong>}
                  <p>{n.content}</p>
                  <small className="muted">{dateTime(n.createdAt)}</small>
                  <div className="inline-actions">
                    {n.assignmentId && state.assignments.some((a) => a.id === n.assignmentId) && (
                      <Link
                        className="button ghost"
                        href={
                          managesClass(
                            state.classes.find(
                              (c) =>
                                c.id ===
                                state.assignments.find((a) => a.id === n.assignmentId)!.classId,
                            )!,
                            state.user,
                          )
                            ? `/teacher/assignments?assignment=${n.assignmentId}&class=${state.assignments.find((a) => a.id === n.assignmentId)!.classId}`
                            : `/classes/${state.assignments.find((a) => a.id === n.assignmentId)!.classId}/assignments/${n.assignmentId}`
                        }
                        onClick={() => {
                          setNotifications(false);
                          if (!n.read) void markRead([n.id]);
                        }}
                      >
                        Xem bài tập
                      </Link>
                    )}
                    {!n.read && (
                      <Button
                        variant="ghost"
                        disabled={readingNotifications}
                        onClick={() => void markRead([n.id])}
                      >
                        Đánh dấu đã đọc
                      </Button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Bạn chưa có thông báo mới.</p>
            )}
          </div>
        </Dialog>
      </div>
    </Context.Provider>
  );
}
