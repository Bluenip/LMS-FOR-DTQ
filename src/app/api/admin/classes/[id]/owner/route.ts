import { adminRequest, transferClassOwner } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    { write: true, classId: id, exclusive: true },
    (db, actorId, input) => transferClassOwner(db, actorId, id, input),
  );
}
