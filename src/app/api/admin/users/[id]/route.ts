import { adminRequest, updateManagedUser } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(request, true, (db, actorId, input) =>
    updateManagedUser(db, actorId, id, input),
  );
}
