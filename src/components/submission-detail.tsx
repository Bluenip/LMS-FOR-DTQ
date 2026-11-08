'use client';
import { useState } from 'react';
import { Eye, FileText } from 'lucide-react';
import { submissionStatus } from '@/lib/assignment-grading';
import type { Submission } from '@/lib/types';
import { AttachmentViewer } from './drive';
import { Badge, Button, Dialog } from './ui';

const date = (s?: string) =>
  s
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(s))
    : '—';

/** Read-only view of one submission: text, link, files (with in-page viewer) and the grade. */
export function SubmissionDetail({
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
            {submission.status === 'GRADED' && submission.score != null && (
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
