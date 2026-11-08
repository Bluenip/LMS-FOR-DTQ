'use client';
import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '@/lib/client';
import type { Ranking, RankRow } from '@/lib/server/ranking';
import { useLms } from './lms-provider';
import { Badge, Empty } from './ui';

const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '');

function Table({ rows, lessons }: { rows: RankRow[]; lessons: number }) {
  if (!rows.length) return <p className="muted small">Chưa có thành viên.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Hạng</th>
            <th>Thành viên</th>
            <th>Nhóm</th>
            <th>Điểm thực hành</th>
            <th>Đã học</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <td data-label="Hạng">
                <strong>
                  {medal(r.rank)} {r.rank}
                </strong>
              </td>
              <td data-label="Thành viên">
                <strong>{r.name}</strong> {r.leader && <Badge tone="success">Trưởng nhóm</Badge>}
              </td>
              <td data-label="Nhóm">Nhóm {r.group}</td>
              <td data-label="Điểm thực hành">
                {r.done}/{r.possible} ({r.percent}%)
              </td>
              <td data-label="Đã học">
                {r.studied}/{lessons}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Practice ranking of one class: the whole class and each lesson. Only teachers of the class and
 * administrators can load it (the server refuses everyone else).
 */
export function RankingPanel({ classId, lessonId }: { classId: string; lessonId?: string }) {
  const [data, setData] = useState<Ranking | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(lessonId || '');
  const { state } = useLms();
  // Reload when any tick sheet changes (this browser saved it or the 3-second poll brought it in).
  const stamp = state.practiceChecks.map((p) => `${p.id}:${p.revision ?? ''}`).join('|');
  useEffect(() => {
    let live = true;
    setError('');
    api<Ranking>(`/api/ranking?${new URLSearchParams({ classId })}`, { cache: 'no-store' })
      .then((r) => live && setData(r))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [classId, stamp]);
  useEffect(() => {
    if (lessonId) setPick(lessonId);
  }, [lessonId]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <div className="skeleton row" role="status" aria-label="Đang tải xếp hạng" />;
  if (!data.lessons.length)
    return <Empty title="Chưa có bài giảng" description="Lớp chưa có bài giảng đã xuất bản." />;
  const lesson = data.lessons.find((l) => l.id === pick);
  return (
    <div className="stack">
      {!lessonId && (
        <section className="stack">
          <h3>
            <Trophy size={18} /> Xếp hạng tổng — {data.title}
          </h3>
          <p className="small muted">
            Tổng số mục thực hành được tick trên tất cả {data.lessons.length} bài giảng đã xuất bản
            (13 mục mỗi bài).
          </p>
          <Table rows={data.overall} lessons={data.lessons.length} />
        </section>
      )}
      <section className="stack">
        <div className="row">
          <h3>
            <Trophy size={18} /> Xếp hạng theo bài giảng
          </h3>
          {!lessonId && (
            <select
              aria-label="Chọn bài giảng"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Chọn bài giảng…</option>
              {data.lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  Bài {l.order}: {l.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {lesson ? (
          <Table rows={data.byLesson[lesson.id] ?? []} lessons={1} />
        ) : lessonId ? (
          <p className="muted small">Bài giảng chưa xuất bản nên chưa có xếp hạng.</p>
        ) : (
          <p className="muted small">Chọn một bài giảng để xem xếp hạng.</p>
        )}
      </section>
    </div>
  );
}
