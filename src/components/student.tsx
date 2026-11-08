'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  ArrowRight,
  ArrowLeft,
  Plus,
  BookOpen,
  ClipboardList,
  Clock,
  GraduationCap,
  Users,
  Check,
  CheckCircle2,
  ChevronRight,
  Lock,
  Play,
  Bookmark,
  FileText,
  UploadCloud,
  Download,
  Trash2,
  Send,
  Info,
  Calendar,
  Video,
  MessageSquare,
  NotebookPen,
  Copy,
  Settings,
} from 'lucide-react';
import { useLms } from './lms-provider';
import { DiscussionPanel } from './discussion';
import {
  Button,
  IconButton,
  Badge,
  Empty,
  Dialog,
  Field,
  PageHeading,
  Search,
  StoredVideo,
  Tabs,
} from './ui';
import { dateTime, fold, initials, words, youtubeId } from '@/lib/client';
import { uploadFile } from '@/lib/drive-upload';
import { AttachmentViewer, DriveVideoPlayer } from './drive';
import { acceptsWordCount, wordRequirement } from '@/lib/assignment-policy';
import { classTeacherNames, managesClass } from '@/lib/class-teachers';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';
import { readSessionDraft, removeSessionDraft, writeSessionDraft } from '@/lib/session-draft';
import type { Classroom, Lesson, Assignment, Attachment } from '@/lib/types';
function useQuery() {
  const params = useSearchParams();
  const path = usePathname();
  return {
    get: (key: string, fallback = '') => params.get(key) || fallback,
    set: (key: string, value: string) => {
      const p = new URLSearchParams(window.location.search);
      if (value) p.set(key, value);
      else p.delete(key);
      window.history.replaceState(null, '', `${path}?${p}`);
    },
  };
}
function ClassNavigation({ classId, active }: { classId: string; active: string }) {
  return (
    <nav className="class-tabs" aria-label="Điều hướng lớp học">
      {[
        { id: 'overview', label: 'Tổng quan', icon: BookOpen },
        { id: 'lessons', label: 'Bài học', icon: Video },
        { id: 'assignments', label: 'Bài tập', icon: ClipboardList },
        { id: 'members', label: 'Thành viên', icon: Users },
        { id: 'info', label: 'Thông tin lớp', icon: Info },
      ].map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          href={id === 'members' ? `/classes/${classId}/members` : `/classes/${classId}?tab=${id}`}
          className={active === id ? 'active' : ''}
        >
          <Icon size={16} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
function ClassBreadcrumb({ classroom, tail }: { classroom: Classroom; tail?: string }) {
  return (
    <>
      <Link href="/classes">Lớp của tôi</Link>
      <ChevronRight size={13} />
      <Link href={`/classes/${classroom.id}`}>{classroom.title}</Link>
      {tail && (
        <>
          <ChevronRight size={13} />
          <span>{tail}</span>
        </>
      )}
    </>
  );
}
function NotFound() {
  return (
    <Empty
      title="Không tìm thấy nội dung"
      description="Nội dung có thể chưa được xuất bản hoặc bạn chưa tham gia lớp học này."
    >
      <Link className="button primary" href="/classes">
        Về lớp của tôi
      </Link>
    </Empty>
  );
}
function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="progress-caption">
        <span>Tiến độ bài học</span>
        <strong>
          {done}/{total} bài ({percent}%)
        </strong>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-label="Tiến độ học tập"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
export function ClassList() {
  const { state, action } = useLms();
  const query = useQuery();
  const tab = query.get('status', 'active');
  const search = query.get('q');
  const [join, setJoin] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    teacher: string;
    description: string;
    autoApprove: boolean;
  } | null>(null);
  const enrollments = state.enrollments.filter(
    (e) => e.userId === state.user.id && e.status !== 'REMOVED',
  );
  const all = state.classes.filter((c) => enrollments.some((e) => e.classId === c.id));
  function inTab(c: Classroom, t: string) {
    const e = enrollments.find((e) => e.classId === c.id);
    return t === 'archived'
      ? c.status === 'ARCHIVED'
      : t === 'pending'
        ? e?.status === 'PENDING'
        : c.status === 'ACTIVE' && e?.status === 'APPROVED';
  }
  const list = all.filter(
    (c) =>
      inTab(c, tab) &&
      fold(c.title + ' ' + c.code + ' ' + classTeacherNames(c, state.users)).includes(fold(search)),
  );
  const allTasks = state.assignments
    .filter(
      (a) =>
        all.some((c) => c.id === a.classId && c.status === 'ACTIVE') &&
        enrollments.some((e) => e.classId === a.classId && e.status === 'APPROVED') &&
        !state.submissions.some(
          (s) => s.assignmentId === a.id && s.studentId === state.user.id && s.status !== 'DRAFT',
        ),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const tasks = allTasks.slice(0, 3);
  return (
    <>
      <div className="welcome">
        <div>
          {state.demo && (
            <span className="demo-label">Dữ liệu minh họa cho hành trình học tập</span>
          )}
          <h1>Chào bạn {state.user.name},</h1>
          <p>Tiếp tục bài học, mang điều đã học vào cuộc sống.</p>
        </div>
        <div className="welcome-quote">
          <blockquote>“Giúp đỡ người là niềm vui chân thật.”</blockquote>
          <cite>Pháp sư Tịnh Không</cite>
        </div>
      </div>
      <div className="toolbar">
        <Tabs
          value={tab}
          onChange={(v) => query.set('status', v)}
          items={[
            {
              id: 'active',
              label: 'Đang học',
              count: all.filter((c) => inTab(c, 'active')).length,
            },
            {
              id: 'pending',
              label: 'Chờ duyệt',
              count: all.filter((c) => inTab(c, 'pending')).length,
            },
            {
              id: 'archived',
              label: 'Đã lưu trữ',
              count: all.filter((c) => inTab(c, 'archived')).length,
            },
          ]}
        />
        <Search
          value={search}
          onChange={(v) => query.set('q', v)}
          placeholder="Tìm tên lớp hoặc giáo viên…"
        />
        <Button
          onClick={() => {
            setJoin(true);
            setResult(false);
            setPreview(null);
            setError('');
            setCode('');
          }}
        >
          <Plus size={17} />
          Tham gia bằng mã
        </Button>
      </div>
      <div className="student-layout">
        <section aria-label="Danh sách lớp học">
          {list.length ? (
            <div className="card-grid">
              {list.map((c) => {
                const lessons = state.lessons.filter((l) => l.classId === c.id && l.published);
                const done = state.progress.filter(
                  (p) =>
                    p.userId === state.user.id &&
                    p.completed &&
                    lessons.some((l) => l.id === p.lessonId),
                ).length;
                const teachers = classTeacherNames(c, state.users);
                const task = allTasks.find((a) => a.classId === c.id);
                const pending = enrollments.find((e) => e.classId === c.id)?.status === 'PENDING';
                return (
                  <article className="class-card" key={c.id}>
                    <div className="class-cover">
                      <div className="cover-meta">
                        <span aria-label="Mã lớp">{c.code}</span>
                        <Badge>
                          {pending
                            ? 'Chờ phê duyệt'
                            : c.status === 'ARCHIVED'
                              ? 'Đã lưu trữ'
                              : 'Đang diễn ra'}
                        </Badge>
                      </div>
                      <div>
                        <h2>{c.title}</h2>
                        {c.description && <p>{c.description}</p>}
                      </div>
                    </div>
                    <div className="class-body">
                      <div className="class-teacher">
                        <span className="avatar">
                          <GraduationCap size={21} />
                        </span>
                        <div>
                          <small>Giáo viên phụ trách</small>
                          <strong>{teachers}</strong>
                          {c.contentAuthor && <small>Nội dung: {c.contentAuthor}</small>}
                        </div>
                      </div>
                      <ProgressBar done={done} total={lessons.length} />
                      {task && !pending && (
                        <div className="class-assignment">
                          <ClipboardList size={18} />
                          <div>
                            <span>Bài tập chưa nộp</span>
                            <strong>{task.title}</strong>
                            <time>Hạn nộp: {dateTime(task.dueAt)}</time>
                          </div>
                        </div>
                      )}
                      <div className="class-bottom">
                        <small>
                          {
                            state.enrollments.filter(
                              (e) => e.classId === c.id && e.status === 'APPROVED',
                            ).length
                          }{' '}
                          học viên
                        </small>
                        {pending ? (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await action('cancelEnrollment', { classId: c.id });
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Hủy yêu cầu
                          </Button>
                        ) : (
                          <div className="inline-actions">
                            {c.status === 'ACTIVE' && (
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      'Rời lớp? Bài làm, điểm và lịch sử được giữ lại nếu bạn tham gia lại.',
                                    )
                                  )
                                    return;
                                  setBusy(true);
                                  try {
                                    await action('leaveClass', {
                                      classId: c.id,
                                      expectedJoinedAt: enrollments.find(
                                        (entry) => entry.classId === c.id,
                                      )?.joinedAt,
                                    });
                                  } catch (e) {
                                    setError((e as Error).message);
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                Rời lớp
                              </Button>
                            )}
                            <Link className="button primary" href={`/classes/${c.id}`}>
                              Vào lớp <ArrowRight size={16} />
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title={
                  search
                    ? 'Chưa tìm thấy lớp phù hợp'
                    : tab === 'pending'
                      ? 'Không có yêu cầu chờ duyệt'
                      : tab === 'archived'
                        ? 'Chưa có lớp lưu trữ'
                        : 'Hành trình bắt đầu từ một lớp học'
                }
                description={
                  search
                    ? 'Thử tìm bằng tên lớp, mã lớp hoặc tên giáo viên.'
                    : 'Nhập mã lớp do giáo viên cung cấp để bắt đầu học tập.'
                }
              >
                <Button variant="secondary" onClick={() => setJoin(true)}>
                  Nhập mã lớp
                </Button>
              </Empty>
            </div>
          )}
          {error && !join && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="student-aside">
          <div className="side-note">
            <h3>Bài tập chưa nộp</h3>
            {tasks.length ? (
              tasks.map((a) => (
                <Link key={a.id} href={`/classes/${a.classId}/assignments/${a.id}`}>
                  <Calendar size={18} />
                  <div>
                    <strong>{a.title}</strong>
                    <small>{dateTime(a.dueAt)} (GMT+7)</small>
                  </div>
                </Link>
              ))
            ) : (
              <p>Không có bài tập chưa nộp trong các lớp đang học.</p>
            )}
          </div>
          <div className="side-note">
            <h3>Học đi đôi với hành</h3>
            <p>
              Dành một chút thời gian sau mỗi bài giảng để ghi lại điều tâm đắc và một việc tốt bạn
              muốn thực hành.
            </p>
          </div>
        </aside>
      </div>
      <Dialog open={join} title="Tham gia lớp học" onClose={() => setJoin(false)}>
        {result ? (
          <div className="stack">
            <div className="notice success">
              <CheckCircle2 size={20} />
              Yêu cầu của bạn đã được ghi nhận. Lớp học sẽ xuất hiện trong danh sách đang học hoặc
              chờ duyệt.
            </div>
            <Button onClick={() => setJoin(false)}>Về danh sách lớp</Button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (!preview) {
                  setPreview(
                    (await action('previewClass', { code: code.trim().toUpperCase() })) as {
                      title: string;
                      teacher: string;
                      description: string;
                      autoApprove: boolean;
                    },
                  );
                } else {
                  await action('joinClass', { code: code.trim().toUpperCase() });
                  setResult(true);
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="stack"
          >
            <p className="muted small">
              Nhập mã được giáo viên chia sẻ. Bạn có thể cần chờ giáo viên phê duyệt trước khi vào
              lớp.
            </p>
            <Field label="Mã lớp học" hint="Nhập mã do giáo viên cung cấp.">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setPreview(null);
                }}
                required
                maxLength={30}
                placeholder="Nhập mã lớp"
                autoFocus
              />
            </Field>
            {preview && (
              <div className="notice stack">
                <h3>{preview.title}</h3>
                <p>Giáo viên: {preview.teacher}</p>
                <p>{preview.description}</p>
                <p>
                  {preview.autoApprove
                    ? 'Bạn có thể vào lớp ngay sau khi tham gia.'
                    : 'Yêu cầu tham gia sẽ được giáo viên phê duyệt.'}
                </p>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              <Button type="button" variant="ghost" onClick={() => setJoin(false)}>
                Để sau
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Đang xử lý…' : preview ? 'Xác nhận tham gia' : 'Kiểm tra mã lớp'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
export function ClassDetail({ classId }: { classId: string }) {
  const { state } = useLms();
  const query = useQuery();
  const tab = query.get('tab', 'overview');
  const c = state.classes.find((c) => c.id === classId);
  if (!c) return <NotFound />;
  const lessons = state.lessons
    .filter((l) => l.classId === classId && l.published)
    .sort((a, b) => a.order - b.order);
  const done = state.progress.filter(
    (p) => p.userId === state.user.id && p.completed && lessons.some((l) => l.id === p.lessonId),
  ).length;
  const completedAll = lessons.length > 0 && done === lessons.length;
  const next =
    lessons.find(
      (l) =>
        !state.progress.some(
          (p) => p.lessonId === l.id && p.userId === state.user.id && p.completed,
        ),
    ) || lessons[0];
  const assignments = state.assignments
    .filter((a) => a.classId === classId)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const teachers = classTeacherNames(c, state.users);
  return (
    <>
      <PageHeading
        title={c.title}
        description={c.description}
        breadcrumb={
          <>
            <Link href="/classes">
              <ArrowLeft size={14} /> Lớp của tôi
            </Link>
            <span>/</span>
            <span>{c.code}</span>
          </>
        }
        actions={
          <>
            {next && (
              <Link className="button primary" href={`/classes/${classId}/lessons/${next.id}`}>
                <Play size={16} />
                {completedAll ? 'Học lại' : 'Học tiếp'}
              </Link>
            )}
            {managesClass(c, state.user) && (
              <Link href="/teacher/classes" className="button secondary">
                <Settings size={16} />
                Quản lý lớp
              </Link>
            )}
          </>
        }
      />
      <ClassNavigation classId={classId} active={tab} />
      {tab === 'lessons' ? (
        <div className="panel">
          <div className="section-heading">
            <h2>Hành trình học tập</h2>
            <span className="small muted">
              {done}/{lessons.length} bài đã hoàn thành
            </span>
          </div>
          <LessonList classId={classId} lessons={lessons} />
        </div>
      ) : tab === 'assignments' ? (
        <div className="stack">
          {assignments.length ? (
            assignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)
          ) : (
            <Empty
              title="Chưa có bài tập"
              description="Bài tập mới sẽ xuất hiện tại đây khi giáo viên giao bài."
            />
          )}
        </div>
      ) : tab === 'info' ? (
        <div className="split">
          <section className="panel stack">
            <h2>Thông tin lớp học</h2>
            <p className="reading-copy">{c.description}</p>
            <div className="list-row">
              <span>Giáo viên phụ trách</span>
              <strong>{teachers}</strong>
            </div>
            <div className="list-row">
              <span>Lịch học</span>
              <strong>{c.schedule || 'Chưa có lịch học'}</strong>
            </div>
            <div className="list-row">
              <span>Trạng thái lớp</span>
              <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {c.status === 'ACTIVE' ? 'Đang diễn ra' : 'Đã lưu trữ'}
              </Badge>
            </div>
          </section>
          <section className="panel stack">
            <h2>Quy ước giảng đường</h2>
            <ul className="help-list">
              <li>Lắng nghe với tâm chân thành, học cùng sự khiêm nhường.</li>
              <li>Chia sẻ những trải nghiệm thực tế của chính mình.</li>
              <li>Tôn trọng giáo viên và bạn học trong mọi trao đổi.</li>
            </ul>
          </section>
        </div>
      ) : (
        <div className="split">
          <div className="stack">
            {next ? (
              <section className="continue-panel">
                <div className="row between">
                  <Badge>{completedAll ? 'Đã hoàn thành' : 'Tiếp tục học tập'}</Badge>
                  <span className="small muted">
                    {done}/{lessons.length} bài hoàn thành
                  </span>
                </div>
                <h2>
                  Bài {next.order}: {next.title}
                </h2>
                <p className="small muted">{next.chapter}</p>
                <ProgressBar done={done} total={lessons.length} />
                <div className="row between" style={{ marginTop: 20 }}>
                  <span className="small muted">Học từng bài, thực hành mỗi ngày.</span>
                  <Link className="button primary" href={`/classes/${classId}/lessons/${next.id}`}>
                    {completedAll ? 'Học lại' : 'Tiếp tục học'}
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </section>
            ) : (
              <Empty
                title="Bài giảng đang được chuẩn bị"
                description="Giáo viên sẽ thông báo khi có bài học mới."
              />
            )}
            {assignments.slice(0, 2).map((a) => (
              <AssignmentCard key={a.id} assignment={a} />
            ))}
          </div>
          <aside className="stack">
            <section className="panel stack">
              <h2>Giảng đường của bạn</h2>
              <div className="member-profile">
                <span className="avatar">{initials(teachers)}</span>
                <div>
                  <strong>{teachers}</strong>
                  <p>Giáo viên phụ trách</p>
                </div>
              </div>
              <div className="list-row">
                <span className="small muted">Học viên</span>
                <strong>
                  {
                    state.enrollments.filter(
                      (e) => e.classId === classId && e.status === 'APPROVED',
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span className="small muted">Lịch học</span>
                <p className="small">{c.schedule || 'Chưa có lịch học'}</p>
              </div>
              <Link className="text-link small" href={`/classes/${classId}/members`}>
                Gặp gỡ thành viên
              </Link>
            </section>
            <section className="panel stack">
              <h2>Quy định nộp bài</h2>
              <ul className="help-list">
                <li>Theo dõi thời hạn của từng bài tập.</li>
                <li>Bài viết cần thể hiện suy nghĩ và trải nghiệm của bạn.</li>
                <li>Đọc kỹ phản hồi của giáo viên sau khi bài được chấm.</li>
              </ul>
              <p className="small muted">
                Cần hỗ trợ? Trao đổi với giáo viên trong phần thảo luận bài học.
              </p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
function LessonList({ classId, lessons }: { classId: string; lessons: Lesson[] }) {
  const { state } = useLms();
  if (!lessons.length)
    return (
      <Empty
        title="Chưa có bài giảng"
        description="Những bài giảng đã xuất bản sẽ xuất hiện tại đây."
      />
    );
  let chapter = '';
  return (
    <div>
      {lessons.map((l) => {
        const completed = state.progress.some(
          (p) => p.userId === state.user.id && p.lessonId === l.id && p.completed,
        );
        const heading = chapter !== l.chapter;
        chapter = l.chapter;
        return (
          <div key={l.id}>
            {heading && <div className="curriculum-chapter">{l.chapter}</div>}
            <Link href={`/classes/${classId}/lessons/${l.id}`} className="list-row">
              <span className={`lesson-number ${completed ? 'completed' : ''}`}>
                {completed ? <Check size={16} /> : String(l.order).padStart(2, '0')}
              </span>
              <div className="lesson-info">
                <strong>{l.title}</strong>
                <p>{l.duration || 'Bài giảng trực tuyến'}</p>
              </div>
              {completed ? <Badge tone="success">Đã học</Badge> : <Play size={17} />}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
function AssignmentCard({ assignment: a }: { assignment: Assignment }) {
  const { state } = useLms();
  const sub = state.submissions.find(
    (s) => s.assignmentId === a.id && s.studentId === state.user.id,
  );
  return (
    <article className="panel">
      <div className="section-heading">
        <Badge
          tone={
            sub?.status === 'GRADED'
              ? 'success'
              : sub?.status === 'SUBMITTED'
                ? 'neutral'
                : 'warning'
          }
        >
          {sub?.status === 'GRADED'
            ? 'Đã chấm'
            : sub?.status === 'SUBMITTED'
              ? 'Đã nộp'
              : sub?.status === 'DRAFT'
                ? 'Bản nháp'
                : 'Chưa nộp'}
        </Badge>
        <span className="small muted">Hạn: {dateTime(a.dueAt)}</span>
      </div>
      <h3>{a.title}</h3>
      <p className="small muted" style={{ margin: '12px 0 22px' }}>
        {a.instructions}
      </p>
      <div className="row between">
        <span className="small muted">
          {sub?.status === 'GRADED'
            ? `${sub.score}/100 điểm`
            : `${wordRequirement(a)} hoặc tệp đính kèm`}
        </span>
        <Link className="button secondary" href={`/classes/${a.classId}/assignments/${a.id}`}>
          Xem bài tập
          <ArrowRight size={15} />
        </Link>
      </div>
    </article>
  );
}
export function LessonPage({ classId, lessonId }: { classId: string; lessonId: string }) {
  const { state, action } = useLms();
  const query = useQuery();
  const tab = query.get('tab', 'materials');
  const c = state.classes.find((c) => c.id === classId);
  const lesson = state.lessons.find((l) => l.id === lessonId && l.classId === classId);
  const [note, setNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteVersion, setNoteVersion] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const noteKey = `lms-draft:note:${state.user.id}:${lessonId}`;
  useUnsavedWarning(noteDirty);
  useEffect(() => {
    const savedNote = state.notes.find(
      (n) => n.lessonId === lessonId && n.userId === state.user.id,
    );
    const draft = readSessionDraft<{ content: string; version: string | null }>(noteKey);
    setNote(draft?.content ?? savedNote?.content ?? '');
    setNoteVersion(draft ? draft.version : savedNote?.updatedAt || null);
    setNoteDirty(!!draft);
    setError('');
    setSaved(false);
  }, [lessonId, state.user.id]);
  useEffect(() => {
    if (noteDirty) writeSessionDraft(noteKey, { content: note, version: noteVersion });
  }, [noteDirty, note, noteVersion, noteKey]);
  if (!c || !lesson) return <NotFound />;
  const lessons = state.lessons
    .filter((l) => l.classId === classId && l.published)
    .sort((a, b) => a.order - b.order);
  const progress = state.progress.find(
    (p) => p.lessonId === lessonId && p.userId === state.user.id,
  );
  const related = state.assignments.filter((a) => a.classId === classId && a.lessonId === lessonId);
  const learner =
    state.enrollments.some(
      (e) => e.classId === classId && e.userId === state.user.id && e.status === 'APPROVED',
    ) && !managesClass(c, state.user);
  const yid = youtubeId(lesson.videoUrl);
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
  return (
    <>
      <PageHeading
        title={`Bài ${lesson.order}: ${lesson.title}`}
        description={lesson.chapter}
        breadcrumb={<ClassBreadcrumb classroom={c} tail="Bài học" />}
      />
      <div className="lesson-workspace">
        <div className="stack">
          <div>
            <div className="video-frame">
              {lesson.videoType === 'YOUTUBE' && yid ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${yid}`}
                  title={lesson.title}
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : lesson.videoType === 'DRIVE' && lesson.driveFileId ? (
                <DriveVideoPlayer fileId={lesson.driveFileId} title={lesson.title} />
              ) : lesson.videoType === 'UPLOAD' && lesson.videoFileId ? (
                <StoredVideo src={`/api/files/${lesson.videoFileId}`} />
              ) : (
                <div className="video-placeholder">
                  <Video size={40} strokeWidth={1.3} />
                  <h3>Bài học không có video</h3>
                  <p>Xem nội dung và tài liệu bài học bên dưới.</p>
                </div>
              )}
            </div>
            <div className="lesson-actions">
              <div className="row">
                <Clock size={15} />
                <span className="small muted">{lesson.duration || 'Học theo tiến độ của bạn'}</span>
                {learner && c.status === 'ACTIVE' && (
                  <IconButton
                    label={progress?.bookmarked ? 'Bỏ lưu bài học' : 'Lưu bài học'}
                    disabled={busy}
                    onClick={() =>
                      void run('bookmarkLesson', { lessonId, bookmarked: !progress?.bookmarked })
                    }
                  >
                    <Bookmark size={19} fill={progress?.bookmarked ? 'currentColor' : 'none'} />
                  </IconButton>
                )}
              </div>
              {learner && c.status === 'ACTIVE' && (
                <Button
                  variant={progress?.completed ? 'secondary' : 'primary'}
                  disabled={busy}
                  onClick={() =>
                    void run('completeLesson', { lessonId, completed: !progress?.completed })
                  }
                >
                  <CheckCircle2 size={17} />
                  {progress?.completed ? 'Đã hoàn thành' : 'Đánh dấu hoàn thành'}
                </Button>
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <section className="panel stack">
            <Tabs
              value={tab}
              onChange={(v) => query.set('tab', v)}
              items={[
                { id: 'materials', label: 'Nội dung & tài liệu' },
                { id: 'notes', label: 'Ghi chép của tôi' },
                { id: 'discussion', label: 'Thảo luận' },
              ]}
            />
            {tab === 'notes' ? (
              <div className="stack">
                <p className="small muted">
                  Ghi lại điều bạn tâm đắc. Chỉ bạn có thể xem những ghi chép này.
                </p>
                <Field label="Ghi chép cá nhân">
                  <textarea
                    className="note-editor"
                    value={note}
                    maxLength={10000}
                    disabled={busy || c.status === 'ARCHIVED'}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setSaved(false);
                      setNoteDirty(true);
                    }}
                    placeholder="Điều tôi học được hôm nay…"
                  />
                </Field>
                <div className="row between">
                  <span className="small muted" role="status">
                    {saved ? 'Ghi chép đã được lưu.' : `${note.length}/10.000 ký tự`}
                  </span>
                  <Button
                    disabled={busy || c.status === 'ARCHIVED'}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = (await action('saveNote', {
                          lessonId,
                          content: note,
                          expectedUpdatedAt: noteVersion,
                        })) as { updatedAt: string };
                        setNoteVersion(result.updatedAt);
                        setNoteDirty(false);
                        removeSessionDraft(noteKey);
                        setSaved(true);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Lưu ghi chép
                  </Button>
                </div>
              </div>
            ) : tab === 'discussion' ? null : (
              <div className="stack">
                <div>
                  <h2>Mô tả bài học</h2>
                  <p className="reading-copy" style={{ marginTop: 14 }}>
                    {lesson.description || 'Giáo viên chưa bổ sung mô tả cho bài học này.'}
                  </p>
                </div>
                {lesson.timestamps.length > 0 && (
                  <div>
                    <h3>Các mốc nội dung</h3>
                    {lesson.timestamps.map((t, i) => (
                      <div className="list-row" key={i}>
                        <span className="badge">{t.time}</span>
                        <span className="small">{t.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <h3>Tài liệu bài học</h3>
                  {lesson.documents.length ? (
                    <div className="stack" style={{ marginTop: 14 }}>
                      {lesson.documents.map((d) => (
                        <FileAttachment key={d.id} file={d} />
                      ))}
                    </div>
                  ) : (
                    <p className="small muted" style={{ marginTop: 10 }}>
                      Bài học này chưa có tài liệu đính kèm.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div hidden={tab !== 'discussion'}>
              <DiscussionPanel key={lessonId} lessonId={lessonId} classId={classId} />
            </div>
          </section>
          {related.map((assignment) => (
            <AssignmentCard key={assignment.id} assignment={assignment} />
          ))}
        </div>
        <aside className="panel" style={{ padding: 0 }}>
          <div className="curriculum-heading">
            <h2>Nội dung khóa học</h2>
            <p className="small muted" style={{ marginTop: 8 }}>
              {lessons.length} bài giảng
            </p>
          </div>
          <div className="curriculum">
            {lessons.map((l) => {
              const completed = state.progress.some(
                (p) => p.lessonId === l.id && p.userId === state.user.id && p.completed,
              );
              return (
                <Link
                  key={l.id}
                  className={`lesson-item ${l.id === lessonId ? 'selected' : ''}`}
                  href={`/classes/${classId}/lessons/${l.id}`}
                >
                  <span className={`lesson-number ${completed ? 'completed' : ''}`}>
                    {completed ? <Check size={15} /> : l.order}
                  </span>
                  <span>
                    <strong>{l.title}</strong>
                    <small>{l.duration || l.chapter}</small>
                  </span>
                  {l.id === lessonId && <Play size={14} className="accent" />}
                </Link>
              );
            })}
          </div>
          <div style={{ padding: 17 }}>
            <Link href={`/classes/${classId}?tab=lessons`} className="text-link small">
              Xem toàn bộ bài học
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
function FileAttachment({
  file,
  onRemove,
  disabled,
}: {
  file: Attachment;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="attachment">
      <FileText size={17} />
      <a href={file.url || `/api/files/${file.id}`} target="_blank" rel="noreferrer">
        {file.name}
      </a>
      <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
      <AttachmentViewer file={file} />
      {onRemove ? (
        <IconButton label="Gỡ tệp" onClick={onRemove} disabled={disabled}>
          <Trash2 size={15} />
        </IconButton>
      ) : (
        <Download size={15} />
      )}
    </div>
  );
}
export function AssignmentPage({
  classId,
  assignmentId,
}: {
  classId: string;
  assignmentId: string;
}) {
  const { state, action } = useLms();
  const c = state.classes.find((c) => c.id === classId);
  const assignment = state.assignments.find((a) => a.id === assignmentId && a.classId === classId);
  const submission = state.submissions.find(
    (s) => s.assignmentId === assignmentId && s.studentId === state.user.id,
  );
  const [content, setContent] = useState(submission?.content || '');
  const [link, setLink] = useState(submission?.link || '');
  const [files, setFiles] = useState<Attachment[]>(submission?.attachments || []);
  const [pledge, setPledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(submission?.revision || '');
  const draftKey = `lms-draft:submission:${state.user.id}:${assignmentId}`;
  useUnsavedWarning(dirty);
  const editing = !submission || submission.status === 'DRAFT';
  useEffect(() => {
    const draft = readSessionDraft<{
      content: string;
      link: string;
      files: Attachment[];
      revision: string;
    }>(draftKey);
    setContent(draft?.content ?? submission?.content ?? '');
    setLink(draft?.link ?? submission?.link ?? '');
    setFiles(draft?.files ?? submission?.attachments ?? []);
    setRevision(draft?.revision ?? submission?.revision ?? '');
    setDirty(!!draft);
    setPledge(false);
    setError('');
  }, [assignmentId, state.user.id]);
  useEffect(() => {
    if (dirty) writeSessionDraft(draftKey, { content, link, files, revision });
  }, [dirty, draftKey, content, link, files, revision]);
  if (!c || !assignment) return <NotFound />;
  if (managesClass(c, state.user))
    return (
      <>
        <PageHeading
          title={assignment.title}
          description={`Hạn nộp: ${dateTime(assignment.dueAt)} (GMT+7)`}
          breadcrumb={<ClassBreadcrumb classroom={c} tail="Bài tập" />}
        />
        <section className="panel stack">
          <h2>Đề bài & hướng dẫn</h2>
          <p className="reading-copy">{assignment.instructions}</p>
          <Link
            className="button primary"
            href={`/teacher/assignments?class=${c.id}&assignment=${assignment.id}`}
          >
            Xem và chấm bài
          </Link>
        </section>
      </>
    );
  const a = assignment;
  const count = words(content);
  const hasSubmitted = !!submission && submission.status !== 'DRAFT';
  const archived = c.status === 'ARCHIVED' || a.published === false;
  const pastDue = !a.allowLate && Date.now() > Date.parse(a.dueAt);
  async function save(submit: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = (await action(submit ? 'submitAssignment' : 'saveSubmission', {
        assignmentId,
        content,
        link,
        attachments: files,
        pledge,
        expectedRevision: revision,
      })) as { revision?: string };
      setRevision(result.revision || '');
      setDirty(false);
      removeSessionDraft(draftKey);
      setConfirm(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={a.title}
        description={`Hạn nộp: ${dateTime(a.dueAt)} (GMT+7)`}
        breadcrumb={<ClassBreadcrumb classroom={c} tail="Nộp bài tập" />}
        actions={
          <Badge
            tone={
              submission?.status === 'GRADED' ? 'success' : hasSubmitted ? 'neutral' : 'warning'
            }
          >
            {submission?.status === 'GRADED'
              ? 'Đã chấm'
              : hasSubmitted
                ? 'Đã nộp bài'
                : 'Chưa nộp bài'}
          </Badge>
        }
      />
      <div className="split">
        <div className="stack">
          <section className="panel stack">
            <h2>Đề bài & hướng dẫn</h2>
            {a.published === false && (
              <p className="notice">Bài tập đang tạm ẩn. Bạn vẫn có thể xem bài đã nộp và điểm.</p>
            )}
            <p className="reading-copy">{a.instructions}</p>
            <div className="notice">
              <Info size={18} />
              <span>
                Viết {wordRequirement(a)} hoặc đính kèm PDF, DOCX, PPTX, JPG, PNG (tối đa 25 MB)
                hoặc video MP4, WebM, MOV (tối đa 2 GB).
              </span>
            </div>
          </section>
          {submission?.status === 'GRADED' && (
            <section className="panel stack">
              <div className="section-heading">
                <h2>Nhận xét của giáo viên</h2>
                <Badge tone="success">Đã trả bài</Badge>
              </div>
              <div className="assignment-result">
                {submission.score}
                <span className="small muted"> / 100 điểm</span>
              </div>
              <p className="reading-copy">
                {submission.feedback || 'Giáo viên chưa để lại nhận xét.'}
              </p>
              {submission.rubric && (
                <div className="rubric-list">
                  <div>
                    <span>Hiểu nội dung</span>
                    <strong>{submission.rubric.understanding}/40</strong>
                  </div>
                  <div>
                    <span>Liên hệ thực hành</span>
                    <strong>{submission.rubric.application}/40</strong>
                  </div>
                  <div>
                    <span>Trình bày</span>
                    <strong>{submission.rubric.presentation}/20</strong>
                  </div>
                </div>
              )}
            </section>
          )}
          {!editing && dirty && (
            <section className="panel stack" aria-label="Bản đang viết chưa gửi">
              <h2>Bản đang viết chưa gửi</h2>
              <p className="notice" role="status">
                Bài đã được nộp từ một phiên khác. Bản đang viết của bạn được giữ lại bên dưới để
                sao chép; nội dung này chưa thay thế bài đã nộp.
              </p>
              <Field label="Nội dung bản đang viết">
                <textarea aria-label="Nội dung bản đang viết" value={content} readOnly />
              </Field>
              {link && <p className="reading-copy">{link}</p>}
              {files.map((file) => (
                <FileAttachment key={file.id} file={file} />
              ))}
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        [
                          content,
                          link,
                          ...files.map(
                            (file) => file.url || `${window.location.origin}/api/files/${file.id}`,
                          ),
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      );
                      setError('');
                    } catch {
                      setError(
                        'Chưa thể sao chép tự động. Hãy chọn nội dung bản đang viết và sao chép.',
                      );
                    }
                  }}
                >
                  Sao chép bản đang viết
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!window.confirm('Xóa bản đang viết chưa gửi trên thiết bị này?')) return;
                    removeSessionDraft(draftKey);
                    setDirty(false);
                  }}
                >
                  Bỏ bản đang viết
                </Button>
              </div>
            </section>
          )}
          <section className="panel stack">
            <div className="section-heading">
              <h2>{editing ? 'Bài làm của bạn' : 'Bài đã nộp'}</h2>
              <span className="small muted">
                {hasSubmitted ? `Lần nộp ${submission?.attempt}/${a.maxAttempts}` : `${count} từ`}
              </span>
            </div>
            {editing ? (
              <>
                <Field
                  label="Bài thu hoạch"
                  hint={`${count} từ; yêu cầu ${wordRequirement(a)} nếu không đính kèm tệp.`}
                >
                  <textarea
                    className="assignment-editor"
                    aria-label="Bài thu hoạch"
                    value={content}
                    maxLength={50000}
                    disabled={busy || uploading || archived}
                    onChange={(e) => {
                      setContent(e.target.value);
                      setSaved(false);
                      setDirty(true);
                    }}
                    placeholder="Chia sẻ điều bạn hiểu và một tình huống bạn đã thực hành trong cuộc sống…"
                  />
                </Field>
                <div className="stack">
                  <label className="upload-zone">
                    <UploadCloud size={27} />
                    <strong>{uploading ? 'Đang tải tệp…' : 'Đính kèm bài làm'}</strong>
                    <span>PDF, DOCX, PPTX, JPG, PNG (25 MB) hoặc video MP4, WebM, MOV (2 GB)</span>
                    <input
                      type="file"
                      disabled={
                        uploading ||
                        busy ||
                        archived ||
                        !state.storageConfigured ||
                        files.length >= 10
                      }
                      accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.mp4,.webm,.mov"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setError('');
                        const isVideo = /\.(mp4|webm|mov)$/i.test(f.name);
                        if (f.size > (isVideo ? 2 * 1024 ** 3 : 25 * 1024 * 1024)) {
                          setError(
                            isVideo
                              ? 'Video phải nhỏ hơn hoặc bằng 2 GB.'
                              : 'Tệp phải nhỏ hơn hoặc bằng 25 MB.',
                          );
                          return;
                        }
                        setUploading(true);
                        try {
                          setFiles((prev) => [...prev]);
                          const uploaded = await uploadFile(f, classId, 'assignment');
                          setFiles((prev) => [...prev, uploaded]);
                          setSaved(false);
                          setDirty(true);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                  {!state.storageConfigured && (
                    <p className="small muted">
                      Google Drive chưa được kết nối nên chưa đính kèm được tệp; bạn có thể viết bài
                      trực tiếp.
                    </p>
                  )}
                  <p className="small muted">{files.length}/10 tệp đính kèm</p>
                  {files.map((f) => (
                    <FileAttachment
                      key={f.id}
                      file={f}
                      disabled={busy || uploading || archived}
                      onRemove={() => {
                        setFiles(files.filter((x) => x.id !== f.id));
                        setSaved(false);
                        setDirty(true);
                      }}
                    />
                  ))}
                </div>
                <Field label="Liên kết minh chứng (không bắt buộc)">
                  <input
                    type="url"
                    value={link}
                    disabled={busy || uploading || archived}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setSaved(false);
                      setDirty(true);
                    }}
                    placeholder="https://…"
                  />
                </Field>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={pledge}
                    disabled={busy || uploading || archived}
                    onChange={(e) => setPledge(e.target.checked)}
                  />
                  <span>Tôi xác nhận đây là bài làm của mình và các chia sẻ đều trung thực.</span>
                </label>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                {archived && (
                  <p className="notice">
                    {a.published === false
                      ? 'Bài tập đang tạm ẩn; bài làm chỉ được xem.'
                      : 'Lớp đã lưu trữ; bài làm chỉ được xem.'}
                  </p>
                )}
                {!archived && pastDue && (
                  <p className="notice">Đã hết hạn nộp. Bạn vẫn có thể lưu bản nháp.</p>
                )}
                <div className="row between">
                  <span className="small muted" role="status">
                    {saved ? 'Bản nháp đã lưu.' : 'Bài làm chưa được gửi cho giáo viên.'}
                  </span>
                  <div className="inline-actions">
                    <Button
                      variant="secondary"
                      disabled={busy || uploading || archived}
                      onClick={() => void save(false)}
                    >
                      Lưu nháp
                    </Button>
                    <Button
                      disabled={busy || uploading || archived || pastDue}
                      onClick={() => {
                        setError('');
                        if (!pledge) {
                          setError('Vui lòng xác nhận bài làm trung thực trước khi nộp.');
                          return;
                        }
                        if (!content.trim() && !files.length && !link.trim()) {
                          setError('Vui lòng nhập bài làm, đính kèm tệp hoặc liên kết minh chứng.');
                          return;
                        }
                        if (!files.length && !link.trim() && !acceptsWordCount(count, a)) {
                          setError(
                            `Bài viết cần ${wordRequirement(a)}, hoặc có tệp đính kèm/liên kết minh chứng.`,
                          );
                          return;
                        }
                        setConfirm(true);
                      }}
                    >
                      <Send size={15} />
                      Nộp bài
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="reading-copy">
                  {submission?.content ||
                    (submission?.attachments.length
                      ? 'Bài làm được gửi dưới dạng tệp đính kèm.'
                      : submission?.link
                        ? 'Bài làm được gửi bằng liên kết minh chứng.'
                        : 'Bài nộp không có nội dung văn bản, tệp hoặc liên kết.')}
                </p>
                {submission?.attachments.map((f) => (
                  <FileAttachment key={f.id} file={f} />
                ))}
                {submission?.link && (
                  <a
                    href={submission.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link small"
                  >
                    Xem liên kết minh chứng
                  </a>
                )}
                <div className="notice success">
                  <CheckCircle2 size={18} />
                  <span>
                    Bài đã được gửi lúc{' '}
                    {submission?.submittedAt ? dateTime(submission.submittedAt) : ''}. Bạn có thể
                    theo dõi kết quả tại đây.
                  </span>
                </div>
                {!archived &&
                  a.allowResubmit &&
                  submission?.status === 'SUBMITTED' &&
                  (submission?.attempt || 0) < a.maxAttempts &&
                  Date.now() <= new Date(a.dueAt).getTime() && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const result = (await action('withdrawSubmission', {
                            assignmentId,
                            expectedRevision: submission.revision || '',
                          })) as {
                            revision?: string;
                          };
                          setRevision(result.revision || '');
                          if (!dirty) {
                            setContent(submission.content);
                            setLink(submission.link);
                            setFiles(submission.attachments);
                          }
                          setPledge(false);
                          setSaved(false);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Chỉnh sửa & nộp lại
                    </Button>
                  )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="panel">
            <h2>Tiêu chí đánh giá</h2>
            <div className="rubric-list">
              <div>
                <span>Hiểu nội dung bài học</span>
                <strong>40 điểm</strong>
              </div>
              <div>
                <span>Liên hệ thực hành</span>
                <strong>40 điểm</strong>
              </div>
              <div>
                <span>Trình bày & diễn đạt</span>
                <strong>20 điểm</strong>
              </div>
            </div>
            <p className="small muted">
              Điểm số ghi nhận sự hiểu bài và cách bạn vận dụng vào thực tế.
            </p>
          </section>
          <section className="panel stack">
            <h2>Lưu ý nộp bài</h2>
            <ul className="help-list">
              <li>
                {a.allowLate
                  ? 'Lớp chấp nhận bài nộp muộn.'
                  : 'Bài tập cần được nộp trước thời hạn.'}
              </li>
              <li>
                {a.allowResubmit
                  ? `Bạn có tối đa ${a.maxAttempts} lần nộp bài.`
                  : 'Bài tập chỉ được nộp một lần.'}
              </li>
              <li>Lưu nháp để tiếp tục viết khi quay lại.</li>
            </ul>
            <Link className="text-link small" href={`/classes/${classId}?tab=assignments`}>
              Xem bài tập của lớp
            </Link>
          </section>
        </aside>
      </div>
      <Dialog open={confirm} title="Xác nhận nộp bài" onClose={() => setConfirm(false)}>
        <div className="stack">
          <p className="small">
            Bài làm gồm {count} từ và {files.length} tệp đính kèm. Bạn đã sẵn sàng gửi cho giáo
            viên?
          </p>
          <p className="notice">
            {a.allowResubmit
              ? `Bạn được nộp tối đa ${a.maxAttempts} lần theo quy định của bài tập.`
              : 'Sau khi gửi, bạn không thể sửa bài làm này.'}
          </p>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Kiểm tra lại
            </Button>
            <Button disabled={busy} onClick={() => void save(true)}>
              {busy ? 'Đang nộp…' : 'Xác nhận nộp bài'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
export function MembersPage({ classId }: { classId: string }) {
  const { state } = useLms();
  const query = useQuery();
  const search = query.get('q');
  const group = query.get('group', 'all');
  const page = Math.max(1, Number(query.get('page', '1')) || 1);
  const c = state.classes.find((c) => c.id === classId);
  if (!c) return <NotFound />;
  const teachers = classTeacherNames(c, state.users);
  const members = state.enrollments
    .filter((e) => e.classId === classId && e.status === 'APPROVED')
    .map((e) => ({ ...e, user: state.users.find((u) => u.id === e.userId) }))
    .filter(
      (e) =>
        e.user &&
        fold(e.user.name).includes(fold(search)) &&
        (group === 'all' || e.group === Number(group)),
    );
  const pages = Math.max(1, Math.ceil(members.length / 10));
  const current = Math.min(page, pages);
  return (
    <>
      <PageHeading
        title="Thành viên lớp học"
        description={c.title}
        breadcrumb={<ClassBreadcrumb classroom={c} tail="Thành viên" />}
      />
      <ClassNavigation classId={classId} active="members" />
      <div className="two-col" style={{ marginBottom: 28 }}>
        <section className="panel">
          <div className="section-heading">
            <h2>Giáo viên phụ trách</h2>
            <Badge tone="success">Đồng hành cùng lớp</Badge>
          </div>
          <div className="member-profile">
            <span className="avatar">{initials(teachers)}</span>
            <div>
              <strong>{teachers}</strong>
              <p>Hướng dẫn học tập và phản hồi bài thực hành</p>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Nội dung giảng dạy</h2>
            <BookOpen size={20} className="accent" />
          </div>
          <div className="member-profile">
            <span className="avatar">
              <GraduationCap size={24} />
            </span>
            <div>
              <strong>{c.contentAuthor || 'Chưa cập nhật người giảng nội dung'}</strong>
              <p>{c.title}</p>
            </div>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>
            Bạn đồng học <span className="muted small">({members.length})</span>
          </h2>
        </div>
        <div className="toolbar">
          <Search
            value={search}
            onChange={(v) => query.set('q', v)}
            placeholder="Tìm tên học viên…"
          />
          <label className="field">
            <span className="sr-only">Nhóm học tập</span>
            <select
              aria-label="Nhóm học tập"
              value={group}
              onChange={(e) => query.set('group', e.target.value)}
            >
              <option value="all">Tất cả nhóm học tập</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  Nhóm {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {members.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Nhóm học tập</th>
                    <th>Ngày gửi yêu cầu</th>
                  </tr>
                </thead>
                <tbody>
                  {members.slice((current - 1) * 10, current * 10).map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="row">
                          <span className="avatar">{initials(e.user!.name)}</span>
                          <strong>
                            {e.user!.name}
                            {e.userId === state.user.id ? ' (Bạn)' : ''}
                          </strong>
                        </div>
                      </td>
                      <td>Nhóm {e.group}</td>
                      <td>{dateTime(e.joinedAt).split(' ')[1] || dateTime(e.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Trang {current}/{pages}
              </span>
              <div className="inline-actions">
                <Button
                  variant="ghost"
                  disabled={current <= 1}
                  onClick={() => query.set('page', String(current - 1))}
                >
                  Trước
                </Button>
                <Button
                  variant="ghost"
                  disabled={current >= pages}
                  onClick={() => query.set('page', String(current + 1))}
                >
                  Sau
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title="Không tìm thấy học viên"
            description="Thử tên khác hoặc chọn tất cả nhóm học tập."
          />
        )}
      </section>
    </>
  );
}
export function MyAssignments() {
  const { state } = useLms();
  const query = useQuery();
  const tab = query.get('status', 'todo');
  const search = query.get('q');
  const list = state.assignments
    .filter((a) => {
      if (
        !state.enrollments.some(
          (e) => e.classId === a.classId && e.userId === state.user.id && e.status === 'APPROVED',
        )
      )
        return false;
      const sub = state.submissions.find(
        (s) => s.assignmentId === a.id && s.studentId === state.user.id,
      );
      return (
        fold(a.title).includes(fold(search)) &&
        (tab === 'all' ||
          (tab === 'todo' && (!sub || sub.status === 'DRAFT')) ||
          (tab === 'submitted' && sub?.status === 'SUBMITTED') ||
          (tab === 'graded' && sub?.status === 'GRADED'))
      );
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return (
    <>
      <PageHeading
        title="Bài tập của tôi"
        description="Theo dõi bài thực hành, thời hạn và nhận xét từ giáo viên."
      />
      <div className="toolbar">
        <Tabs
          value={tab}
          onChange={(v) => query.set('status', v)}
          items={[
            { id: 'todo', label: 'Cần hoàn thành' },
            { id: 'submitted', label: 'Đã nộp' },
            { id: 'graded', label: 'Đã chấm' },
            { id: 'all', label: 'Tất cả' },
          ]}
        />
        <Search value={search} onChange={(v) => query.set('q', v)} placeholder="Tìm bài tập…" />
      </div>
      {list.length ? (
        <div className="two-col">
          {list.map((a) => (
            <AssignmentCard key={a.id} assignment={a} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Không có bài tập trong mục này"
            description="Bài tập và phản hồi mới sẽ xuất hiện khi giáo viên cập nhật."
          />
        </div>
      )}
    </>
  );
}
