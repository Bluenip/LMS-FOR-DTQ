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
  Megaphone,
  Calendar,
  Video,
  MessageSquare,
  NotebookPen,
  Copy,
  Settings,
} from 'lucide-react';
import { useLms } from './lms-provider';
import { Button, IconButton, Badge, Empty, Dialog, Field, PageHeading, Search, Tabs } from './ui';
import { dateTime, fold, initials, uploadFile, words, youtubeId } from '@/lib/client';
import { acceptsWordCount, wordRequirement } from '@/lib/assignment-policy';
import type { Classroom, Lesson, Assignment, Attachment } from '@/lib/types';
function useQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  return {
    get: (key: string, fallback = '') => params.get(key) || fallback,
    set: (key: string, value: string) => {
      const p = new URLSearchParams(params.toString());
      if (value) p.set(key, value);
      else p.delete(key);
      router.replace(`${path}?${p}`, { scroll: false });
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
  const enrollments = state.enrollments.filter((e) => e.userId === state.user.id);
  const all = state.classes.filter(
    (c) => state.user.role === 'TEACHER' || enrollments.some((e) => e.classId === c.id),
  );
  function inTab(c: Classroom, t: string) {
    const e = enrollments.find((e) => e.classId === c.id);
    return t === 'archived'
      ? c.status === 'ARCHIVED'
      : t === 'pending'
        ? e?.status === 'PENDING'
        : c.status === 'ACTIVE' && (state.user.role === 'TEACHER' || e?.status === 'APPROVED');
  }
  const list = all.filter(
    (c) =>
      inTab(c, tab) &&
      fold(
        c.title + ' ' + c.code + ' ' + state.users.find((u) => u.id === c.teacherId)?.name,
      ).includes(fold(search)),
  );
  const tasks = state.assignments
    .filter(
      (a) =>
        !state.submissions.some(
          (s) => s.assignmentId === a.id && s.studentId === state.user.id && s.status !== 'DRAFT',
        ),
    )
    .slice(0, 3);
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
          <blockquote>“Đệ tử quy, thánh nhân huấn.”</blockquote>
          <cite>Đệ Tử Quy, lời mở đầu</cite>
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
                const teacher = state.users.find((u) => u.id === c.teacherId);
                const task = tasks.find((a) => a.classId === c.id);
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
                        <p>Căn bản đạo làm con</p>
                      </div>
                    </div>
                    <div className="class-body">
                      <div className="class-teacher">
                        <span className="avatar">
                          <GraduationCap size={21} />
                        </span>
                        <div>
                          <small>Giáo viên phụ trách</small>
                          <strong>{teacher?.name || 'Giáo viên'}</strong>
                          {c.contentAuthor && <small>Nội dung: {c.contentAuthor}</small>}
                        </div>
                      </div>
                      <ProgressBar done={done} total={lessons.length} />
                      {task && !pending && (
                        <div className="class-assignment">
                          <ClipboardList size={18} />
                          <div>
                            <span>Bài tập sắp đến hạn</span>
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
                          <Link className="button primary" href={`/classes/${c.id}`}>
                            Vào lớp
                            <ArrowRight size={16} />
                          </Link>
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
            <h3>Việc học sắp tới</h3>
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
              <p>Bạn đã hoàn thành các bài tập hiện có.</p>
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
            <Field label="Mã lớp học" hint="Ví dụ: DTQ-2026">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setPreview(null);
                }}
                required
                maxLength={30}
                placeholder="DTQ-2026"
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
  const next =
    lessons.find(
      (l) =>
        !state.progress.some(
          (p) => p.lessonId === l.id && p.userId === state.user.id && p.completed,
        ),
    ) || lessons[0];
  const assignments = state.assignments.filter((a) => a.classId === classId);
  const teacher = state.users.find((u) => u.id === c.teacherId);
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
                Học tiếp
              </Link>
            )}
            {state.user.role === 'TEACHER' && (
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
              <strong>{teacher?.name}</strong>
            </div>
            <div className="list-row">
              <span>Lịch học</span>
              <strong>{c.schedule || 'Học chủ động theo tiến độ'}</strong>
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
            <section className="panel">
              <div className="section-heading">
                <div className="row">
                  <Megaphone size={20} className="accent" />
                  <h2>Thông báo lớp học</h2>
                </div>
                <Badge>Mới nhất</Badge>
              </div>
              <p className="reading-copy">
                Chào các bạn học viên! Hãy hoàn thành bài giảng, ghi lại điều tâm đắc và liên hệ với
                những việc thực tế trong gia đình. Thầy cô sẽ đồng hành cùng các bạn trong mỗi bài
                thực hành.
              </p>
              <p className="small muted" style={{ marginTop: 16 }}>
                {teacher?.name}
              </p>
            </section>
            {next ? (
              <section className="continue-panel">
                <div className="row between">
                  <Badge>Tiếp tục học tập</Badge>
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
                    Tiếp tục học
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
                <span className="avatar">{initials(teacher?.name || 'Tuệ Tâm')}</span>
                <div>
                  <strong>{teacher?.name}</strong>
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
                <p className="small">{c.schedule || 'Học theo tiến độ cá nhân'}</p>
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
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setNote(
      state.notes.find((n) => n.lessonId === lessonId && n.userId === state.user.id)?.content || '',
    );
    setError('');
    setSaved(false);
  }, [lessonId, state.user.id]);
  if (!c || !lesson) return <NotFound />;
  const lessons = state.lessons
    .filter((l) => l.classId === classId && l.published)
    .sort((a, b) => a.order - b.order);
  const progress = state.progress.find(
    (p) => p.lessonId === lessonId && p.userId === state.user.id,
  );
  const related =
    state.assignments.find((a) => a.lessonId === lessonId) ||
    state.assignments.find((a) => a.classId === classId);
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
              ) : lesson.videoType === 'UPLOAD' && lesson.videoFileId ? (
                <video
                  poster="/video-poster.svg"
                  controls
                  preload="metadata"
                  src={`/api/files/${lesson.videoFileId}`}
                />
              ) : (
                <div className="video-placeholder">
                  <Video size={40} strokeWidth={1.3} />
                  <h3>Video đang được chuẩn bị</h3>
                  <p>
                    Nội dung bài học và tài liệu vẫn có sẵn bên dưới. Giáo viên sẽ cập nhật video
                    trong thời gian tới.
                  </p>
                </div>
              )}
            </div>
            <div className="lesson-actions">
              <div className="row">
                <Clock size={15} />
                <span className="small muted">{lesson.duration || 'Học theo tiến độ của bạn'}</span>
                {state.user.role === 'STUDENT' && (
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
              {state.user.role === 'STUDENT' && (
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
                    onChange={(e) => {
                      setNote(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="Điều tôi học được hôm nay…"
                  />
                </Field>
                <div className="row between">
                  <span className="small muted" role="status">
                    {saved ? 'Ghi chép đã được lưu.' : `${note.length}/10.000 ký tự`}
                  </span>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      if (await run('saveNote', { lessonId, content: note })) setSaved(true);
                    }}
                  >
                    Lưu ghi chép
                  </Button>
                </div>
              </div>
            ) : tab === 'discussion' ? (
              <div>
                <form
                  className="stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run('comment', { lessonId, content: comment })) setComment('');
                  }}
                >
                  <Field label="Chia sẻ cùng lớp">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      required
                      maxLength={3000}
                      placeholder="Đặt câu hỏi hoặc chia sẻ trải nghiệm thực hành…"
                    />
                  </Field>
                  <div>
                    <Button type="submit" disabled={busy}>
                      <Send size={15} />
                      Gửi thảo luận
                    </Button>
                  </div>
                </form>
                {state.discussions
                  .filter((d) => d.lessonId === lessonId)
                  .map((d) => {
                    const u = state.users.find((u) => u.id === d.userId);
                    return (
                      <div className="discussion-item" key={d.id}>
                        <span className="avatar">{initials(u?.name || 'HV')}</span>
                        <div>
                          <strong>{u?.name || 'Học viên'}</strong>
                          <time>{dateTime(d.createdAt)}</time>
                          <p>{d.content}</p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="stack">
                <div>
                  <h2>Điều tâm đắc từ bài học</h2>
                  <p className="reading-copy" style={{ marginTop: 14 }}>
                    {lesson.description ||
                      'Lắng nghe bài giảng, suy ngẫm và thử thực hành một điều tốt trong sinh hoạt hằng ngày.'}
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
          </section>
          {related && <AssignmentCard assignment={related} />}
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
function FileAttachment({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  return (
    <div className="attachment">
      <FileText size={17} />
      <a href={file.url || `/api/files/${file.id}`} target="_blank" rel="noreferrer">
        {file.name}
      </a>
      <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
      {onRemove ? (
        <IconButton label="Gỡ tệp" onClick={onRemove}>
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
  const editing = !submission || submission.status === 'DRAFT';
  useEffect(() => {
    setContent(submission?.content || '');
    setLink(submission?.link || '');
    setFiles(submission?.attachments || []);
    setPledge(false);
    setError('');
  }, [assignmentId]);
  if (!c || !assignment) return <NotFound />;
  const a = assignment;
  const count = words(content);
  const hasSubmitted = !!submission && submission.status !== 'DRAFT';
  async function save(submit: boolean) {
    setBusy(true);
    setError('');
    try {
      await action(submit ? 'submitAssignment' : 'saveSubmission', {
        assignmentId,
        content,
        link,
        attachments: files,
        pledge,
      });
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
            <p className="reading-copy">{a.instructions}</p>
            <div className="notice">
              <Info size={18} />
              <span>
                Viết {wordRequirement(a)} hoặc đính kèm PDF, DOCX, JPG, PNG (tối đa 25 MB mỗi tệp).
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
                {submission.feedback || 'Giáo viên đã chấm bài của bạn.'}
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
                    onChange={(e) => {
                      setContent(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="Chia sẻ điều bạn hiểu và một tình huống bạn đã thực hành trong cuộc sống…"
                  />
                </Field>
                <div className="stack">
                  <label className="upload-zone">
                    <UploadCloud size={27} />
                    <strong>{uploading ? 'Đang tải tệp…' : 'Đính kèm bài làm'}</strong>
                    <span>PDF, DOCX, JPG, PNG; tối đa 25 MB</span>
                    <input
                      type="file"
                      disabled={uploading || busy}
                      accept=".pdf,.docx,.jpg,.jpeg,.png"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setError('');
                        if (f.size > 25 * 1024 * 1024) {
                          setError('Tệp phải nhỏ hơn hoặc bằng 25 MB.');
                          return;
                        }
                        setUploading(true);
                        try {
                          setFiles((prev) => [...prev]);
                          const uploaded = await uploadFile(f, classId, 'assignment');
                          setFiles((prev) => [...prev, uploaded]);
                          setSaved(false);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                  {files.map((f) => (
                    <FileAttachment
                      key={f.id}
                      file={f}
                      onRemove={() => {
                        setFiles(files.filter((x) => x.id !== f.id));
                        setSaved(false);
                      }}
                    />
                  ))}
                </div>
                <Field label="Liên kết minh chứng (không bắt buộc)">
                  <input
                    type="url"
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="https://…"
                  />
                </Field>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={pledge}
                    onChange={(e) => setPledge(e.target.checked)}
                  />
                  <span>Tôi xác nhận đây là bài làm của mình và các chia sẻ đều trung thực.</span>
                </label>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <div className="row between">
                  <span className="small muted" role="status">
                    {saved ? 'Bản nháp đã lưu.' : 'Bài làm chưa được gửi cho giáo viên.'}
                  </span>
                  <div className="inline-actions">
                    <Button
                      variant="secondary"
                      disabled={busy || uploading}
                      onClick={() => void save(false)}
                    >
                      Lưu nháp
                    </Button>
                    <Button
                      disabled={busy || uploading}
                      onClick={() => {
                        setError('');
                        if (!pledge) {
                          setError('Vui lòng xác nhận bài làm trung thực trước khi nộp.');
                          return;
                        }
                        if (!files.length && !acceptsWordCount(count, a)) {
                          setError(`Bài viết cần ${wordRequirement(a)} hoặc có tệp đính kèm.`);
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
                  {submission?.content || 'Bài làm được gửi dưới dạng tệp đính kèm.'}
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
                {a.allowResubmit &&
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
                          await action('withdrawSubmission', { assignmentId });
                          setContent(submission.content);
                          setLink(submission.link);
                          setFiles(submission.attachments);
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
  const teacher = state.users.find((u) => u.id === c.teacherId);
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
            <span className="avatar">{initials(teacher?.name || 'Tuệ Tâm')}</span>
            <div>
              <strong>{teacher?.name}</strong>
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
                    <th>Ngày tham gia</th>
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
  const list = state.assignments.filter((a) => {
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
  });
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
