import { adminRequest, adminState, createManagedUser } from '@/lib/server/admin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return adminRequest(request, { write: false }, (db, id) => adminState(db, id));
}
export function POST(request: Request) {
  return adminRequest(
    request,
    { write: true, create: true, credential: true },
    (db, id, input, credential) => createManagedUser(db, id, input, credential),
    {
      action: 'user.create',
      detail: (_result, input) =>
        `role=${String(input.role ?? 'TEACHER')} email=${String(input.email ?? '')}`,
    },
  );
}
