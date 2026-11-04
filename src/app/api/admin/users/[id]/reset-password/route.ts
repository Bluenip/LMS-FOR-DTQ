import { adminRequest, resetManagedPassword } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    { write: true, targetId: id, credential: true },
    (db, actorId, input, credential) => resetManagedPassword(db, actorId, id, input, credential),
  );
}
