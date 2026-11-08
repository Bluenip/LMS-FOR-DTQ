'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  Eye,
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
  StoredVideo,
} from '@/components/ui';
import { api, fold } from '@/lib/client';
import { uploadFile } from '@/lib/drive-upload';
import { AttachmentViewer, CourseLessonVideo, DriveVideoPlayer, VideoUploader } from './drive';
import { bindUploads, uploadActive, useUploads } from '@/lib/upload-manager';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';
import { readSessionDraft, removeSessionDraft, writeSessionDraft } from '@/lib/session-draft';
import { wordRequirement } from '@/lib/assignment-policy';
import { assignedTeacherIds, classTeacherNames, managesClass } from '@/lib/class-teachers';
import {
  assignmentRows,
  assignmentStats,
  submissionStatus,
  assignmentCsv,
  assignmentCsvFilename,
} from '@/lib/assignment-grading';
import type { Assignment, Attachment, Classroom, Lesson, Submission, User } from '@/lib/types';

const norm = fold;
function useDialogUnsavedWarning(dirty: boolean, discard: () => void) {
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useUnsavedWarning(dirty);
  useEffect(() => {
    if (!dirty) return;
    const currentUrl = window.location.href;
    const onPopState = () => {
      if (window.confirm('Bạn có thay đổi chưa lưu. Bạn muốn bỏ thay đổi và rời trang?'))
        discardRef.current();
      else window.history.pushState(null, '', currentUrl);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty]);
}
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
  const [editDirty, setEditDirty] = useState(false);
  const [members, setMembers] = useState<Classroom | null>(null);
  const [memberTab, setMemberTab] = useState('APPROVED');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [assigning, setAssigning] = useState<Classroom | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Classroom | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const discardClassEdit = () => {
    setEdit(null);
    setEditDirty(false);
  };
  useDialogUnsavedWarning(!!edit && editDirty, discardClassEdit);
  const confirmDiscardClassEdit = () =>
    !editDirty || window.confirm('Cài đặt lớp có thay đổi chưa lưu. Bạn muốn bỏ thay đổi?');
  const closeClassEdit = () => {
    if (!busy && confirmDiscardClassEdit()) discardClassEdit();
  };
  const classes = state.classes.filter((c) => managesClass(c, state.user));
  const status = params.get('status') || 'ACTIVE';
  const visible = classes.filter(
    (c) => c.status === status && norm(`${c.title} ${c.code}`).includes(norm(search)),
  );
  const approved = state.enrollments.filter(
    (e) => e.status === 'APPROVED' && classes.some((c) => c.id === e.classId),
  );
  const pending = state.enrollments.filter(
    (e) => e.status === 'PENDING' && classes.some((c) => c.id === e.classId),
  );
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
            {
              state.lessons.filter((l) => l.published && classes.some((c) => c.id === l.classId))
                .length
            }
            <small>
              {' '}
              / {state.lessons.filter((l) => classes.some((c) => c.id === l.classId)).length}
            </small>
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
            const owner = c.teacherId === state.user.id;
            return (
              <article className="class-card teacher-class-card" key={c.id}>
                <div className="class-cover">
                  <div className="row">
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {c.status === 'ACTIVE' ? 'Đang giảng dạy' : 'Đã lưu trữ'}
                    </Badge>
                    {owner && (
                      <IconButton label="Cài đặt lớp học" onClick={() => setEdit(c)}>
                        <Settings2 size={18} />
                      </IconButton>
                    )}
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
                  <p className="small">Giáo viên phụ trách: {classTeacherNames(c, state.users)}</p>
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
                    {owner && (
                      <>
                        <Button variant="secondary" onClick={() => setAssigning(c)}>
                          Giáo viên phụ trách
                        </Button>
                        <Button variant="ghost" onClick={() => setEdit(c)}>
                          <Settings2 size={16} />
                          Cài đặt
                        </Button>
                      </>
                    )}
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
        open={!!assigning}
        title="Phân công giáo viên phụ trách"
        onClose={() => setAssigning(null)}
        wide
      >
        {assigning && (
          <ClassTeacherManager
            key={assigning.id}
            classroom={assigning}
            onClose={() => setAssigning(null)}
            onSave={async (teacherIds, expectedTeacherIds) => {
              await action('setClassTeachers', {
                classId: assigning.id,
                teacherIds,
                expectedTeacherIds,
              });
              setAssigning(null);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!edit}
        title={edit === 'new' ? 'Tạo lớp học mới' : 'Cài đặt lớp học'}
        onClose={closeClassEdit}
        wide
      >
        {edit && (
          <ClassForm
            key={edit === 'new' ? 'new' : edit.id}
            classroom={edit === 'new' ? undefined : edit}
            busy={busy}
            error={error}
            onDirty={() => setEditDirty(true)}
            onClose={closeClassEdit}
            onSave={async (data) => {
              if (
                await run(edit === 'new' ? 'createClass' : 'updateClass', {
                  ...data,
                  ...(edit === 'new' ? {} : { classId: edit.id }),
                })
              )
                discardClassEdit();
            }}
            onArchive={
              edit === 'new'
                ? undefined
                : async () => {
                    if (!confirmDiscardClassEdit()) return;
                    if (
                      await run('archiveClass', {
                        classId: edit.id,
                        archived: edit.status !== 'ARCHIVED',
                      })
                    )
                      discardClassEdit();
                  }
            }
            onRegenerate={
              edit === 'new'
                ? undefined
                : async () => {
                    if (!confirmDiscardClassEdit()) return;
                    if (await run('regenerateCode', { classId: edit.id })) discardClassEdit();
                  }
            }
            onDelete={
              edit === 'new'
                ? undefined
                : () => {
                    if (!confirmDiscardClassEdit()) return;
                    setConfirmDelete(edit);
                    discardClassEdit();
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
              if (
                await run('deleteClass', {
                  classId: confirmDelete.id,
                  code: deleteCode,
                  expectedRevision: confirmDelete.revision || '',
                })
              )
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
                  <th>Ngày gửi yêu cầu</th>
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
                          <div className="inline-actions">
                            <select
                              aria-label={`Nhóm học tập của ${u?.name || 'học viên'}`}
                              value={e.group}
                              disabled={busy || members?.status === 'ARCHIVED'}
                              onChange={(event) =>
                                void run('setEnrollmentGroup', {
                                  enrollmentId: e.id,
                                  group: Number(event.target.value),
                                })
                              }
                            >
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  Nhóm {n}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="ghost"
                              disabled={busy || members?.status === 'ARCHIVED'}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Đưa ${u?.name || 'học viên'} ra khỏi lớp? Bài làm và lịch sử vẫn được giữ lại.`,
                                  )
                                )
                                  void run('removeEnrollment', {
                                    enrollmentId: e.id,
                                    expectedJoinedAt: e.joinedAt,
                                  });
                              }}
                            >
                              Đưa ra khỏi lớp
                            </Button>
                          </div>
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

function ClassTeacherManager({
  classroom,
  onClose,
  onSave,
}: {
  classroom: Classroom;
  onClose: () => void;
  onSave: (teacherIds: string[], expectedTeacherIds: string[]) => Promise<void>;
}) {
  const [initial] = useState(() => [...assignedTeacherIds(classroom)]);
  const [selected, setSelected] = useState(initial);
  const [teachers, setTeachers] = useState<(User & { available: boolean })[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ teachers: (User & { available: boolean })[] }>(
      `/api/classes/${encodeURIComponent(classroom.id)}/teachers`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then((result) => setTeachers(result.teachers))
      .catch((reason) => {
        if (!controller.signal.aborted) setError((reason as Error).message);
      });
    return () => controller.abort();
  }, [classroom.id]);
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSave(selected, initial);
        } catch (reason) {
          setError((reason as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Chọn tài khoản giáo viên phụ trách lớp {classroom.title}. Giáo viên được chọn có thể quản lý
        bài giảng, duyệt học viên và chấm bài. Người quản lý lớp thay đổi phân công và cài đặt lớp.
      </p>
      {!teachers && !error && <p role="status">Đang tải danh sách giáo viên…</p>}
      {teachers && (
        <fieldset className="class-teacher-options" disabled={busy}>
          <legend>Giáo viên phụ trách</legend>
          {teachers.map((teacher) => (
            <label className="check-label" key={teacher.id}>
              <input
                type="checkbox"
                checked={selected.includes(teacher.id)}
                disabled={!teacher.available && !selected.includes(teacher.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, teacher.id]
                      : current.filter((id) => id !== teacher.id),
                  )
                }
              />
              <span>
                {teacher.name} <small className="muted">({teacher.email})</small>
                {!teacher.available && (
                  <small className="muted"> — Tài khoản không hoạt động</small>
                )}
              </span>
            </label>
          ))}
          {!teachers.length && <p className="muted">Chưa có tài khoản giáo viên để phân công.</p>}
        </fieldset>
      )}
      <ErrorLine error={error} />
      <div className="dialog-footer">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button type="submit" disabled={busy || !teachers}>
          {busy ? 'Đang lưu…' : 'Lưu phân công'}
        </Button>
      </div>
    </form>
  );
}

function ClassForm({
  classroom,
  busy,
  error,
  onDirty,
  onClose,
  onSave,
  onArchive,
  onDelete,
  onRegenerate,
}: {
  classroom?: Classroom;
  busy: boolean;
  error: string;
  onDirty: () => void;
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
      onChange={onDirty}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...(classroom ? { expectedRevision: classroom.revision || '' } : {}),
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
      <fieldset className="stack form-controls" disabled={busy}>
        <Field label="Tên lớp học (bắt buộc)">
          <input
            required
            maxLength={180}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
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
                  {classroom.status === 'ARCHIVED'
                    ? 'Khôi phục giảng đường'
                    : 'Lưu trữ giảng đường'}
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
      </fieldset>
    </form>
  );
}

/** Read-only view of one submission: text, link, files (with in-page viewer) and the grade. */
function SubmissionDetail({
  submission,
  studentName,
  dueAt,
}: {
  submission: Submission;
  studentName: string;
  dueAt: string;
}) {
  const [open, setOpen] = useState(false);
  const late = !!submission.submittedAt && new Date(submission.submittedAt) > new Date(dueAt);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Eye size={15} /> Chi tiết
      </Button>
      <Dialog open={open} title={`Bài nộp của ${studentName}`} onClose={() => setOpen(false)} wide>
        {open && (
          <div className="stack">
            <div className="inline-actions">
              <Badge
                tone={
                  submission.status === 'GRADED'
                    ? 'success'
                    : submission.status === 'SUBMITTED'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {submissionStatus(submission)}
              </Badge>
              <span className="small muted">
                Lần nộp {submission.attempt} · {date(submission.submittedAt)} (GMT+7){' '}
                {submission.submittedAt && (late ? '· Nộp muộn' : '· Đúng hạn')}
              </span>
            </div>
            <section className="stack">
              <h3>Nội dung bài viết</h3>
              {submission.content.trim() ? (
                <p className="reading-copy" style={{ whiteSpace: 'pre-wrap' }}>
                  {submission.content}
                </p>
              ) : (
                <p className="muted small">Học viên không viết nội dung trực tiếp.</p>
              )}
            </section>
            {submission.link && (
              <section className="stack">
                <h3>Liên kết minh chứng</h3>
                <a className="text-link" href={submission.link} target="_blank" rel="noreferrer">
                  {submission.link}
                </a>
              </section>
            )}
            <section className="stack">
              <h3>Tệp đính kèm ({submission.attachments.length})</h3>
              {submission.attachments.length === 0 && <p className="muted small">Không có tệp.</p>}
              {submission.attachments.map((a) => (
                <div className="attachment" key={a.id}>
                  <FileText size={17} />
                  <a href={a.url || `/api/files/${a.id}`} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                  <small>{(a.size / 1024 / 1024).toFixed(1)} MB</small>
                  <AttachmentViewer file={a} />
                </div>
              ))}
            </section>
            {submission.status === 'GRADED' && (
              <section className="stack">
                <h3>Kết quả</h3>
                <p>
                  <strong>{submission.score}</strong> điểm
                  {submission.feedback ? ` — ${submission.feedback}` : ''}
                </p>
              </section>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

const noop = () => undefined;
export function TeacherLessons() {
  const { state, action } = useLms();
  const { params, set } = useQuery();
  const classes = state.classes.filter((c) => managesClass(c, state.user));
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
      if (creating && result?.id) bindUploads(classId, result.id);
      setCreating(false);
      if (result?.id) set('lesson', result.id);
      return result ?? null;
    } catch (e) {
      setError((e as Error).message);
      return null;
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
                        <span className="inline-actions small">
                          <Edit3 size={14} /> Sửa
                        </span>
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
                onDelete={async (expectedRevision) => {
                  if (!selected) return false;
                  setBusy(true);
                  setError('');
                  try {
                    await action('deleteLesson', { lessonId: selected.id, expectedRevision });
                    setCreating(false);
                    setDefaultSelection(null);
                    setEditorDirty(false);
                    set('lesson', '');
                    return true;
                  } catch (e) {
                    setError((e as Error).message);
                    return false;
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
  onSave: (data: Record<string, unknown>) => Promise<{ id?: string; revision?: string } | null>;
  onDelete: (expectedRevision: string) => Promise<boolean>;
}) {
  const { state } = useLms();
  const [title, setTitle] = useState(lesson?.title || '');
  const [chapter, setChapter] = useState(lesson?.chapter || '');
  const [order, setOrder] = useState(lesson?.order || nextOrder);
  const [description, setDescription] = useState(lesson?.description || '');
  const [videoType, setVideoType] = useState<'YOUTUBE' | 'UPLOAD' | 'DRIVE'>(
    // New lessons, and lessons without a video yet, open on the Google Drive tab.
    lesson?.videoUrl ? lesson.videoType : 'DRIVE',
  );
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl || '');
  // For DRIVE lessons this holds the Google Drive file id (sent as driveFileId).
  const [videoFileId, setVideoFileId] = useState(
    lesson?.videoFileId ||
      lesson?.driveFileId ||
      (lesson?.videoType === 'DRIVE'
        ? lesson.videoUrl.match(/\/file\/d\/([\w-]+)/)?.[1] || ''
        : ''),
  );
  const [duration, setDuration] = useState(lesson?.duration || '');
  const [timestamps, setTimestamps] = useState(lesson?.timestamps || []);
  const [documents, setDocuments] = useState<Attachment[]>(lesson?.documents || []);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(lesson?.revision || '');
  const draftKey = `lms-draft:lesson:${state.user.id}:${classId}:${lesson?.id || 'new'}`;
  useEffect(() => {
    const saved = readSessionDraft<{
      title: string;
      chapter: string;
      order: number;
      description: string;
      videoType: 'YOUTUBE' | 'UPLOAD' | 'DRIVE';
      videoUrl: string;
      videoFileId: string;
      duration: string;
      timestamps: Lesson['timestamps'];
      documents: Attachment[];
      revision: string;
    }>(draftKey);
    // A draft saved against an older version of the lesson must not hide what is stored now.
    if (!saved || (lesson && saved.revision !== (lesson.revision || ''))) {
      if (saved) removeSessionDraft(draftKey);
      return;
    }
    setTitle(saved.title);
    setChapter(saved.chapter);
    setOrder(saved.order);
    setDescription(saved.description);
    setVideoType(saved.videoType);
    setVideoUrl(saved.videoUrl);
    setVideoFileId(saved.videoFileId || lesson?.driveFileId || lesson?.videoFileId || '');
    setDuration(saved.duration);
    setTimestamps(saved.timestamps);
    setDocuments(saved.documents);
    setRevision(saved.revision);
    setDirty(true);
  }, [draftKey]);
  useEffect(() => {
    if (dirty)
      writeSessionDraft(draftKey, {
        title,
        chapter,
        order,
        description,
        videoType,
        videoUrl,
        videoFileId,
        duration,
        timestamps,
        documents,
        revision,
      });
  }, [
    dirty,
    draftKey,
    title,
    chapter,
    order,
    description,
    videoType,
    videoUrl,
    videoFileId,
    duration,
    timestamps,
    documents,
    revision,
  ]);
  // `dirty` only records that a field was touched; a form matching what was opened is not unsaved.
  const fieldsJson = JSON.stringify([
    title,
    chapter,
    order,
    description,
    videoType,
    videoUrl,
    videoFileId,
    duration,
    timestamps,
    documents,
  ]);
  const videoUploading =
    useUploads(
      (i) =>
        i.classId === classId &&
        i.kind === 'video' &&
        (i.lessonId || '') === (lesson?.id || '') &&
        uploadActive(i),
    ).length > 0;
  // When a background upload attaches itself, show it without discarding what is being typed.
  useEffect(() => {
    if (!lesson) return;
    const stored = lesson.videoFileId || lesson.driveFileId || '';
    if (stored && !videoFileId) setVideoFileId(stored);
    if (lesson.documents.length > documents.length) {
      const known = new Set(documents.map((d) => d.id));
      setDocuments((d) => [...d, ...lesson.documents.filter((x) => !known.has(x.id))]);
    }
    if (lesson.revision && lesson.revision !== revision) setRevision(lesson.revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.revision, lesson?.driveFileId, lesson?.documents.length]);
  const openedJson = useRef(fieldsJson);
  const unsaved = dirty && fieldsJson !== openedJson.current;
  useEffect(() => onDirty(unsaved), [unsaved, onDirty]);
  useUnsavedWarning(unsaved);
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
    videoFileId: videoType === 'UPLOAD' ? videoFileId || undefined : undefined,
    driveFileId: videoType === 'DRIVE' ? videoFileId || undefined : undefined,
    duration,
    timestamps,
    documents,
    // A Drive video still uploading in the background attaches itself when it finishes.
    videoPending: videoType === 'DRIVE' && !videoFileId && videoUploading,
    expectedRevision: revision,
  };
  const related = state.assignments.filter((a) => a.lessonId === lesson?.id);
  return (
    <section className="panel editor">
      <div className="editor-heading">
        <div>
          <h2>{lesson ? 'Chỉnh sửa bài giảng' : 'Bài giảng mới'}</h2>
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
          if (
            lesson?.published &&
            !window.confirm('Lưu bản nháp sẽ tạm ẩn bài này khỏi học viên. Tiếp tục?')
          )
            return;
          void onSave({ ...data, published: false }).then((result) => {
            if (result) {
              setRevision(result.revision || '');
              setDirty(false);
              removeSessionDraft(draftKey);
            }
          });
        }}
      >
        <fieldset className="stack form-controls" disabled={busy || uploading}>
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
                  { id: 'DRIVE', label: 'Google Drive' },
                  // Legacy S3 videos stay playable/editable, but new uploads always go to Drive.
                  ...(lesson?.videoType === 'UPLOAD'
                    ? [{ id: 'UPLOAD', label: 'Kho cũ (S3)' }]
                    : []),
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
                {youtubeId(videoUrl) && (
                  <div className="video-frame">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${youtubeId(videoUrl)}`}
                      title={title || 'Video bài giảng'}
                      allow="encrypted-media; picture-in-picture; fullscreen"
                      allowFullScreen
                    />
                  </div>
                )}
                {videoUrl && (
                  <p className={youtubeId(videoUrl) ? 'small success-text' : 'error small'}>
                    {youtubeId(videoUrl)
                      ? 'Định dạng liên kết YouTube hợp lệ.'
                      : 'Nhập liên kết video YouTube hợp lệ.'}
                  </p>
                )}
              </>
            ) : videoType === 'DRIVE' ? (
              <CourseLessonVideo
                classId={classId}
                lessonId={lesson?.id}
                driveFileId={videoFileId}
                title={title}
                onChange={(id) => {
                  setVideoFileId(id);
                  setDirty(true);
                }}
              />
            ) : (
              <Field
                label="Chọn video MP4 hoặc WebM"
                hint="Tối đa 5 GB. Tệp được tải trực tiếp lên kho cũ."
              >
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  disabled={uploading || !state.storageConfigured}
                  onChange={(e) => upload(e.target.files?.[0], 'video')}
                />
              </Field>
            )}
            {!videoUrl && !videoFileId && (
              <div className="video-empty">
                <Video size={30} />
                <strong>Chưa có nguồn video</strong>
                <p className="small muted">
                  Bạn có thể xuất bản bài học có nội dung hoặc tài liệu mà không cần video.
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
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <section className="stack">
            <div className="row">
              <h3>Mốc thời gian trọng tâm</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTimestamps((t) => [...t, { time: '00:00', title: '' }]);
                  setDirty(true);
                }}
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
                  required
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
                  required
                  onChange={(e) =>
                    setTimestamps((ts) =>
                      ts.map((a, j) => (j === i ? { ...a, title: e.target.value } : a)),
                    )
                  }
                />
                <IconButton
                  type="button"
                  label="Xóa mốc"
                  onClick={() => {
                    setTimestamps((ts) => ts.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
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
                    onClick={() => {
                      setDocuments((d) => d.filter((x) => x.id !== a.id));
                      setDirty(true);
                    }}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              ))
            ) : (
              <p className="small muted">Chưa có tài liệu đính kèm.</p>
            )}
            <VideoUploader
              classId={classId}
              lessonId={lesson?.id}
              kind="document"
              accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
              disabled={!state.storageConfigured || documents.length >= 20}
              onUploaded={noop}
            />
            <p className="small muted">
              PDF, DOCX, PPTX, JPG, PNG; tối đa 1 GB. Tải lên chạy nền, tài liệu tự gắn vào bài khi
              xong; bạn có thể lưu hoặc xuất bản bài ngay.
            </p>
            {!state.storageConfigured && (
              <p className="small muted">
                Google Drive chưa được kết nối. Quản trị viên cần kết nối trước khi tải tệp.
              </p>
            )}
            <p className="small muted">{documents.length}/20 tài liệu</p>
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
          <ErrorLine error={localError || (!deleting ? error : '')} />
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
              {lesson && (
                <Link
                  className="button ghost"
                  href={`/classes/${classId}/lessons/${lesson.id}?tab=discussion`}
                >
                  Xem thảo luận
                </Link>
              )}
              <Button
                type="button"
                disabled={
                  busy ||
                  uploading ||
                  !title.trim() ||
                  !chapter.trim() ||
                  (!videoUrl && !videoFileId && !description.trim() && documents.length === 0) ||
                  (videoType === 'YOUTUBE' && !!videoUrl && !youtubeId(videoUrl))
                }
                onClick={(e) => {
                  if (!e.currentTarget.form?.reportValidity()) return;
                  void onSave({ ...data, published: true }).then((result) => {
                    if (result) {
                      setRevision(result.revision || '');
                      setDirty(false);
                      removeSessionDraft(draftKey);
                    }
                  });
                }}
              >
                <Check size={16} />
                Xuất bản
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
      <Dialog
        open={preview}
        title={title || 'Xem trước bài giảng'}
        onClose={() => setPreview(false)}
        wide
      >
        <div className="stack">
          {!preview ? null : videoType === 'YOUTUBE' && youtubeId(videoUrl) ? (
            <iframe
              className="video-preview"
              src={`https://www.youtube-nocookie.com/embed/${youtubeId(videoUrl)}`}
              title={title}
              allowFullScreen
            />
          ) : videoType === 'DRIVE' && videoFileId ? (
            <div className="video-frame">
              <DriveVideoPlayer fileId={videoFileId} title={title} />
            </div>
          ) : videoType === 'UPLOAD' && videoUrl ? (
            <StoredVideo className="video-preview" src={videoUrl} />
          ) : (
            <Empty
              title="Chưa có video"
              description="Bài học có thể sử dụng nội dung hoặc tài liệu."
            />
          )}
          <p>{description}</p>
        </div>
      </Dialog>
      <Dialog open={deleting} title="Xóa bài giảng?" onClose={() => setDeleting(false)}>
        <p>
          Xóa bài giảng sẽ xóa tiến độ, ghi chép và thảo luận gắn với bài; các bài tập liên quan sẽ
          bị gỡ liên kết. Bài tập đang ẩn sẽ tiếp tục ẩn cho đến khi giáo viên chủ động công bố.
          Thao tác này không thể hoàn tác.
        </p>
        {deleting && <ErrorLine error={error} />}
        <div className="dialog-footer">
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Giữ lại
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              void onDelete(revision).then((deleted) => {
                if (deleted) {
                  removeSessionDraft(draftKey);
                  setDirty(false);
                  setDeleting(false);
                }
              });
            }}
          >
            Xác nhận xóa
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function AssignmentActions({
  assignment,
  onEdit,
  onDelete,
}: {
  assignment: Assignment;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <details
      className="assignment-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label={`Thao tác cho bài ${assignment.title}`} title="Thao tác bài tập">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="assignment-menu-actions">
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            onEdit();
          }}
        >
          <Edit3 size={15} /> Sửa bài tập
        </button>
        <button
          type="button"
          className="assignment-delete"
          onClick={(event) => {
            event.currentTarget.closest('details')?.removeAttribute('open');
            onDelete();
          }}
        >
          <Trash2 size={15} /> Xóa bài tập
        </button>
      </div>
    </details>
  );
}

function assignmentUrl(classId: string, assignmentId?: string) {
  const params = new URLSearchParams({ class: classId });
  if (assignmentId) params.set('assignment', assignmentId);
  return `/teacher/assignments?${params.toString()}`;
}

export function TeacherAssignments() {
  const { state, action } = useLms();
  const params = useSearchParams();
  const router = useRouter();
  const classes = state.classes.filter((c) => managesClass(c, state.user));
  const requestedClass = params.get('class');
  const requestedAssignment = params.get('assignment');
  const knownAssignment = requestedAssignment
    ? state.assignments.find(
        (a) => a.id === requestedAssignment && classes.some((c) => c.id === a.classId),
      )
    : undefined;
  const classId = requestedClass ?? knownAssignment?.classId ?? classes[0]?.id ?? '';
  const classroom = classes.find((c) => c.id === classId);
  const assignments = state.assignments.filter((a) => a.classId === classId);
  const assignment = requestedAssignment
    ? assignments.find((a) => a.id === requestedAssignment)
    : undefined;
  const search = params.get('q') || '';
  const filter = ['pending', 'graded', 'missing'].includes(params.get('status') || '')
    ? params.get('status')!
    : 'all';
  const requestedPage = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [openedSubmission, setOpenedSubmission] = useState<Submission | null>(null);
  // Teachers no longer receive the submission while it is withdrawn. Keep the opened
  // attempt in the dialog so unsaved grading is not discarded during synchronization.
  const grading =
    state.submissions.find((s) => s.id === gradingId) ??
    (openedSubmission?.id === gradingId
      ? { ...openedSubmission, status: 'DRAFT' as const }
      : undefined);
  const [gradingDirty, setGradingDirty] = useState(false);
  const [editor, setEditor] = useState<{ classId: string; assignment?: Assignment } | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const [deleteTitle, setDeleteTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    classId: string;
    assignmentId?: string;
    text: string;
    openAssignmentId?: string;
  } | null>(null);
  const discardAssignmentEdit = () => {
    setEditor(null);
    setEditorDirty(false);
  };
  useDialogUnsavedWarning(!!editor && editorDirty, discardAssignmentEdit);
  const closeAssignmentEdit = () => {
    if (
      !editorSaving &&
      (!editorDirty || window.confirm('Đề bài có thay đổi chưa lưu. Bạn muốn bỏ thay đổi?'))
    )
      discardAssignmentEdit();
  };
  const contextKey = JSON.stringify([classId, requestedAssignment]);
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setError('');
    setNotice((current) =>
      current?.classId === classId && (current.assignmentId || null) === requestedAssignment
        ? current
        : null,
    );
    if (!gradingDirty) setGradingId(null);
  }, [contextKey, classId, requestedAssignment, gradingDirty]);

  // A modal blocks page links, but the browser's Back button can still leave the editor.
  useEffect(() => {
    if (!gradingDirty) return;
    const currentUrl = window.location.href;
    const onPopState = () => {
      if (!window.confirm('Bài chấm có thay đổi chưa lưu. Bạn muốn bỏ thay đổi và rời trang?')) {
        window.history.pushState(null, '', currentUrl);
      } else {
        setGradingDirty(false);
        setGradingId(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [gradingDirty]);

  const assignmentVisible =
    !!assignment &&
    assignment.published !== false &&
    (!assignment.lessonId ||
      !!state.lessons.find((lesson) => lesson.id === assignment.lessonId)?.published);
  const allRows = assignment ? assignmentRows(state, assignment) : [];
  const stats = assignmentStats(allRows);
  const rows = allRows.filter(
    ({ user, submission }) =>
      norm(user?.name || '').includes(norm(search)) &&
      (filter === 'all' ||
        (filter === 'pending' && submission?.status === 'SUBMITTED') ||
        (filter === 'graded' && submission?.status === 'GRADED') ||
        (filter === 'missing' && !submission)),
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / 8));
  const page = Math.min(requestedPage, pageCount);
  const visibleNotice =
    notice?.classId === classId && (notice.assignmentId || null) === requestedAssignment
      ? notice
      : null;

  function updateFilters(changes: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    window.history.replaceState(null, '', `/teacher/assignments?${next.toString()}`);
  }
  function openEditor(a?: Assignment) {
    setError('');
    setEditor({ classId, assignment: a });
  }
  function openDelete(a: Assignment) {
    setError('');
    setDeleteTitle('');
    setDeleting(a);
  }
  async function remind(userId: string) {
    if (!assignment) return;
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      const result = (await action('remindStudents', { assignmentId: assignment.id, userId })) as {
        count: number;
      };
      setNotice({
        classId,
        assignmentId: assignment.id,
        text: result.count
          ? `Đã gửi lời nhắc nộp bài “${assignment.title}” vào thông báo của học viên.`
          : 'Học viên đã nộp bài hoặc không còn trong danh sách cần nhắc.',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    if (!assignment || !classroom) return;
    const data = assignmentCsv(allRows, classroom, assignment, date);
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = assignmentCsvFilename(classroom, assignment);
    link.click();
    URL.revokeObjectURL(url);
  }
  const classSelector = classroom && (
    <div className="assignment-class-selector">
      <Field label="Lớp học">
        <select
          value={classId}
          onChange={(event) => router.push(assignmentUrl(event.target.value))}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.code})
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
  return (
    <div className="stack assignments-page">
      {requestedClass !== null && !classroom ? (
        <Empty
          title="Không tìm thấy lớp hoặc bạn không có quyền truy cập"
          description="Vui lòng chọn một lớp trong danh sách lớp giảng dạy."
        >
          <Link href="/teacher/classes" className="button secondary">
            Lớp giảng dạy
          </Link>
        </Empty>
      ) : !classroom ? (
        <Empty
          title="Bạn chưa phụ trách lớp nào"
          description="Quản lý lớp giảng dạy để bắt đầu giao bài tập."
        >
          <Link href="/teacher/classes" className="button secondary">
            Lớp giảng dạy
          </Link>
        </Empty>
      ) : requestedAssignment && !assignment ? (
        <Empty
          title="Bài tập không còn khả dụng"
          description="Bài tập đã bị xóa, không thuộc lớp này hoặc bạn không còn quyền truy cập."
        >
          <Link href={assignmentUrl(classId)} className="button secondary">
            ← Danh sách bài tập
          </Link>
        </Empty>
      ) : (
        <>
          {assignment ? (
            <PageHeading
              breadcrumb={<Link href={assignmentUrl(classId)}>← Danh sách bài tập</Link>}
              title={assignment.title}
              description={`Lớp ${classroom.title} (${classroom.code}) · Hạn nộp: ${date(assignment.dueAt)} (GMT+7)`}
              actions={
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    onClick={exportCsv}
                    aria-label={`Xuất điểm bài này: ${assignment.title}`}
                  >
                    <Download size={16} /> Xuất điểm bài này
                  </Button>
                  <AssignmentActions
                    assignment={assignment}
                    onEdit={() => openEditor(assignment)}
                    onDelete={() => openDelete(assignment)}
                  />
                </div>
              }
            />
          ) : (
            <PageHeading
              title="Bài cần chấm"
              description="Quản lý bài tập và theo dõi bài nộp của từng lớp."
              actions={
                <Button onClick={() => openEditor()}>
                  <Plus size={17} /> Giao bài tập
                </Button>
              }
            />
          )}
          {classSelector}
          {assignment && !assignmentVisible && (
            <p className="notice">
              Bài tập đang ẩn; hãy công bố bài tập và bài giảng liên quan trước khi nhắc học viên
              nộp.
            </p>
          )}
          {assignment && (
            <p className="assignment-details muted">
              {state.lessons.find((l) => l.id === assignment.lessonId)?.title ||
                'Không gắn bài học'}
              {' · '}Yêu cầu số từ: {wordRequirement(assignment)}
            </p>
          )}
          <ErrorLine error={error} />
          {visibleNotice && (
            <div role="status" className="notice assignment-notice">
              <span>{visibleNotice.text}</span>
              {visibleNotice.openAssignmentId && (
                <Link
                  href={assignmentUrl(classId, visibleNotice.openAssignmentId)}
                  className="text-link"
                >
                  Xem bài nộp
                </Link>
              )}
              <IconButton label="Đóng thông báo" onClick={() => setNotice(null)}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {!assignment ? (
            <section className="panel stack">
              <div className="section-heading">
                <h2>Bài tập đã giao</h2>
                <span className="small muted">{assignments.length} bài tập</span>
              </div>
              {assignments.length ? (
                <div className="table-wrap">
                  <table
                    className="table assignment-list-table"
                    aria-label="Quản lý bài tập đã giao"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Bài tập</th>
                        <th scope="col">Hạn nộp (GMT+7)</th>
                        <th scope="col">Yêu cầu số từ</th>
                        <th scope="col">Đã nộp</th>
                        <th scope="col">Cần chấm</th>
                        <th scope="col">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => {
                        const counts = assignmentStats(assignmentRows(state, a));
                        return (
                          <tr key={a.id}>
                            <td>
                              <Link
                                className="text-link assignment-title"
                                href={assignmentUrl(classId, a.id)}
                              >
                                {a.title}
                              </Link>
                              <small className="muted">
                                {state.lessons.find((l) => l.id === a.lessonId)?.title ||
                                  'Không gắn bài học'}
                              </small>
                            </td>
                            <td>{date(a.dueAt)}</td>
                            <td>{wordRequirement(a)}</td>
                            <td>
                              {counts.submitted}/{counts.total}
                            </td>
                            <td>{counts.pending}</td>
                            <td>
                              <div className="inline-actions assignment-row-actions">
                                <Link
                                  className="button secondary assignment-open"
                                  href={assignmentUrl(classId, a.id)}
                                >
                                  Xem bài nộp
                                </Link>
                                <AssignmentActions
                                  assignment={a}
                                  onEdit={() => openEditor(a)}
                                  onDelete={() => openDelete(a)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Lớp này chưa có bài tập"
                  description="Giao bài tập đầu tiên cho lớp này."
                >
                  <Button onClick={() => openEditor()}>
                    <Plus size={17} /> Giao bài tập
                  </Button>
                </Empty>
              )}
            </section>
          ) : (
            <>
              <div className="stat-row assignment-stats" aria-label="Thống kê bài tập">
                <div className="stat">
                  <strong>
                    {stats.submitted}
                    <small> / {stats.total}</small>
                  </strong>
                  <span>Đã nộp</span>
                </div>
                <div className="stat">
                  <strong>{stats.pending}</strong>
                  <span>Cần chấm</span>
                </div>
                <div className="stat">
                  <strong>{stats.graded}</strong>
                  <span>Đã chấm</span>
                </div>
                <div className="stat">
                  <strong>{stats.missing}</strong>
                  <span>Chưa nộp</span>
                </div>
                <div className="stat">
                  <strong>{stats.average === null ? '—' : Number(stats.average.toFixed(1))}</strong>
                  <span>Điểm trung bình / 100</span>
                </div>
              </div>
              <section className="panel stack">
                <div className="toolbar">
                  <Tabs
                    value={filter}
                    onChange={(value) =>
                      updateFilters({ status: value === 'all' ? null : value, page: null })
                    }
                    items={[
                      { id: 'all', label: 'Tất cả', count: stats.total },
                      { id: 'pending', label: 'Cần chấm', count: stats.pending },
                      { id: 'graded', label: 'Đã chấm', count: stats.graded },
                      { id: 'missing', label: 'Chưa nộp', count: stats.missing },
                    ]}
                  />
                  <Search
                    value={search}
                    onChange={(value) => updateFilters({ q: value || null, page: null })}
                    placeholder="Tìm tên học viên…"
                  />
                </div>
                {stats.total === 0 ? (
                  <Empty
                    title="Lớp chưa có học viên chính thức"
                    description="Học viên được duyệt vào lớp sẽ xuất hiện tại đây."
                  />
                ) : (
                  <>
                    {stats.submitted === 0 && (
                      <p className="muted">
                        Chưa có bài nộp. Bạn vẫn có thể nhắc học viên nộp bài.
                      </p>
                    )}
                    {rows.length > 0 ? (
                      <div className="table-wrap">
                        <table
                          className="table grade-table"
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
                            {rows
                              .slice((page - 1) * 8, page * 8)
                              .map(({ studentId, user, submission }) => (
                                <tr key={studentId}>
                                  <td data-label="Học viên">
                                    <div className="member-name">
                                      <span className="avatar">{initials(user?.name || 'HV')}</span>
                                      <span>
                                        {user?.name || 'Học viên không còn khả dụng'}
                                        <small className="muted">{user?.email}</small>
                                      </span>
                                    </div>
                                  </td>
                                  <td data-label="Thời gian nộp">
                                    {date(submission?.submittedAt)}
                                    {submission?.submittedAt && (
                                      <small
                                        className={
                                          new Date(submission.submittedAt) >
                                          new Date(assignment.dueAt)
                                            ? 'error'
                                            : 'muted'
                                        }
                                      >
                                        {new Date(submission.submittedAt) >
                                        new Date(assignment.dueAt)
                                          ? 'Nộp muộn'
                                          : 'Đúng hạn'}
                                      </small>
                                    )}
                                  </td>
                                  <td data-label="Bài làm">
                                    {submission ? (
                                      <div className="stack">
                                        <span className="small">
                                          {submission.attachments.length
                                            ? `${submission.attachments.length} tệp đính kèm`
                                            : 'Bài viết trực tiếp'}
                                        </span>
                                        {submission.attachments.map((a) => (
                                          <span key={a.id} className="inline-actions small">
                                            <span>{a.name}</span>
                                            <AttachmentViewer file={a} />
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td data-label="Trạng thái">
                                    <Badge
                                      tone={
                                        submission?.status === 'GRADED'
                                          ? 'success'
                                          : submission
                                            ? 'warning'
                                            : 'neutral'
                                      }
                                    >
                                      {submissionStatus(submission)}
                                    </Badge>
                                  </td>
                                  <td data-label="Điểm">
                                    <strong>
                                      {submission?.score != null
                                        ? `${submission.score}${submission.status === 'SUBMITTED' ? ' (nháp)' : ''}`
                                        : '—'}
                                    </strong>
                                  </td>
                                  <td data-label="Thao tác">
                                    {submission ? (
                                      <div className="inline-actions">
                                        <SubmissionDetail
                                          submission={submission}
                                          studentName={user?.name || 'Học viên'}
                                          dueAt={assignment.dueAt}
                                        />
                                        <Button
                                          variant="secondary"
                                          onClick={() => {
                                            setOpenedSubmission(submission);
                                            setGradingId(submission.id);
                                            setGradingDirty(false);
                                          }}
                                        >
                                          {submission.status === 'GRADED' ? 'Xem lại' : 'Chấm bài'}
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="secondary"
                                        disabled={busy || !assignmentVisible}
                                        onClick={() => remind(studentId)}
                                      >
                                        Nhắc nộp
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Không có học viên phù hợp"
                        description="Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm."
                      >
                        <Button
                          variant="secondary"
                          onClick={() => updateFilters({ status: null, q: null, page: null })}
                        >
                          Xóa bộ lọc
                        </Button>
                      </Empty>
                    )}
                    <div className="row small">
                      <span className="muted">{rows.length} học viên</span>
                      <div className="inline-actions">
                        <IconButton
                          label="Trang trước"
                          disabled={page === 1}
                          onClick={() =>
                            updateFilters({ page: page > 2 ? String(page - 1) : null })
                          }
                        >
                          <ChevronLeft size={18} />
                        </IconButton>
                        <span>
                          Trang {page} / {pageCount}
                        </span>
                        <IconButton
                          label="Trang sau"
                          disabled={page >= pageCount}
                          onClick={() => updateFilters({ page: String(page + 1) })}
                        >
                          <ChevronRight size={18} />
                        </IconButton>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
      <Dialog
        open={!!gradingId}
        title={`Bài làm của ${state.users.find((u) => u.id === grading?.studentId)?.name || 'học viên'}`}
        onClose={() => {
          if (
            !gradingDirty ||
            window.confirm('Bài chấm có thay đổi chưa lưu. Bạn muốn bỏ thay đổi và đóng?')
          ) {
            setGradingId(null);
            setGradingDirty(false);
          }
        }}
        wide
      >
        {grading ? (
          <GradeForm
            key={grading.id}
            submission={grading}
            assignment={state.assignments.find((a) => a.id === grading.assignmentId)}
            onDirty={setGradingDirty}
            onClose={() => {
              setGradingId(null);
              setGradingDirty(false);
            }}
            onSave={async (data) => {
              const gradedAssignment = state.assignments.find((a) => a.id === grading.assignmentId);
              await action('gradeSubmission', { submissionId: grading.id, ...data });
              setGradingId(null);
              setGradingDirty(false);
              if (gradedAssignment)
                setNotice({
                  classId: gradedAssignment.classId,
                  assignmentId: gradedAssignment.id,
                  text: data.returnGrade
                    ? `Đã trả điểm bài “${gradedAssignment.title}”.`
                    : `Đã lưu điểm nháp bài “${gradedAssignment.title}”.`,
                });
            }}
          />
        ) : (
          <Empty
            title="Bài nộp không còn khả dụng"
            description="Học viên đã thu hồi bài hoặc bài tập đã được xóa. Đóng cửa sổ để quay lại danh sách."
          >
            <Button
              variant="secondary"
              onClick={() => {
                setGradingId(null);
                setGradingDirty(false);
              }}
            >
              Đóng
            </Button>
          </Empty>
        )}
      </Dialog>
      <Dialog
        open={!!editor}
        title={editor?.assignment ? 'Sửa bài tập' : 'Giao bài tập mới'}
        onClose={closeAssignmentEdit}
        wide
      >
        {editor && (
          <AssignmentForm
            key={editor.assignment?.id || `new-${editor.classId}`}
            classId={editor.classId}
            assignment={editor.assignment}
            lessons={state.lessons.filter((l) => l.classId === editor.classId)}
            onDirty={() => setEditorDirty(true)}
            onClose={closeAssignmentEdit}
            onSave={async (data) => {
              const edited = Boolean(editor.assignment);
              setEditorSaving(true);
              try {
                const saved = (await action(edited ? 'updateAssignment' : 'createAssignment', {
                  ...data,
                  ...(editor.assignment ? { assignmentId: editor.assignment.id } : {}),
                })) as Assignment;
                discardAssignmentEdit();
                setNotice({
                  classId: editor.classId,
                  assignmentId: edited && requestedAssignment === saved.id ? saved.id : undefined,
                  text: edited
                    ? `Đã cập nhật bài tập “${saved.title}”.`
                    : `Đã giao bài tập “${saved.title}”.`,
                  openAssignmentId: edited ? undefined : saved.id,
                });
              } finally {
                setEditorSaving(false);
              }
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
                      expectedRevision: deleting.revision || '',
                    });
                    setDeleting(null);
                    setNotice({ classId, text: `Đã xóa bài tập “${deleting.title}”.` });
                    if (requestedAssignment === deleting.id) router.push(assignmentUrl(classId));
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
    gradeRevision: submission.gradeRevision || '',
  }));
  const submissionChanged =
    submission.attempt !== openedAttempt.attempt ||
    submission.submittedAt !== openedAttempt.submittedAt;
  const gradeChanged = (submission.gradeRevision || '') !== openedAttempt.gradeRevision;
  const gradingBlocked =
    !assignment || submission.status === 'DRAFT' || submissionChanged || gradeChanged;
  const staleMessage = !assignment
    ? 'Bài tập không còn khả dụng. Đóng cửa sổ để quay về danh sách bài tập.'
    : submission.status === 'DRAFT'
      ? 'Học viên đã thu hồi bài. Đóng cửa sổ và chờ bài nộp mới trước khi chấm.'
      : submissionChanged
        ? 'Học viên đã nộp lại bài. Đóng và mở lại bài chấm để đánh giá lần nộp mới.'
        : 'Điểm hoặc nhận xét đã thay đổi ở phiên khác. Hãy sao chép phần đang soạn và mở lại.';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const score = rubric.understanding + rubric.application + rubric.presentation;
  const gradeJson = JSON.stringify([rubric, feedback]);
  const openedGrade = useRef(gradeJson);
  const gradeUnsaved = dirty && gradeJson !== openedGrade.current;
  useEffect(() => onDirty(gradeUnsaved), [gradeUnsaved, onDirty]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (gradeUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [gradeUnsaved]);
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
        expectedSubmittedAt: openedAttempt.submittedAt || null,
        expectedGradeRevision: openedAttempt.gradeRevision,
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
          <h3>Bài làm của học viên</h3>
          <p className="small muted">{assignment?.instructions}</p>
          <p className="submission-content">
            {submission.content ||
              (submission.attachments.length
                ? 'Bài làm được gửi trong tệp đính kèm.'
                : submission.link
                  ? 'Bài làm được gửi qua liên kết.'
                  : 'Bài làm không có nội dung.')}
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
            <div className="list-row" key={a.id}>
              <FileText size={18} />
              <span>{a.name}</span>
              <AttachmentViewer file={a} />
              <a
                href={a.url || `/api/files/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Tải ${a.name}`}
                title="Tải xuống"
              >
                <Download size={16} />
              </a>
            </div>
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
                disabled={busy}
                onChange={(e) => setRubric((x) => ({ ...x, [r.key]: Number(e.target.value) }))}
              />
            </Field>
          ))}
          <Field label="Lời khuyên & nhận xét">
            <textarea
              rows={6}
              value={feedback}
              disabled={busy}
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
        <Button variant="ghost" onClick={() => (gradeUnsaved ? setLeaving(true) : onClose())}>
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
  onDirty,
  onClose,
  onSave,
}: {
  classId: string;
  lessons: Lesson[];
  assignment?: Assignment;
  onDirty: () => void;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const localDueAt = assignment
    ? new Date(Date.parse(assignment.dueAt) + 7 * 60 * 60 * 1000).toISOString()
    : '';
  const [title, setTitle] = useState(assignment?.title || '');
  const [lessonId, setLessonId] = useState(assignment?.lessonId || '');
  const [published, setPublished] = useState(assignment?.published !== false);
  const initiallyVisible =
    !!assignment &&
    assignment.published !== false &&
    (!assignment.lessonId ||
      !!lessons.find((lesson) => lesson.id === assignment.lessonId)?.published);
  const [instructions, setInstructions] = useState(assignment?.instructions || '');
  const [dueDate, setDueDate] = useState(localDueAt.slice(0, 10));
  const [dueTime, setDueTime] = useState(localDueAt.slice(11, 16) || '23:59');
  const [minWords, setMinWords] = useState(String(assignment?.minWords ?? 150));
  const [maxWords, setMaxWords] = useState(
    assignment?.maxWords == null ? '' : String(assignment.maxWords),
  );
  const [allowLate, setAllowLate] = useState(assignment?.allowLate ?? false);
  const [allowResubmit, setAllowResubmit] = useState(assignment?.allowResubmit ?? true);
  const [maxAttempts, setMaxAttempts] = useState(assignment?.maxAttempts ?? 2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onChange={onDirty}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (maxWords !== '' && Number(maxWords) < Number(minWords))
            throw new Error('Số từ tối đa phải lớn hơn hoặc bằng số từ tối thiểu.');
          await onSave({
            ...(assignment ? { expectedRevision: assignment.revision || '' } : {}),
            classId,
            title,
            lessonId: lessonId || null,
            published,
            instructions,
            dueAt: new Date(`${dueDate}T${dueTime}:00+07:00`).toISOString(),
            allowLate,
            allowResubmit,
            maxAttempts,
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
      <fieldset className="stack form-controls" disabled={busy}>
        <Field label="Tiêu đề bài tập (bắt buộc)">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={180}
            required
          />
        </Field>
        <Field label="Bài học liên quan">
          <select
            value={lessonId}
            onChange={(e) => {
              setLessonId(e.target.value);
              if (assignment && !initiallyVisible && e.target.value !== (assignment.lessonId || ''))
                setPublished(false);
            }}
          >
            <option value="">Không gắn bài học</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                Bài {l.order}: {l.title}
              </option>
            ))}
          </select>
        </Field>
        <p className="small muted">
          Bài tập chỉ hiện khi được công bố và bài giảng liên quan đã xuất bản. Khi tạm ẩn, học viên
          đã nộp vẫn xem được bài làm và điểm; những học viên khác không thể nộp bài.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />
          Công bố bài tập
        </label>
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
          Cho phép học viên nộp lại trước hạn
        </label>
        {allowResubmit && (
          <Field label="Số lần nộp tối đa (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              required
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            />
          </Field>
        )}
        <ErrorLine error={error} />
        <FormActions
          busy={busy}
          onClose={onClose}
          label={assignment ? 'Lưu thay đổi' : 'Giao bài tập'}
        />
      </fieldset>
    </form>
  );
}
