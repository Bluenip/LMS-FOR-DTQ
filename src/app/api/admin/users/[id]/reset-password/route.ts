import { adminRequest, resetManagedPassword } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    true,
    (db, actorId, input) => resetManagedPassword(db, actorId, id, input),
    {
      action: 'user.reset_password',
      target: id,
    },
  );
}
