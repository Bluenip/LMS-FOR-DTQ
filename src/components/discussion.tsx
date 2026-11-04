'use client';

import { useEffect, useState } from 'react';
import { Edit3, Send, Trash2 } from 'lucide-react';
import type { Discussion } from '@/lib/types';
import { dateTime, initials } from '@/lib/client';
import { useLms } from './lms-provider';
import { managesClass } from '@/lib/class-teachers';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';
import { readSessionDraft, removeSessionDraft, writeSessionDraft } from '@/lib/session-draft';
import { Button, Dialog, Field } from './ui';

type DiscussionEdit = { original: Discussion; content: string };

export function DiscussionPanel({ lessonId, classId }: { lessonId: string; classId: string }) {
  const { state, action } = useLms();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<DiscussionEdit | null>(null);
  const [deleting, setDeleting] = useState<Discussion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const discussions = state.discussions.filter((d) => d.lessonId === lessonId);
  const classroom = state.classes.find((c) => c.id === classId);
  const [dirty, setDirty] = useState(false);
  const draftKey = `lms-draft:discussion:${state.user.id}:${lessonId}`;
  const editKey = `${draftKey}:edit`;
  const editDirty = !!editing && editing.content !== editing.original.content;
  useUnsavedWarning(dirty || editDirty);
  useEffect(() => {
    const saved = readSessionDraft<DiscussionEdit>(editKey);
    if (saved?.original?.lessonId === lessonId && saved.original.userId === state.user.id)
      setEditing(saved);
  }, [editKey, lessonId, state.user.id]);
  function discardEdit() {
    if (editDirty && !window.confirm('Bạn có chỉnh sửa chưa lưu. Bỏ bản chỉnh sửa này?'))
      return false;
    setEditing(null);
    removeSessionDraft(editKey);
    setError('');
    return true;
  }
  useEffect(() => {
    const saved = readSessionDraft<string>(draftKey);
    if (saved !== null) {
      setDraft(saved);
      setDirty(true);
    }
  }, [draftKey]);
  useEffect(() => {
    if (dirty) writeSessionDraft(draftKey, draft);
  }, [dirty, draft, draftKey]);
  const moderator = !!classroom && managesClass(classroom, state.user);
  const currentEdit = discussions.find((d) => d.id === editing?.original.id);
  const currentDelete = discussions.find((d) => d.id === deleting?.id);
  const editChanged = !!editing && currentEdit?.content !== editing.original.content;
  const deleteChanged = !!deleting && currentDelete?.content !== deleting.content;

  async function mutate(name: string, payload: Record<string, unknown>) {
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
  const editor = editing && (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutate('updateComment', {
            discussionId: editing.original.id,
            content: editing.content,
            expectedContent: editing.original.content,
          })
        ) {
          setEditing(null);
          removeSessionDraft(editKey);
        }
      }}
    >
      {editChanged && (
        <p className="notice" role="status">
          {currentEdit
            ? 'Thảo luận đã thay đổi trong một phiên khác. Hủy để xem nội dung mới.'
            : 'Thảo luận đang sửa đã bị xóa. Bạn có thể sao chép bản chỉnh sửa trước khi đóng.'}
        </p>
      )}
      <Field label="Sửa nội dung thảo luận">
        <textarea
          aria-label="Sửa nội dung thảo luận"
          required
          maxLength={5000}
          value={editing.content}
          disabled={busy}
          onChange={(e) => {
            const next = { ...editing, content: e.target.value };
            setEditing(next);
            writeSessionDraft(editKey, next);
          }}
        />
      </Field>
      <div className="inline-actions">
        <Button
          type="submit"
          disabled={
            busy ||
            editChanged ||
            !editing.content.trim() ||
            editing.content.trim() === editing.original.content
          }
        >
          Lưu chỉnh sửa
        </Button>
        <Button variant="ghost" disabled={busy} onClick={discardEdit}>
          Hủy
        </Button>
      </div>
    </form>
  );

  return (
    <div className="stack">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const submitted = draft;
          if (await mutate('comment', { lessonId, content: submitted })) {
            setDraft((current) => (current === submitted ? '' : current));
            setDirty(false);
            removeSessionDraft(draftKey);
          }
        }}
      >
        <Field label="Chia sẻ cùng lớp">
          <textarea
            aria-label="Chia sẻ cùng lớp"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            required
            maxLength={5000}
            disabled={busy || classroom?.status === 'ARCHIVED'}
            placeholder="Đặt câu hỏi hoặc chia sẻ trải nghiệm thực hành…"
          />
        </Field>
        <div>
          <Button
            type="submit"
            disabled={busy || !draft.trim() || classroom?.status === 'ARCHIVED'}
          >
            <Send size={15} />
            Gửi thảo luận
          </Button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div role="list" aria-label="Thảo luận của lớp">
        {discussions.map((d) => {
          const author = state.users.find((u) => u.id === d.userId);
          const own = d.userId === state.user.id;
          return (
            <article
              role="listitem"
              className="discussion-item"
              key={d.id}
              aria-label={`Thảo luận của ${author?.name || 'Học viên'}`}
            >
              <span className="avatar">{initials(author?.name || 'HV')}</span>
              <div className="discussion-body">
                <div className="discussion-header">
                  <div>
                    <strong>{author?.name || 'Học viên'}</strong>
                    <time dateTime={d.createdAt}>{dateTime(d.createdAt)}</time>
                    {d.updatedAt && (
                      <small className="muted" title={`Chỉnh sửa lúc ${dateTime(d.updatedAt)}`}>
                        Đã chỉnh sửa
                      </small>
                    )}
                  </div>
                  {editing?.original.id !== d.id && (
                    <div className="inline-actions discussion-actions">
                      {own && (
                        <Button
                          variant="ghost"
                          disabled={busy || classroom?.status === 'ARCHIVED'}
                          onClick={() => {
                            if (editing && !discardEdit()) return;
                            setEditing({ original: { ...d }, content: d.content });
                            setError('');
                          }}
                        >
                          <Edit3 size={13} />
                          Sửa
                        </Button>
                      )}
                      {(own || moderator) && (
                        <Button
                          variant="ghost"
                          disabled={busy || classroom?.status === 'ARCHIVED'}
                          onClick={() => {
                            setDeleting({ ...d });
                            setError('');
                          }}
                        >
                          <Trash2 size={13} />
                          Xóa
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {editing?.original.id === d.id ? editor : <p>{d.content}</p>}
              </div>
            </article>
          );
        })}
      </div>
      {!discussions.length && !editing && (
        <p className="muted small">Chưa có thảo luận. Hãy chia sẻ cùng lớp.</p>
      )}
      {editing && !currentEdit && editor}
      <Dialog
        open={!!deleting}
        title="Xóa thảo luận?"
        onClose={() => {
          if (!busy) {
            setDeleting(null);
            setError('');
          }
        }}
      >
        {deleting && (
          <div className="stack">
            <p>Bạn muốn xóa thảo luận này? Thao tác này không thể hoàn tác.</p>
            <p className="reading-copy">{deleting.content}</p>
            {deleteChanged && (
              <p className="notice" role="status">
                {currentDelete
                  ? 'Nội dung đã thay đổi. Đóng xác nhận và kiểm tra lại trước khi xóa.'
                  : 'Thảo luận đã bị xóa.'}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-footer">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  setError('');
                }}
              >
                Giữ lại
              </Button>
              <Button
                variant="danger"
                disabled={busy || deleteChanged}
                onClick={async () => {
                  if (
                    await mutate('deleteComment', {
                      discussionId: deleting.id,
                      expectedContent: deleting.content,
                    })
                  )
                    setDeleting(null);
                }}
              >
                Xác nhận xóa
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
