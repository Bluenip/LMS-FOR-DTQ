import { adminRequest, adminState, createManagedUser } from '@/lib/server/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return adminRequest(request, false, (db, id) => adminState(db, id));
}
export function POST(request: Request) {
  return adminRequest(request, true, (db, id, input) => createManagedUser(db, id, input), {
    action: 'user.create',
    detail: (_result, input) =>
      `role=${String(input.role ?? 'TEACHER')} email=${String(input.email ?? '')}`,
  });
}
