'use client';
import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api, dateTime } from '@/lib/client';

interface Entry {
  id: string;
  action: string;
  actorName: string;
  targetName: string;
  detail: string;
  createdAt: string;
}
const LABELS: Record<string, string> = {
  'user.create': 'Tạo tài khoản',
  'user.update': 'Cập nhật tài khoản',
  'user.delete': 'Xóa tài khoản',
  'user.reset_password': 'Đặt lại mật khẩu',
  'class.transfer_owner': 'Chuyển chủ lớp',
  'drive.connect': 'Kết nối Google Drive',
  'drive.disconnect': 'Ngắt Google Drive',
  'drive.prune': 'Dọn tệp mồ côi',
  'admin.grant': 'Cấp quyền quản trị',
  'admin.revoke': 'Thu hồi quyền quản trị',
};

/** Read-only trail of administrative actions (latest 200). */
export function AuditLogPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || entries) return;
    api<{ entries: Entry[] }>('/api/admin/audit', { cache: 'no-store' })
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message));
  }, [open, entries]);
  return (
    <details className="panel audit-log" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <ScrollText size={16} /> Nhật ký thao tác quản trị
      </summary>
      {error && <p className="error">{error}</p>}
      {open && !entries && !error && <div className="skeleton row" role="status" />}
      {entries &&
        (entries.length ? (
          <ul className="audit-list">
            {entries.map((e) => (
              <li key={e.id}>
                <strong>{LABELS[e.action] ?? e.action}</strong>
                <span>
                  {e.actorName}
                  {e.targetName ? ` → ${e.targetName}` : ''}
                </span>
                {e.detail && <small className="muted">{e.detail}</small>}
                <small className="muted">{dateTime(e.createdAt)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Chưa có thao tác nào được ghi lại.</p>
        ))}
    </details>
  );
}
