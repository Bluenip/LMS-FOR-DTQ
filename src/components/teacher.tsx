'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  Edit3,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useLms } from '@/components/lms-provider';
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  IconButton,
  PageHeading,
  Search,
  Tabs,
} from '@/components/ui';
import { uploadFile } from '@/lib/client';
import { wordRequirement } from '@/lib/assignment-policy';
import type { Assignment, Attachment, Classroom, Lesson, Submission } from '@/lib/types';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
const initials = (s: string) =>
  s
    .split(' ')
    .slice(-2)
    .map((x) => x[0])
    .join('');
const date = (s?: string) =>
  s
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(s))
    : '—';
function useQuery() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return {
    params,
    set: (key: string, value: string) => {
      const p = new URLSearchParams(params.toString());
      if (value) p.set(key, value);
      else p.delete(key);
      if (['q', 'status', 'class', 'assignment'].includes(key)) p.delete('page');
      if (key === 'class') {
        p.delete('lesson');
        p.delete('assignment');
      }
      router.replace(`${path}?${p}`, { scroll: false });
    },
  };
}
function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}
function FormActions({
  busy,
  onClose,
  label = 'Lưu thay đổi',
}: {
  busy: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="dialog-footer">
      <Button type="button" variant="secondary" onClick={onClose}>
        Hủy bỏ
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? 'Đang lưu…' : label}
      </Button>
    </div>
  );
}

export function TeacherClasses() {
  const { state, action } = useLms();
  const { params, set } = useQuery();
  const search = params.get('q') || '';
  const setSearch = (v: string) => set('q', v);
  const [edit, setEdit] = useState<Classroom | 'new' | null>(null);
  const [members, setMembers] = useState<Classroom | null>(null);
  const [memberTab, setMemberTab] = useState('APPROVED');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<Classroom | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const classes = state.classes.filter((c) => c.teacherId === state.user.id);
  const status = params.get('status') || 'ACTIVE';
  const visible = classes.filter(
    (c) => c.status === status && norm(`${c.title} ${c.code}`).includes(norm(search)),
  );
  const approved = state.enrollments.filter((e) => e.status === 'APPROVED');
  const pending = state.enrollments.filter((e) => e.status === 'PENDING');
  async function run(name: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await action(name, payload);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
    } catch {
      setError('Không thể sao chép. Vui lòng chọn và sao chép mã lớp.');
    }
  }
  const memberRows = state.enrollments.filter(
    (e) =>
      e.classId === members?.id &&
      e.status === memberTab &&
      norm(state.users.find((u) => u.id === e.userId)?.name || '').includes(norm(memberSearch)),
  );
  return (
    <div className="stack">
      <PageHeading
        title="Lớp giảng dạy"
        description="Quản lý giảng đường, học viên và chương trình học của bạn."
        actions={
          <Button
            onClick={() => {
              setEdit('new');
              setError('');
            }}
          >
            <Plus size={18} />
            Tạo lớp học
          </Button>
        }
      />
      <div className="stat-row">
        <div className="stat">
          <strong>{classes.filter((c) => c.status === 'ACTIVE').length}</strong>
          <span>Lớp đang giảng dạy</span>
        </div>
        <div className="stat">
          <strong>{approved.length}</strong>
          <span>Học viên chính thức</span>
        </div>
        <div className="stat">
          <strong>{pending.length}</strong>
          <span>Yêu cầu chờ duyệt</span>
        </div>
        <div className="stat">
          <strong>
            {state.lessons.filter((l) => l.published).length}
            <small> / {state.lessons.length}</small>
          </strong>
          <span>Bài giảng đã xuất bản</span>
        </div>
      </div>
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={(v) => set('status', v)}
          items={[
            {
              id: 'ACTIVE',
              label: 'Đang giảng dạy',
              count: classes.filter((c) => c.status === 'ACTIVE').length,
            },
            {
              id: 'ARCHIVED',
              label: 'Đã lưu trữ',
              count: classes.filter((c) => c.status === 'ARCHIVED').length,
            },
          ]}
        />
        <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã lớp học…" />
      </div>
      <ErrorLine error={!edit && !members && !confirmDelete ? error : ''} />
      {!visible.length ? (
        <Empty
          title={search ? 'Không tìm thấy lớp học' : 'Chưa có lớp học trong danh mục này'}
          description={
            search
              ? 'Thử tìm bằng tên hoặc mã lớp khác.'
              : 'Tạo một giảng đường để bắt đầu chia sẻ bài học.'
          }
        >
          <Button onClick={() => setEdit('new')}>Tạo lớp học</Button>
        </Empty>
      ) : (
        <div className="teacher-class-grid">
          {visible.map((c) => {
            const count = approved.filter((e) => e.classId === c.id).length;
            const waiting = pending.filter((e) => e.classId === c.id).length;
            const lessons = state.lessons.filter((l) => l.classId === c.id);
            return (
              <article className="class-card teacher-class-card" key={c.id}>
                <div className="class-cover">
                  <div className="row">
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {c.status === 'ACTIVE' ? 'Đang giảng dạy' : 'Đã lưu trữ'}
                    </Badge>
                    <IconButton label="Cài đặt lớp học" onClick={() => setEdit(c)}>
                      <Settings2 size={18} />
                    </IconButton>
                  </div>
                  <h2>{c.title}</h2>
                  <p>{c.description}</p>
                </div>
                <div className="class-body stack">
                  <div className="row">
                    <span className="muted small">Mã tham gia</span>
                    <button
                      className="class-code"
                      onClick={() => copy(c.code)}
                      title="Sao chép mã lớp"
                    >
                      {c.code}
                      <Copy size={15} />
                    </button>
                  </div>
                  {copied === c.code && (
                    <span className="small muted" role="status">
                      Đã sao chép mã lớp
                    </span>
                  )}
                  <div className="teacher-card-facts">
                    <div>
                      <Users size={18} />
                      <span>
                        Sĩ số học viên
                        <strong>
                          {count} / {c.capacity}
                        </strong>
                      </span>
                    </div>
                    <div>
                      <BookOpen size={18} />
                      <span>
                        Bài giảng
                        <strong>
                          {lessons.filter((l) => l.published).length} / {lessons.length} xuất bản
                        </strong>
                      </span>
                    </div>
                  </div>
                  <progress
                    className="progress"
                    value={count}
                    max={c.capacity}
                    aria-label="Sĩ số lớp học"
                  />
                  <p className="small muted">{c.schedule || 'Chưa thiết lập lịch học'}</p>
                  <div className="row small">
                    <span>Nhận học viên: {c.enrollmentOpen ? 'Đang mở' : 'Đã đóng'}</span>
                    <span>{c.autoApprove ? 'Tự động duyệt' : 'Duyệt thủ công'}</span>
                  </div>
                  <div className="inline-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMembers(c);
                        setMemberTab(waiting ? 'PENDING' : 'APPROVED');
                        setMemberPage(1);
                        setError('');
                      }}
                    >
                      <Users size={16} />
                      Thành viên ({count}){waiting > 0 && <Badge tone="warning">+{waiting}</Badge>}
                    </Button>
                    <Button variant="ghost" onClick={() => setEdit(c)}>
                      <Settings2 size={16} />
                      Cài đặt
                    </Button>
                  </div>
                  <Link className="button secondary" href={`/classes/${c.id}`}>
                    Xem lớp học
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Dialog
        open={!!edit}
        title={edit === 'new' ? 'Tạo lớp học mới' : 'Cài đặt lớp học'}
        onClose={() => setEdit(null)}
        wide
      >
        {edit && (
          <ClassForm
            key={edit === 'new' ? 'new' : edit.id}
            classroom={edit === 'new' ? undefined : edit}
            busy={busy}
            error={error}
            onClose={() => setEdit(null)}
            onSave={async (data) => {
              if (
                await run(edit === 'new' ? 'createClass' : 'updateClass', {
                  ...data,
                  ...(edit === 'new' ? {} : { classId: edit.id }),
                })
              )
                setEdit(null);
            }}
            onArchive={
              edit === 'new'
                ? undefined
                : async () => {
                    if (
                      await run('archiveClass', {
                        classId: edit.id,
                        archived: edit.status !== 'ARCHIVED',
                      })
                    )
                      setEdit(null);
                  }
            }
            onRegenerate={
              edit === 'new'
                ? undefined
                : async () => {
                    if (await run('regenerateCode', { classId: edit.id })) setEdit(null);
                  }
            }
            onDelete={
              edit === 'new'
                ? undefined
                : () => {
                    setConfirmDelete(edit);
                    setEdit(null);
                    setDeleteCode('');
                  }
            }
          />
        )}
      </Dialog>
      <Dialog open={!!confirmDelete} title="Xóa lớp học" onClose={() => setConfirmDelete(null)}>
        {confirmDelete && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run('deleteClass', { classId: confirmDelete.id, code: deleteCode }))
                setConfirmDelete(null);
            }}
            className="stack"
          >
            <p>
              Dữ liệu bài giảng, bài nộp và tiến độ của lớp sẽ bị xóa. Nhập chính xác{' '}
              <strong>{confirmDelete.code}</strong> để xác nhận.
            </p>
            <Field label="Mã xác nhận">
              <input
                value={deleteCode}
                onChange={(e) => setDeleteCode(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            <ErrorLine error={error} />
            <div className="dialog-footer">
              <Button variant="secondary" type="button" onClick={() => setConfirmDelete(null)}>
                Giữ lại lớp
              </Button>
              <Button
                variant="danger"
                disabled={busy || deleteCode !== confirmDelete.code}
                type="submit"
              >
                Xác nhận xóa
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!members}
        title={`Thành viên lớp ${members?.code || ''}`}
        onClose={() => setMembers(null)}
        wide
      >
        <div className="stack">
          <div className="toolbar">
            <Tabs
              value={memberTab}
              onChange={(v) => {
                setMemberTab(v);
                setMemberPage(1);
              }}
              items={[
                {
                  id: 'APPROVED',
                  label: 'Chính thức',
                  count: approved.filter((e) => e.classId === members?.id).length,
                },
                {
                  id: 'PENDING',
                  label: 'Chờ duyệt',
                  count: pending.filter((e) => e.classId === members?.id).length,
                },
              ]}
            />
            <Search
              value={memberSearch}
              onChange={(v) => {
                setMemberSearch(v);
                setMemberPage(1);
              }}
              placeholder="Tìm tên học viên…"
            />
          </div>
          <ErrorLine error={error} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Học viên</th>
                  <th>Ngày tham gia</th>
                  <th>{memberTab === 'PENDING' ? 'Xét duyệt' : 'Nhóm học tập'}</th>
                </tr>
              </thead>
              <tbody>
                {memberRows.slice((memberPage - 1) * 8, memberPage * 8).map((e) => {
                  const u = state.users.find((u) => u.id === e.userId);
                  return (
                    <tr key={e.id}>
                      <td>
                        <div className="member-name">
                          <span className="avatar">{initials(u?.name || '?')}</span>
                          <span>
                            {u?.name}
                            <small className="muted">{u?.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>{date(e.joinedAt)}</td>
                      <td>
                        {memberTab === 'PENDING' ? (
                          <div className="inline-actions">
                            <Button
                              disabled={busy}
                              onClick={() => run('approveEnrollment', { enrollmentId: e.id })}
                            >
                              Duyệt
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => run('rejectEnrollment', { enrollmentId: e.id })}
                            >
                              Từ chối
                            </Button>
                          </div>
                        ) : (
                          <Badge>Nhóm {e.group}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!memberRows.length && (
            <Empty
              title="Danh sách trống"
              description={
                memberTab === 'PENDING'
                  ? 'Không có yêu cầu tham gia đang chờ xét duyệt.'
                  : 'Chia sẻ mã lớp để học viên tham gia.'
              }
            />
          )}
          <div className="row small">
            <span className="muted">{memberRows.length} học viên</span>
            <div className="inline-actions">
              <IconButton
                label="Trang trước"
                disabled={memberPage === 1}
                onClick={() => setMemberPage((p) => p - 1)}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <span>
                {memberPage} / {Math.max(1, Math.ceil(memberRows.length / 8))}
              </span>
              <IconButton
                label="Trang sau"
                disabled={memberPage * 8 >= memberRows.length}
                onClick={() => setMemberPage((p) => p + 1)}
              >
                <ChevronRight size={18} />
              </IconButton>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ClassForm({
  classroom,
  busy,
  error,
  onClose,
  onSave,
  onArchive,
  onDelete,
  onRegenerate,
}: {
  classroom?: Classroom;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onRegenerate?: () => void;
}) {
  const [title, setTitle] = useState(classroom?.title || '');
  const [description, setDescription] = useState(classroom?.description || '');
  const [contentAuthor, setContentAuthor] = useState(classroom?.contentAuthor || '');
  const [capacity, setCapacity] = useState(classroom?.capacity || 50);
  const [schedule, setSchedule] = useState(classroom?.schedule || '');
  const [autoApprove, setAutoApprove] = useState(classroom?.autoApprove || false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(classroom?.enrollmentOpen ?? true);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title,
          description,
          contentAuthor,
          capacity,
          schedule,
          autoApprove,
          enrollmentOpen,
        });
      }}
    >
      <Field label="Tên lớp học (bắt buộc)">
        <input required maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Mô tả lớp học">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
      <Field
        label="Người giảng nội dung"
        hint="Tên người trình bày bài giảng. Để trống nếu không cần hiển thị."
      >
        <input
          value={contentAuthor}
          aria-label="Người giảng nội dung"
          onChange={(e) => setContentAuthor(e.target.value)}
          maxLength={200}
        />
      </Field>
      <div className="two-col">
        <Field label="Sĩ số tối đa (1–500)">
          <input
            type="number"
            required
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </Field>
        <Field label="Lịch học">
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="Tối Chủ nhật, 19:30"
          />
        </Field>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={enrollmentOpen}
          onChange={(e) => setEnrollmentOpen(e.target.checked)}
        />
        Mở nhận học viên mới
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
        />
        Tự động duyệt khi nhập đúng mã lớp
      </label>
      {classroom && (
        <>
          <div className="setting-divider row">
            <span>
              Mã lớp: <strong>{classroom.code}</strong>
            </span>
            <Button variant="secondary" type="button" onClick={onRegenerate} disabled={busy}>
              <RefreshCw size={15} />
              Đổi mã mới
            </Button>
          </div>
          <p className="small muted">
            Mã cũ hết hiệu lực ngay khi đổi. Học viên đã tham gia được giữ nguyên.
          </p>
          <div className="row setting-divider">
            <span>
              <strong>
                {classroom.status === 'ARCHIVED' ? 'Khôi phục giảng đường' : 'Lưu trữ giảng đường'}
              </strong>
              <small className="muted">Bảo toàn dữ liệu học tập của lớp.</small>
            </span>
            <Button variant="secondary" type="button" disabled={busy} onClick={onArchive}>
              <Archive size={16} />
              {classroom.status === 'ARCHIVED' ? 'Khôi phục' : 'Lưu trữ'}
            </Button>
          </div>
          <div className="row setting-divider">
            <span>
              <strong>Xóa lớp học</strong>
              <small className="muted">Thao tác xóa cần xác nhận mã lớp.</small>
            </span>
            <Button variant="danger" type="button" onClick={onDelete}>
              <Trash2 size={16} />
              Xóa lớp
            </Button>
          </div>
        </>
      )}
      <ErrorLine error={error} />
      <FormActions
        busy={busy}
        onClose={onClose}
        label={classroom ? 'Lưu thay đổi' : 'Tạo lớp học'}
      />
    </form>
  );
}

export function TeacherLessons() {
  const { state, action } = useLms();
  const { params, set } = useQuery();
  const classes = state.classes.filter((c) => c.teacherId === state.user.id);
  const classId = params.get('class') || classes[0]?.id || '';
  const lessons = state.lessons
    .filter((l) => l.classId === classId)
    .sort((a, b) => a.order - b.order);
  const chosen = params.get('lesson');
  const [defaultSelection, setDefaultSelection] = useState<{ classId: string; id: string } | null>(
    null,
  );
  const selectedId = chosen || (defaultSelection?.classId === classId ? defaultSelection.id : null);
  const selected = selectedId
    ? lessons.find((l) => l.id === selectedId)
    : lessons.find((l) => !l.published) || lessons[0];
  useEffect(() => {
    if (!chosen && selected && !selectedId) {
      setDefaultSelection({ classId, id: selected.id });
    }
  }, [chosen, classId, selected?.id, selectedId]);
  const [creating, setCreating] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const canSwitch = () =>
    !editorDirty ||
    window.confirm('Bài giảng có thay đổi chưa lưu. Bạn muốn bỏ thay đổi và chuyển bài?');
  const search = params.get('q') || '';
  const setSearch = (v: string) => set('q', v);
  const filter = params.get('status') || 'all';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = lessons.filter(
    (l) =>
      norm(l.title).includes(norm(search)) &&
      (filter === 'all' || (filter === 'published' ? l.published : !l.published)),
  );
  const chapters = [...new Set(visible.map((l) => l.chapter))];
  async function save(data: Record<string, unknown>) {
    setError('');
    setBusy(true);
    try {
      const result = (await action('saveLesson', {
        ...data,
        classId,
        ...(creating ? {} : { lessonId: selected?.id }),
      })) as { id?: string } | undefined;
      setCreating(false);
      if (result?.id) set('lesson', result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <PageHeading
        title="Kho bài giảng"
        description="Sắp xếp chương trình học, biên tập video và xuất bản học liệu."
        actions={
          <select
            className="teacher-class-select"
            aria-label="Chọn lớp học"
            value={classId}
            onChange={(e) => {
              if (canSwitch()) {
                set('class', e.target.value);
                setCreating(false);
                setEditorDirty(false);
              }
            }}
          >
            {classes.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        }
      />
      {!classes.length ? (
        <Empty title="Chưa có lớp giảng dạy" description="Tạo một lớp trước khi thêm bài học.">
          <Link href="/teacher/classes" className="button primary">
            Quản lý lớp
          </Link>
        </Empty>
      ) : (
        <div className="teacher-layout">
          <aside className="stack">
            <Button
              onClick={() => {
                if (canSwitch()) {
                  setCreating(true);
                  setError('');
                  setEditorDirty(false);
                }
              }}
            >
              <Plus size={18} />
              Thêm bài giảng
            </Button>
            <Search value={search} onChange={setSearch} placeholder="Tìm bài giảng…" />
            <Tabs
              value={filter}
              onChange={(v) => set('status', v)}
              items={[
                { id: 'all', label: 'Tất cả', count: lessons.length },
                {
                  id: 'published',
                  label: 'Đã xuất bản',
                  count: lessons.filter((l) => l.published).length,
                },
                {
                  id: 'draft',
                  label: 'Bản nháp',
                  count: lessons.filter((l) => !l.published).length,
                },
              ]}
            />
            <div className="lesson-library">
              {chapters.map((ch) => (
                <section key={ch}>
                  <h2>
                    <FolderOpen size={17} />
                    {ch}
                  </h2>
                  {visible
                    .filter((l) => l.chapter === ch)
                    .map((l) => (
                      <button
                        className={`library-lesson ${!creating && selected?.id === l.id ? 'selected' : ''}`}
                        key={l.id}
                        onClick={() => {
                          if (canSwitch()) {
                            set('lesson', l.id);
                            setCreating(false);
                            setError('');
                            setEditorDirty(false);
                          }
                        }}
                      >
                        <div className="row">
                          <span className="small">Bài {l.order.toString().padStart(2, '0')}</span>
                          <Badge tone={l.published ? 'success' : 'warning'}>
                            {l.published ? 'Đã xuất bản' : 'Bản nháp'}
                          </Badge>
                        </div>
                        <strong>{l.title.replace(/^Bài\s*\d+\s*:\s*/i, '')}</strong>
                        <span className="muted small">
                          {l.videoUrl ? `${l.duration || 'Đã gắn video'}` : 'Chưa gắn video'}
                        </span>
                      </button>
                    ))}
                </section>
              ))}
            </div>
            {!visible.length && <p className="muted small">Chưa có bài giảng phù hợp.</p>}
          </aside>
          <div>
            {creating || selected ? (
              <LessonEditor
                key={creating ? `new-${classId}` : selected?.id}
                lesson={creating ? undefined : selected}
                classId={classId}
                nextOrder={Math.max(0, ...lessons.map((l) => l.order)) + 1}
                onDirty={setEditorDirty}
                busy={busy}
                error={error}
                onSave={save}
                onDelete={async () => {
                  if (!selected) return;
                  setBusy(true);
                  setError('');
                  try {
                    await action('deleteLesson', { lessonId: selected.id });
                    setCreating(false);
                    setDefaultSelection(null);
                    setEditorDirty(false);
                    set('lesson', '');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : (
              <Empty
                title={selectedId ? 'Bài giảng không còn trong lớp' : 'Chương trình học đang trống'}
                description={
                  selectedId
                    ? 'Bài giảng đã được xóa. Chọn một bài khác hoặc thêm bài giảng mới.'
                    : 'Thêm bài đầu tiên để bắt đầu xây dựng học liệu.'
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function youtubeId(value: string) {
  try {
    const u = new URL(value);
    if (u.hostname === 'youtu.be')
      return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : '';
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)) {
      const id = u.searchParams.get('v') || u.pathname.split('/').pop() || '';
      return /^[\w-]{11}$/.test(id) ? id : '';
    }
  } catch {}
  return '';
}
function LessonEditor({
  lesson,
  classId,
  nextOrder,
  onDirty,
  busy,
  error,
  onSave,
  onDelete,
}: {
  lesson?: Lesson;
  classId: string;
  nextOrder: number;
  onDirty: (dirty: boolean) => void;
  busy: boolean;
  error: string;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const { state } = useLms();
  const [title, setTitle] = useState(lesson?.title || '');
  const [chapter, setChapter] = useState(lesson?.chapter || '');
  const [order, setOrder] = useState(lesson?.order || nextOrder);
  const [description, setDescription] = useState(lesson?.description || '');
  const [videoType, setVideoType] = useState<'YOUTUBE' | 'UPLOAD'>(lesson?.videoType || 'YOUTUBE');
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl || '');
  const [videoFileId, setVideoFileId] = useState(lesson?.videoFileId || '');
  const [duration, setDuration] = useState(lesson?.duration || '');
  const [timestamps, setTimestamps] = useState(lesson?.timestamps || []);
  const [documents, setDocuments] = useState<Attachment[]>(lesson?.documents || []);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  async function upload(file: File | undefined, kind: 'video' | 'document') {
    if (!file) return;
    setUploading(true);
    setLocalError('');
    try {
      const a = await uploadFile(file, classId, kind);
      if (kind === 'video') {
        setVideoFileId(a.id);
        setVideoUrl(a.url || '');
      } else setDocuments((d) => [...d, a]);
      setDirty(true);
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const data = {
    title,
    chapter,
    order,
    description,
    videoType,
    videoUrl,
    videoFileId: videoFileId || undefined,
    duration,
    timestamps,
    documents,
  };
  const related = state.assignments.filter((a) => a.lessonId === lesson?.id);
  return (
    <section className="panel editor">
      <div className="editor-heading">
        <div>
          <h2>{lesson ? 'Biên tập bài giảng' : 'Bài giảng mới'}</h2>
          <p className="small">{lesson?.title || 'Xây dựng một bài học ý nghĩa cho học viên.'}</p>
        </div>
        <Badge tone={lesson?.published ? 'success' : 'warning'}>
          {lesson?.published ? 'Đã xuất bản' : 'Bản nháp'}
        </Badge>
      </div>
      <form
        className="stack editor-body"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          setDirty(false);
          onSave({ ...data, published: false });
        }}
      >
        <section className="video-source stack">
          <div className="toolbar">
            <h3>
              <Video size={18} />
              Nguồn video bài giảng
            </h3>
            <Tabs
              value={videoType}
              onChange={(v) => {
                setVideoType(v as typeof videoType);
                setVideoUrl('');
                setVideoFileId('');
                setDirty(true);
              }}
              items={[
                { id: 'YOUTUBE', label: 'YouTube' },
                { id: 'UPLOAD', label: 'Tải video' },
              ]}
            />
          </div>
          {videoType === 'YOUTUBE' ? (
            <>
              <Field label="Liên kết YouTube">
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </Field>
              {videoUrl && (
                <p className={youtubeId(videoUrl) ? 'small success-text' : 'error small'}>
                  {youtubeId(videoUrl)
                    ? 'Định dạng liên kết YouTube hợp lệ.'
                    : 'Nhập liên kết video YouTube hợp lệ.'}
                </p>
              )}
            </>
          ) : (
            <Field
              label="Chọn video MP4 hoặc WebM"
              hint="Tối đa 2 GB. Tệp được tải trực tiếp lên S3/R2."
            >
              <input
                type="file"
                accept="video/mp4,video/webm"
                disabled={uploading}
                onChange={(e) => upload(e.target.files?.[0], 'video')}
              />
            </Field>
          )}
          {!videoUrl && (
            <div className="video-empty">
              <Video size={30} />
              <strong>Chưa có nguồn video</strong>
              <p className="small muted">
                Thêm video để xuất bản bài học. Bạn có thể lưu bản nháp trước.
              </p>
            </div>
          )}
          {videoType === 'UPLOAD' && videoFileId && (
            <p className="small success-text">Video đã được lưu vào kho tệp.</p>
          )}
        </section>
        <div className="lesson-title-fields">
          <Field label="Tiêu đề bài giảng (bắt buộc)">
            <input
              required
              value={title}
              maxLength={180}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Thứ tự">
            <input
              type="number"
              min={1}
              max={999}
              required
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="two-col">
          <Field label="Chương mục">
            <input
              required
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              list="chapter-options"
              placeholder="Nhập chương mục của bài giảng"
            />
            <datalist id="chapter-options">
              {[
                ...new Set(
                  state.lessons.filter((l) => l.classId === classId).map((l) => l.chapter),
                ),
              ]
                .filter(Boolean)
                .map((value) => (
                  <option key={value} value={value} />
                ))}
            </datalist>
          </Field>
          <Field label="Thời lượng">
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="42:10"
            />
          </Field>
        </div>
        <Field label="Mô tả bài học">
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <section className="stack">
          <div className="row">
            <h3>Mốc thời gian trọng tâm</h3>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTimestamps((t) => [...t, { time: '00:00', title: '' }])}
            >
              <Plus size={16} />
              Thêm mốc
            </Button>
          </div>
          {timestamps.map((t, i) => (
            <div className="timestamp-row" key={i}>
              <input
                aria-label={`Thời gian mốc ${i + 1}`}
                value={t.time}
                pattern="[0-9]{1,3}:[0-5][0-9]"
                placeholder="00:00"
                onChange={(e) =>
                  setTimestamps((ts) =>
                    ts.map((a, j) => (j === i ? { ...a, time: e.target.value } : a)),
                  )
                }
              />
              <input
                aria-label={`Tiêu đề mốc ${i + 1}`}
                value={t.title}
                placeholder="Tên phân đoạn"
                onChange={(e) =>
                  setTimestamps((ts) =>
                    ts.map((a, j) => (j === i ? { ...a, title: e.target.value } : a)),
                  )
                }
              />
              <IconButton
                type="button"
                label="Xóa mốc"
                onClick={() => setTimestamps((ts) => ts.filter((_, j) => j !== i))}
              >
                <X size={17} />
              </IconButton>
            </div>
          ))}
        </section>
        <section className="stack setting-divider">
          <h3>Tài liệu đính kèm</h3>
          {documents.length ? (
            documents.map((a) => (
              <div className="row small" key={a.id}>
                <span>
                  <FileText size={16} />
                  {a.name}
                </span>
                <IconButton
                  type="button"
                  label="Gỡ tài liệu"
                  onClick={() => setDocuments((d) => d.filter((x) => x.id !== a.id))}
                >
                  <X size={16} />
                </IconButton>
              </div>
            ))
          ) : (
            <p className="small muted">Chưa có tài liệu đính kèm.</p>
          )}
          <Field label="Tải học liệu lên">
            <input
              type="file"
              accept=".pdf,.docx,.jpg,.jpeg,.png"
              disabled={uploading}
              onChange={(e) => upload(e.target.files?.[0], 'document')}
            />
          </Field>
        </section>
        {related.length > 0 && (
          <section className="setting-divider">
            <h3>Bài tập liên quan</h3>
            {related.map((a) => (
              <Link
                className="list-row"
                href={`/teacher/assignments?assignment=${a.id}&class=${classId}`}
                key={a.id}
              >
                <ClipboardCheck size={18} />
                <span>
                  {a.title}
                  <small className="muted">Hạn nộp: {date(a.dueAt)} (GMT+7)</small>
                </span>
              </Link>
            ))}
          </section>
        )}
        <ErrorLine error={localError || error} />
        {uploading && (
          <p role="status" className="notice">
            Đang tải tệp lên kho lưu trữ…
          </p>
        )}
        <div className="lesson-editor-actions">
          <div>
            {lesson && (
              <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 size={16} />
                Xóa bài
              </Button>
            )}
          </div>
          <div className="inline-actions">
            <Button variant="secondary" type="submit" disabled={busy || uploading}>
              <Save size={16} />
              Lưu nháp
            </Button>
            <Button variant="ghost" type="button" onClick={() => setPreview(true)}>
              Xem trước
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                uploading ||
                !title.trim() ||
                !chapter.trim() ||
                (!videoUrl && !videoFileId) ||
                (videoType === 'YOUTUBE' && !youtubeId(videoUrl))
              }
              onClick={() => {
                setDirty(false);
                onSave({ ...data, published: true });
              }}
            >
              <Check size={16} />
              Xuất bản
            </Button>
          </div>
        </div>
      </form>
      <Dialog
        open={preview}
        title={title || 'Xem trước bài giảng'}
        onClose={() => setPreview(false)}
        wide
      >
        <div className="stack">
          {videoType === 'YOUTUBE' && youtubeId(videoUrl) ? (
            <iframe
              className="video-preview"
              src={`https://www.youtube-nocookie.com/embed/${youtubeId(videoUrl)}`}
              title={title}
              allowFullScreen
            />
          ) : videoType === 'UPLOAD' && videoUrl ? (
            <video className="video-preview" poster="/video-poster.svg" controls src={videoUrl} />
          ) : (
            <Empty title="Chưa có video" description="Bổ sung nguồn video trước khi xuất bản." />
          )}
          <p>{description}</p>
        </div>
      </Dialog>
      <Dialog open={deleting} title="Xóa bài giảng?" onClose={() => setDeleting(false)}>
        <p>Bài giảng sẽ được gỡ khỏi lớp. Thao tác này không thể hoàn tác.</p>
        <div className="dialog-footer">
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Giữ lại
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setDeleting(false);
              setDirty(false);
              onDelete();
            }}
          >
            Xác nhận xóa
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function TeacherAssignments() {
  const { state, action } = useLms();
  const { params, set } = useQuery();
  const classes = state.classes.filter((c) => c.teacherId === state.user.id);
  const classId = params.get('class') || classes[0]?.id || '';
  const assignments = state.assignments.filter((a) => a.classId === classId);
  const assignment = assignments.find((a) => a.id === params.get('assignment')) || assignments[0];
  const search = params.get('q') || '';
  const setSearch = (v: string) => set('q', v);
  const filter = params.get('status') || 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = (value: number | ((current: number) => number)) =>
    set('page', String(typeof value === 'function' ? value(page) : value));
  const [gradingId, setGradingId] = useState<string | null>(null);
  const grading = state.submissions.find((s) => s.id === gradingId);
  const [gradingDirty, setGradingDirty] = useState(false);
  const [editor, setEditor] = useState<{ classId: string; assignment?: Assignment } | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const [deleteTitle, setDeleteTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const enrolled = state.enrollments.filter(
    (e) => e.classId === classId && e.status === 'APPROVED',
  );
  const submissions = state.submissions.filter(
    (s) => s.assignmentId === assignment?.id && s.status !== 'DRAFT',
  );
  const graded = submissions.filter((s) => s.status === 'GRADED');
  const rows = enrolled
    .map((e) => ({
      user: state.users.find((u) => u.id === e.userId),
      submission: submissions.find((s) => s.studentId === e.userId),
    }))
    .filter(
      (r) =>
        r.user &&
        norm(r.user.name).includes(norm(search)) &&
        (filter === 'all' ||
          (filter === 'pending' && r.submission?.status === 'SUBMITTED') ||
          (filter === 'graded' && r.submission?.status === 'GRADED') ||
          (filter === 'missing' && !r.submission)),
    );
  async function remind(userId: string) {
    setError('');
    setBusy(true);
    try {
      const result = (await action('remindStudents', { assignmentId: assignment!.id, userId })) as {
        count: number;
      };
      setNotice(
        result.count
          ? 'Đã gửi lời nhắc vào thông báo của học viên.'
          : 'Học viên đã nộp bài hoặc không còn trong danh sách cần nhắc.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    const safe = (v: unknown) => {
      const s = String(v ?? '');
      return `"${/^[=+@-]/.test(s) ? "'" : ''}${s.replace(/"/g, '""')}"`;
    };
    const data = [
      ['Học viên', 'Email', 'Trạng thái', 'Điểm', 'Nộp lúc'],
      ...enrolled.map((e) => {
        const u = state.users.find((u) => u.id === e.userId);
        const s = submissions.find((s) => s.studentId === e.userId);
        return [
          u?.name,
          u?.email,
          s?.status === 'GRADED' ? 'Đã chấm' : s ? 'Chờ chấm' : 'Chưa nộp',
          s?.score ?? '',
          date(s?.submittedAt),
        ];
      }),
    ]
      .map((r) => r.map(safe).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + data], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `bang-diem-${state.classes.find((c) => c.id === classId)?.code || 'lop'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="stack">
      <PageHeading
        title="Chấm bài & phản hồi"
        description="Đọc bài cảm nhận, đánh giá theo tiêu chí và đồng hành cùng học viên."
        actions={
          <div className="inline-actions">
            <Button variant="secondary" onClick={exportCsv} disabled={!assignment}>
              <Download size={16} />
              Xuất bảng điểm
            </Button>
            <Button
              onClick={() => {
                setEditor({ classId });
                setError('');
              }}
              disabled={!classId}
            >
              <Plus size={17} />
              Giao bài tập
            </Button>
          </div>
        }
      />
      <div className="toolbar">
        <Field label="Lớp học">
          <select value={classId} onChange={(e) => set('class', e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bài tập">
          <select value={assignment?.id || ''} onChange={(e) => set('assignment', e.target.value)}>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </Field>
        {assignment && <p className="small muted">Hạn nộp: {date(assignment.dueAt)} (GMT+7)</p>}
      </div>
      <ErrorLine error={error} />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="panel stack">
        <div className="section-heading">
          <h2>Bài tập đã giao</h2>
          <span className="small muted">{assignments.length} bài tập</span>
        </div>
        {assignments.length > 0 ? (
          <div className="table-wrap">
            <table className="table" aria-label="Quản lý bài tập đã giao">
              <thead>
                <tr>
                  <th>Bài tập</th>
                  <th>Hạn nộp (GMT+7)</th>
                  <th>Yêu cầu số từ</th>
                  <th>Đã nộp</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <small className="muted">
                        {state.lessons.find((l) => l.id === a.lessonId)?.title ||
                          'Không gắn bài học'}
                      </small>
                    </td>
                    <td>{date(a.dueAt)}</td>
                    <td>{wordRequirement(a)}</td>
                    <td>
                      {
                        state.submissions.filter(
                          (s) => s.assignmentId === a.id && s.status !== 'DRAFT',
                        ).length
                      }
                      /{enrolled.length}
                    </td>
                    <td>
                      <div className="inline-actions">
                        <Button
                          variant={a.id === assignment?.id ? 'secondary' : 'ghost'}
                          aria-pressed={a.id === assignment?.id}
                          onClick={() => set('assignment', a.id)}
                        >
                          Xem bài nộp
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setError('');
                            setEditor({ classId, assignment: a });
                          }}
                        >
                          <Edit3 size={15} />
                          Sửa bài tập
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            setError('');
                            setDeleteTitle('');
                            setDeleting(a);
                          }}
                        >
                          <Trash2 size={15} />
                          Xóa bài tập
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Chưa có bài tập trong lớp này.</p>
        )}
      </section>
      {assignment ? (
        <>
          <h2>Bài đang theo dõi: {assignment.title}</h2>
          <div className="stat-row">
            <div className="stat">
              <strong>
                {submissions.length}
                <small> / {enrolled.length}</small>
              </strong>
              <span>Học viên đã nộp</span>
            </div>
            <div className="stat">
              <strong>{graded.length}</strong>
              <span>Đã chấm điểm</span>
            </div>
            <div className="stat">
              <strong>{submissions.length - graded.length}</strong>
              <span>Bài cần chấm</span>
            </div>
            <div className="stat">
              <strong>{enrolled.length - submissions.length}</strong>
              <span>Học viên chưa nộp</span>
            </div>
            <div className="stat">
              <strong>
                {graded.length
                  ? (graded.reduce((sum, s) => sum + (s.score || 0), 0) / graded.length).toFixed(1)
                  : '—'}
              </strong>
              <span>Điểm trung bình / 100</span>
            </div>
          </div>
          <section className="panel stack">
            <div className="toolbar">
              <Tabs
                value={filter}
                onChange={(v) => {
                  set('status', v);
                }}
                items={[
                  { id: 'all', label: 'Tất cả', count: enrolled.length },
                  { id: 'pending', label: 'Cần chấm', count: submissions.length - graded.length },
                  { id: 'graded', label: 'Đã chấm', count: graded.length },
                  { id: 'missing', label: 'Chưa nộp', count: enrolled.length - submissions.length },
                ]}
              />
              <Search
                value={search}
                onChange={(v) => {
                  setSearch(v);
                }}
                placeholder="Tìm tên học viên…"
              />
            </div>
            <div className="table-wrap">
              <table
                className="table grade-table"
                role="table"
                aria-label="Theo dõi và chấm bài học viên"
              >
                <thead>
                  <tr>
                    <th scope="col">Học viên</th>
                    <th scope="col">Thời gian nộp</th>
                    <th scope="col">Bài làm</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Điểm</th>
                    <th scope="col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((page - 1) * 8, page * 8).map(({ user: u, submission: s }) => (
                    <tr key={u!.id}>
                      <td data-label="Học viên">
                        <div className="member-name">
                          <span className="avatar">{initials(u!.name)}</span>
                          <span>
                            {u!.name}
                            <small className="muted">{u!.email}</small>
                          </span>
                        </div>
                      </td>
                      <td data-label="Thời gian nộp">
                        {date(s?.submittedAt)}
                        {s?.submittedAt && (
                          <small
                            className={
                              new Date(s.submittedAt) > new Date(assignment.dueAt)
                                ? 'error'
                                : 'muted'
                            }
                          >
                            {new Date(s.submittedAt) > new Date(assignment.dueAt)
                              ? 'Nộp muộn'
                              : 'Đúng hạn'}
                          </small>
                        )}
                      </td>
                      <td data-label="Bài làm">
                        {s ? (
                          <span className="small">
                            {s.attachments.length
                              ? `${s.attachments.length} tệp đính kèm`
                              : 'Bài viết trực tiếp'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Trạng thái">
                        <Badge
                          tone={s?.status === 'GRADED' ? 'success' : s ? 'warning' : 'neutral'}
                        >
                          {s?.status === 'GRADED' ? 'Đã chấm' : s ? 'Chờ chấm' : 'Chưa nộp'}
                        </Badge>
                      </td>
                      <td data-label="Điểm">
                        <strong>{s?.score ?? '—'}</strong>
                      </td>
                      <td data-label="Thao tác">
                        {s ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setGradingId(s.id);
                              setGradingDirty(false);
                            }}
                          >
                            {s.status === 'GRADED' ? 'Xem lại' : 'Chấm bài'}
                          </Button>
                        ) : (
                          <Button variant="ghost" disabled={busy} onClick={() => remind(u!.id)}>
                            Nhắc nộp
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <Empty
                title="Không có học viên phù hợp"
                description="Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm."
              />
            )}
            <div className="row small">
              <span className="muted">{rows.length} học viên</span>
              <div className="inline-actions">
                <IconButton
                  label="Trang trước"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <span>
                  Trang {page} / {Math.max(1, Math.ceil(rows.length / 8))}
                </span>
                <IconButton
                  label="Trang sau"
                  disabled={page * 8 >= rows.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>
            </div>
          </section>
        </>
      ) : (
        <Empty
          title="Chưa giao bài tập"
          description="Tạo bài tập thực hành đầu tiên cho lớp học này."
        />
      )}
      <Dialog
        open={!!gradingId}
        title={`Bài làm của ${state.users.find((u) => u.id === grading?.studentId)?.name || 'học viên'}`}
        onClose={() => {
          if (
            !gradingDirty ||
            window.confirm('Bài chấm có thay đổi chưa lưu. Bạn muốn bỏ thay đổi và đóng?')
          )
            setGradingId(null);
        }}
        wide
      >
        {grading ? (
          <GradeForm
            key={grading.id}
            submission={grading}
            assignment={state.assignments.find((a) => a.id === grading.assignmentId)}
            onDirty={setGradingDirty}
            onClose={() => setGradingId(null)}
            onSave={async (data) => {
              await action('gradeSubmission', { submissionId: grading.id, ...data });
              setGradingId(null);
            }}
          />
        ) : (
          <Empty
            title="Bài nộp không còn khả dụng"
            description="Học viên đã thu hồi bài hoặc bài tập đã được xóa. Đóng cửa sổ để quay lại danh sách."
          >
            <Button variant="secondary" onClick={() => setGradingId(null)}>
              Đóng
            </Button>
          </Empty>
        )}
      </Dialog>
      <Dialog
        open={!!editor}
        title={editor?.assignment ? 'Sửa bài tập' : 'Giao bài tập mới'}
        onClose={() => setEditor(null)}
        wide
      >
        {editor && (
          <AssignmentForm
            key={editor.assignment?.id || `new-${editor.classId}`}
            classId={editor.classId}
            assignment={editor.assignment}
            lessons={state.lessons.filter((l) => l.classId === editor.classId)}
            onClose={() => setEditor(null)}
            onSave={async (data) => {
              const saved = (await action(
                editor.assignment ? 'updateAssignment' : 'createAssignment',
                {
                  ...data,
                  ...(editor.assignment ? { assignmentId: editor.assignment.id } : {}),
                },
              )) as Assignment;
              setEditor(null);
              set('assignment', saved.id);
              setNotice(editor.assignment ? 'Đã cập nhật bài tập.' : 'Đã giao bài tập mới.');
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        title="Xóa bài tập?"
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
      >
        {deleting && (
          <div className="stack">
            <p>
              Bạn đang xóa bài “{deleting.title}”. Các bản nháp, bài đã nộp, điểm và thông báo gắn
              với bài tập này sẽ bị xóa. Thao tác này không thể hoàn tác.
            </p>
            <Field label="Nhập tên bài tập để xác nhận">
              <input
                value={deleteTitle}
                onChange={(e) => setDeleteTitle(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <ErrorLine error={error} />
            <div className="dialog-footer">
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
                Giữ lại
              </Button>
              <Button
                variant="danger"
                disabled={busy || deleteTitle.trim() !== deleting.title}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await action('deleteAssignment', {
                      assignmentId: deleting.id,
                      confirmTitle: deleteTitle.trim(),
                    });
                    if (assignment?.id === deleting.id) set('assignment', '');
                    setDeleting(null);
                    setNotice('Đã xóa bài tập.');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Xác nhận xóa bài tập
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function GradeForm({
  submission,
  assignment,
  onDirty,
  onClose,
  onSave,
}: {
  submission: Submission;
  assignment?: Assignment;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [rubric, setRubric] = useState(
    submission.rubric || { understanding: 0, application: 0, presentation: 0 },
  );
  const [feedback, setFeedback] = useState(submission.feedback || '');
  const [openedAttempt] = useState(() => ({
    attempt: submission.attempt,
    submittedAt: submission.submittedAt,
  }));
  const submissionChanged =
    submission.attempt !== openedAttempt.attempt ||
    submission.submittedAt !== openedAttempt.submittedAt;
  const gradingBlocked = submission.status === 'DRAFT' || submissionChanged;
  const staleMessage =
    submission.status === 'DRAFT'
      ? 'Học viên đã thu hồi bài. Đóng cửa sổ và chờ bài nộp mới trước khi chấm.'
      : 'Học viên đã nộp lại bài. Đóng và mở lại bài chấm để đánh giá lần nộp mới.';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const score = rubric.understanding + rubric.application + rubric.presentation;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  async function save(publish: boolean) {
    if (gradingBlocked) {
      setError(staleMessage);
      setConfirm(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        rubric,
        feedback,
        returnGrade: publish,
        expectedAttempt: openedAttempt.attempt,
        expectedSubmittedAt: openedAttempt.submittedAt,
      });
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  const valid =
    rubric.understanding >= 0 &&
    rubric.understanding <= 40 &&
    rubric.application >= 0 &&
    rubric.application <= 40 &&
    rubric.presentation >= 0 &&
    rubric.presentation <= 20;
  return (
    <div className="stack">
      {gradingBlocked && (
        <p className="error" role="alert">
          {staleMessage}
        </p>
      )}
      <div className="grade-grid">
        <article className="submission-reading">
          <h3>Bài cảm nhận & liên hệ thực tế</h3>
          <p className="small muted">{assignment?.instructions}</p>
          <p className="submission-content">
            {submission.content || 'Bài làm được gửi trong tệp đính kèm.'}
          </p>
          {submission.link && (
            <a
              className="list-row"
              href={submission.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Mở liên kết minh chứng
            </a>
          )}
          {submission.attachments.map((a) => (
            <a
              className="list-row"
              href={a.url || `/api/files/${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              key={a.id}
            >
              <FileText size={18} />
              {a.name}
              <Download size={16} />
            </a>
          ))}
          <p className="small muted">Nộp lúc {date(submission.submittedAt)} (GMT+7)</p>
        </article>
        <form
          className="stack"
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            if (!gradingBlocked) setConfirm(true);
          }}
        >
          <div className="row">
            <h3>Bảng chấm điểm</h3>
            <strong className="grade-total">{score} / 100</strong>
          </div>
          {(
            [
              { key: 'understanding', label: 'Hiểu nội dung', max: 40 },
              { key: 'application', label: 'Ví dụ & liên hệ thực tế', max: 40 },
              { key: 'presentation', label: 'Trình bày', max: 20 },
            ] as const
          ).map((r) => (
            <Field key={r.key} label={`${r.label} (${r.max} điểm)`}>
              <input
                type="number"
                required
                min={0}
                max={r.max}
                step={1}
                value={rubric[r.key]}
                onChange={(e) => setRubric((x) => ({ ...x, [r.key]: Number(e.target.value) }))}
              />
            </Field>
          ))}
          <Field label="Lời khuyên & nhận xét">
            <textarea
              rows={6}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Gửi một lời nhận xét giúp học viên tiến bộ…"
            />
          </Field>
          <ErrorLine error={error} />
          <div className="inline-actions">
            {submission.status !== 'GRADED' && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !valid || gradingBlocked}
                onClick={() => save(false)}
              >
                Lưu điểm nháp
              </Button>
            )}
            <Button type="submit" disabled={busy || !valid || gradingBlocked}>
              Trả bài học viên
            </Button>
          </div>
        </form>
      </div>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={() => (dirty ? setLeaving(true) : onClose())}>
          Đóng bài chấm
        </Button>
      </div>
      <Dialog open={confirm} title="Công bố điểm cho học viên?" onClose={() => setConfirm(false)}>
        <p>
          Điểm <strong>{score}/100</strong> và lời nhận xét sẽ được gửi đến học viên.
        </p>
        <div className="dialog-footer">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Quay lại
          </Button>
          <Button disabled={busy || gradingBlocked} onClick={() => save(true)}>
            Xác nhận trả bài
          </Button>
        </div>
      </Dialog>
      <Dialog open={leaving} title="Điểm chưa được lưu" onClose={() => setLeaving(false)}>
        <p>Bạn có thay đổi chưa lưu. Lưu điểm nháp trước khi đóng để giữ lại nhận xét.</p>
        <div className="dialog-footer">
          <Button variant="secondary" onClick={() => setLeaving(false)}>
            Tiếp tục chấm
          </Button>
          <Button variant="danger" onClick={onClose}>
            Bỏ thay đổi
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function AssignmentForm({
  classId,
  lessons,
  assignment,
  onClose,
  onSave,
}: {
  classId: string;
  lessons: Lesson[];
  assignment?: Assignment;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const localDueAt = assignment
    ? new Date(Date.parse(assignment.dueAt) + 7 * 60 * 60 * 1000).toISOString()
    : '';
  const [title, setTitle] = useState(assignment?.title || '');
  const [lessonId, setLessonId] = useState(assignment?.lessonId || '');
  const [instructions, setInstructions] = useState(
    assignment?.instructions ||
      'Nêu hai tình huống thực tế và bài học rút ra. Viết bài cảm nhận hoặc đính kèm tệp bài làm.',
  );
  const [dueDate, setDueDate] = useState(localDueAt.slice(0, 10));
  const [dueTime, setDueTime] = useState(localDueAt.slice(11, 16) || '23:59');
  const [minWords, setMinWords] = useState(String(assignment?.minWords ?? 150));
  const [maxWords, setMaxWords] = useState(
    assignment?.maxWords == null ? '' : String(assignment.maxWords),
  );
  const [allowLate, setAllowLate] = useState(assignment?.allowLate ?? false);
  const [allowResubmit, setAllowResubmit] = useState(assignment?.allowResubmit ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (maxWords !== '' && Number(maxWords) < Number(minWords))
            throw new Error('Số từ tối đa phải lớn hơn hoặc bằng số từ tối thiểu.');
          await onSave({
            classId,
            title,
            lessonId: lessonId || null,
            instructions,
            dueAt: new Date(`${dueDate}T${dueTime}:00+07:00`).toISOString(),
            allowLate,
            allowResubmit,
            maxAttempts: assignment?.maxAttempts ?? 2,
            minWords: Number(minWords),
            maxWords: maxWords === '' ? null : Number(maxWords),
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Tiêu đề bài tập (bắt buộc)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} required />
      </Field>
      <Field label="Bài học liên quan">
        <select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
          <option value="">Không gắn bài học</option>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              Bài {l.order}: {l.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hướng dẫn đề bài">
        <textarea
          rows={4}
          required
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      <div className="two-col">
        <Field label="Số từ tối thiểu" hint="Nhập 0 nếu không yêu cầu số từ tối thiểu.">
          <input
            type="number"
            required
            min={0}
            max={20000}
            step={1}
            value={minWords}
            aria-label="Số từ tối thiểu"
            onChange={(e) => setMinWords(e.target.value)}
          />
        </Field>
        <Field label="Số từ tối đa" hint="Để trống nếu không giới hạn số từ tối đa.">
          <input
            type="number"
            min={1}
            max={20000}
            step={1}
            value={maxWords}
            aria-label="Số từ tối đa"
            onChange={(e) => setMaxWords(e.target.value)}
            placeholder="Không giới hạn"
          />
        </Field>
      </div>
      <div className="two-col">
        <Field label="Ngày hết hạn">
          <input
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        <Field label="Giờ hạn chót (GMT+7)">
          <input
            type="time"
            required
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
          />
        </Field>
      </div>
      <div className="rubric-summary">
        <strong>Thang điểm 100</strong>
        <span>Hiểu nội dung: 40</span>
        <span>Liên hệ thực tế: 40</span>
        <span>Trình bày: 20</span>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={allowLate}
          onChange={(e) => setAllowLate(e.target.checked)}
        />
        Cho phép nộp muộn
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={allowResubmit}
          onChange={(e) => setAllowResubmit(e.target.checked)}
        />
        Cho phép học viên nộp lại trước hạn (tối đa {assignment?.maxAttempts ?? 2} lần)
      </label>
      <ErrorLine error={error} />
      <FormActions
        busy={busy}
        onClose={onClose}
        label={assignment ? 'Lưu thay đổi' : 'Giao bài tập'}
      />
    </form>
  );
}
