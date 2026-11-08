'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { practiceScore, PRACTICE_GROUPS } from '@/lib/practice';
import { managesClass } from '@/lib/class-teachers';
import { initials } from '@/lib/client';
import type { Lesson } from '@/lib/types';
import { useLms } from './lms-provider';
import { Badge, Button, Dialog, Tabs } from './ui';
import { RankingPanel } from './ranking';

/** Who may tick `studentId`'s sheet of a lesson: their group leader; a teacher/admin if there is none. */
function usePracticeAccess(lesson: Lesson) {
  const { state } = useLms();
  const classroom = state.classes.find((c) => c.id === lesson.classId);
  const me = state.user;
  const approved = state.enrollments.filter(
    (e) => e.classId === lesson.classId && e.status === 'APPROVED',
  );
  const mine = approved.find((e) => e.userId === me.id);
  const manages = !!classroom && (managesClass(classroom, me) || me.isAdmin === true);
  const canTick = (studentId: string) => {
    const target = approved.find((e) => e.userId === studentId);
    if (!target || classroom?.status !== 'ACTIVE') return false;
    const groupHasLeader = approved.some((x) => x.group === target.group && x.leader === true);
    return (
      (mine?.leader === true && target.group === mine.group && target.userId !== me.id) ||
      (manages && (!groupHasLeader || target.leader === true))
    );
  };
  return { state, classroom, approved, mine, manages, canTick };
}

/** The tick sheet of one member for one lesson, with its own save button. */
export function PracticeSheet({ lesson, studentId }: { lesson: Lesson; studentId: string }) {
  const { state, action } = useLms();
  const { canTick } = usePracticeAccess(lesson);
  const stored = state.practiceChecks.find(
    (p) => p.lessonId === lesson.id && p.studentId === studentId,
  );
  const [items, setItems] = useState<string[]>(stored?.items ?? []);
  const [note, setNote] = useState(stored?.note ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // A sheet changed elsewhere is loaded only while nothing is being edited here.
    if (dirty) return;
    setItems(stored?.items ?? []);
    setNote(stored?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, stored?.revision]);
  useEffect(() => {
    setSaved(false);
    setError('');
  }, [studentId]);
  const editable = canTick(studentId);
  const name = (userId: string) => state.users.find((u) => u.id === userId)?.name || 'Học viên';
  const score = practiceScore(items);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await action('savePracticeCheck', { lessonId: lesson.id, studentId, items, note });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack practice-sheet">
      <div className="row">
        <h3>
          Thực hành — {name(studentId)}{' '}
          <span className="muted small">
            {score.done}/{score.total} mục ({score.percent}%)
          </span>
        </h3>
        {!editable && <Badge tone="neutral">Chỉ xem</Badge>}
      </div>
      {PRACTICE_GROUPS.map((group) => (
        <fieldset className="practice-group" key={group.id} disabled={!editable || busy}>
          <legend>{group.title}</legend>
          {group.items.map((item) => (
            <label className="practice-item" key={item.id}>
              <input
                type="checkbox"
                checked={items.includes(item.id)}
                onChange={(e) => {
                  setItems((current) =>
                    e.target.checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  );
                  setDirty(true);
                  setSaved(false);
                }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <label className="field">
        <span>Nhận xét của trưởng nhóm</span>
        <textarea
          value={note}
          maxLength={1000}
          disabled={!editable || busy}
          onChange={(e) => {
            setNote(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          placeholder="Ghi chú thêm về việc thực hành của bạn này…"
        />
      </label>
      {stored && (
        <p className="small muted">
          Cập nhật lần cuối bởi {name(stored.checkedBy)} lúc{' '}
          {new Date(stored.updatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editable && (
        <div className="inline-actions">
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            <Save size={16} /> Lưu kết quả
          </Button>
          {saved && (
            <span className="small success-text">
              <Check size={14} /> Đã lưu
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Detail of one member for this lesson: "Thông tin" (default) and the "Thực hành" tick sheet. */
function MemberLessonDialog({
  lesson,
  studentId,
  onClose,
}: {
  lesson: Lesson;
  studentId: string;
  onClose: () => void;
}) {
  const { state } = useLms();
  const [tab, setTab] = useState('info');
  const user = state.users.find((u) => u.id === studentId);
  const enrollment = state.enrollments.find(
    (e) => e.classId === lesson.classId && e.userId === studentId && e.status === 'APPROVED',
  );
  const stored = state.practiceChecks.find(
    (p) => p.lessonId === lesson.id && p.studentId === studentId,
  );
  const score = practiceScore(stored?.items);
  const studied = state.progress.some(
    (p) => p.lessonId === lesson.id && p.userId === studentId && p.completed,
  );
  const nameOf = (id: string) => state.users.find((u) => u.id === id)?.name || 'Học viên';
  return (
    <Dialog open title={user?.name || 'Thành viên'} onClose={onClose} wide>
      <div className="stack">
        <div className="member-profile">
          <span className="avatar">{initials(user?.name || '?')}</span>
          <div>
            <strong>
              {user?.name} {enrollment?.leader && <Badge tone="success">Trưởng nhóm</Badge>}
            </strong>
            <p className="small muted">
              {user?.email || 'Email chỉ hiển thị cho giáo viên và trưởng nhóm'} · Nhóm{' '}
              {enrollment?.group}
            </p>
          </div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'info', label: 'Thông tin' },
            { id: 'practice', label: 'Thực hành' },
          ]}
        />
        {tab === 'info' ? (
          <div className="stack">
            <h3>
              Bài {lesson.order}: {lesson.title}
            </h3>
            <div className="list-row">
              <span>Đã học bài</span>
              <Badge tone={studied ? 'success' : 'neutral'}>
                {studied ? 'Đã học' : 'Chưa học'}
              </Badge>
            </div>
            <div className="list-row">
              <span>Điểm thực hành</span>
              <strong>
                {score.done}/{score.total} mục ({score.percent}%)
              </strong>
            </div>
            <div className="list-row">
              <span>Chấm lần cuối</span>
              <span>
                {stored
                  ? `${nameOf(stored.checkedBy)} · ${new Date(stored.updatedAt).toLocaleString(
                      'vi-VN',
                      { timeZone: 'Asia/Ho_Chi_Minh' },
                    )}`
                  : 'Chưa chấm'}
              </span>
            </div>
            {stored?.note && (
              <div>
                <h3>Nhận xét</h3>
                <p className="reading-copy" style={{ whiteSpace: 'pre-wrap' }}>
                  {stored.note}
                </p>
              </div>
            )}
            <div>
              <Button onClick={() => setTab('practice')}>Chấm / xem phiếu thực hành</Button>
            </div>
          </div>
        ) : (
          <PracticeSheet lesson={lesson} studentId={studentId} />
        )}
      </div>
    </Dialog>
  );
}

/**
 * "Thực hành" tab of a lesson: the members you may see with whether they studied the lesson and
 * their score. "Chi tiết" opens the member (info first, tick sheet on the second tab). The group
 * leader ticks their members; a teacher or administrator sees everyone, ticks only where the group
 * has no leader, and also gets this lesson's ranking. Members see their own row only.
 */
export function PracticePanel({ lesson }: { lesson: Lesson }) {
  const { state, approved, mine, manages } = usePracticeAccess(lesson);
  const me = state.user;
  const [detail, setDetail] = useState<string | null>(null);
  const members = useMemo(() => {
    const visible = manages
      ? approved
      : mine?.leader
        ? approved.filter((e) => e.group === mine.group)
        : approved.filter((e) => e.userId === me.id);
    const nameOf = (id: string) => state.users.find((u) => u.id === id)?.name || '';
    return [...visible].sort(
      (a, b) => a.group - b.group || nameOf(a.userId).localeCompare(nameOf(b.userId), 'vi'),
    );
  }, [approved, manages, mine, me.id, state.users]);

  const studied = (userId: string) =>
    state.progress.some((p) => p.lessonId === lesson.id && p.userId === userId && p.completed);
  const scoreOf = (userId: string) =>
    practiceScore(
      state.practiceChecks.find((p) => p.lessonId === lesson.id && p.studentId === userId)?.items,
    );
  const name = (userId: string) => state.users.find((u) => u.id === userId)?.name || 'Học viên';
  if (!members.length)
    return <p className="muted small">Chưa có thành viên nào để theo dõi thực hành.</p>;
  return (
    <div className="stack">
      <p className="small muted">
        {manages
          ? 'Giáo viên xem được toàn lớp. Trưởng nhóm chấm thực hành cho từng thành viên trong nhóm.'
          : mine?.leader
            ? 'Bạn là trưởng nhóm: bấm Chi tiết ở từng thành viên trong nhóm để chấm thực hành.'
            : 'Kết quả thực hành của bạn trong bài này do trưởng nhóm chấm.'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Nhóm</th>
              <th>Đã học bài</th>
              <th>Thực hành</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const s = scoreOf(m.userId);
              return (
                <tr key={m.id}>
                  <td data-label="Thành viên">
                    <div className="row">
                      <span className="avatar">{initials(name(m.userId))}</span>
                      <strong>{name(m.userId)}</strong>
                      {m.leader && <Badge tone="success">Trưởng nhóm</Badge>}
                    </div>
                  </td>
                  <td data-label="Nhóm">Nhóm {m.group}</td>
                  <td data-label="Đã học bài">
                    <Badge tone={studied(m.userId) ? 'success' : 'neutral'}>
                      {studied(m.userId) ? 'Đã học' : 'Chưa học'}
                    </Badge>
                  </td>
                  <td data-label="Thực hành">
                    {s.done}/{s.total} ({s.percent}%)
                  </td>
                  <td>
                    <Button variant="secondary" onClick={() => setDetail(m.userId)}>
                      Chi tiết
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && (
        <MemberLessonDialog lesson={lesson} studentId={detail} onClose={() => setDetail(null)} />
      )}
      {manages && (
        <section className="stack practice-sheet">
          <RankingPanel classId={lesson.classId} lessonId={lesson.id} />
        </section>
      )}
    </div>
  );
}
