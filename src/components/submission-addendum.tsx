'use client';
import { useEffect, useState } from 'react';
import { PlusCircle, Send } from 'lucide-react';
import { joinSubmissionLinks, parseSubmissionLinks } from '@/lib/submission-links';
import {
  cancelUpload,
  dismissUpload,
  markUploadUsed,
  startUpload,
  uploadActive,
  useUploads,
} from '@/lib/upload-manager';
import type { Assignment, Attachment, Submission } from '@/lib/types';
import { UploadProgress } from './drive';
import { useLms } from './lms-provider';
import { SubmissionLinksEditor } from './submission-links';
import { Button, Field } from './ui';

/**
 * "Bổ sung bài nộp": add files, links or a note to work that is already handed in, without
 * withdrawing it. Nothing already submitted is changed or removed, and it costs no attempt.
 */
export function SubmissionAddendum({
  assignment,
  submission,
  classId,
}: {
  assignment: Assignment;
  submission: Submission;
  classId: string;
}) {
  const { action } = useLms();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const tag = `addendum:${assignment.id}`;
  const uploads = useUploads((i) => i.tag === tag);
  const uploading = uploads.some(uploadActive);

  // Finished uploads join the pending list (also those that completed while this page was closed).
  useEffect(() => {
    const finished = uploads.filter((i) => i.phase === 'done' && i.result && !i.attached);
    if (!finished.length) return;
    finished.forEach((i) => markUploadUsed(i.id));
    setFiles((prev) => [
      ...prev,
      ...finished
        .filter((i) => !prev.some((f) => f.id === i.result!.id))
        .map((i) => ({
          id: i.result!.id,
          name: i.result!.name,
          size: i.result!.size,
          mimeType: i.result!.mimeType,
          url: `/api/drive/files/${i.result!.id}/download`,
        })),
    ]);
  }, [uploads]);

  const room = 10 - submission.attachments.length - files.length;
  const hasLinks = parseSubmissionLinks(link).length > 0;
  const nothing = !note.trim() && !files.length && !hasLinks;

  async function send() {
    setBusy(true);
    setError('');
    try {
      await action('addToSubmission', {
        assignmentId: assignment.id,
        content: note,
        link: joinSubmissionLinks(parseSubmissionLinks(link)),
        attachments: files,
        expectedRevision: submission.revision || '',
      });
      setNote('');
      setLink('');
      setFiles([]);
      setOpen(false);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="stack">
        {done && (
          <p className="notice success" role="status">
            Đã gửi phần bổ sung. Giáo viên sẽ thấy cả bài nộp cũ và phần mới.
          </p>
        )}
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setOpen(true);
            }}
          >
            <PlusCircle size={16} /> Bổ sung bài nộp
          </Button>
        </div>
      </div>
    );
  return (
    <section className="panel stack">
      <h3>Bổ sung bài nộp</h3>
      <p className="small muted">
        Thêm nội dung, tệp hoặc liên kết vào bài đã nộp. Phần đã nộp được giữ nguyên, không tính
        thêm lượt nộp và không đổi thời điểm nộp.
      </p>
      <Field label="Nội dung bổ sung (không bắt buộc)">
        <textarea
          value={note}
          maxLength={20000}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Viết thêm điều bạn muốn gửi kèm bài đã nộp…"
        />
      </Field>
      <Field label="Liên kết bổ sung">
        <SubmissionLinksEditor value={link} disabled={busy} onChange={setLink} />
      </Field>
      <div className="stack">
        <label className="upload-zone">
          <strong>Đính kèm thêm tệp</strong>
          <span>Còn nhận thêm được {Math.max(0, room)} tệp (tối đa 10 tệp mỗi bài).</span>
          <input
            type="file"
            disabled={busy || room <= 0}
            accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.mp4,.webm,.mov"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const isVideo = /\.(mp4|webm|mov)$/i.test(f.name);
              if (f.size > (isVideo ? 5 * 1024 ** 3 : 1024 ** 3)) {
                setError(
                  isVideo
                    ? 'Video phải nhỏ hơn hoặc bằng 5 GB.'
                    : 'Tệp phải nhỏ hơn hoặc bằng 1 GB.',
                );
                return;
              }
              setError('');
              startUpload({
                file: f,
                classId,
                assignmentId: assignment.id,
                kind: isVideo ? 'video' : 'document',
                tag,
              });
            }}
          />
        </label>
        {uploads
          .filter((i) => !i.attached)
          .map((i) => (
            <UploadProgress
              key={i.id}
              name={i.file.name}
              loaded={i.loaded}
              total={i.file.size}
              phase={i.phase}
              message={uploadActive(i) ? 'Đang tải lên nền…' : i.message}
              onCancel={() => void cancelUpload(i.id)}
              onRetry={() => {
                dismissUpload(i.id);
                startUpload({
                  file: i.file,
                  classId,
                  assignmentId: assignment.id,
                  kind: i.kind,
                  tag,
                });
              }}
            />
          ))}
        {files.map((f) => (
          <div className="attachment" key={f.id}>
            <span>{f.name}</span>
            <Button variant="ghost" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
              Gỡ
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button disabled={busy || uploading || nothing} onClick={() => void send()}>
          <Send size={16} /> Gửi bổ sung
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Hủy
        </Button>
        {uploading && <span className="small muted">Chờ tệp tải xong rồi gửi.</span>}
      </div>
    </section>
  );
}
