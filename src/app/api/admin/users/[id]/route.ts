import { adminRequest, deleteManagedUser, updateManagedUser } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    { write: true, targetId: id },
    (db, actorId, input) => updateManagedUser(db, actorId, id, input),
    {
      action: 'user.update',
      target: id,
      // Field names only: values such as names are not needed to reconstruct what happened.
      detail: (_result, input) =>
        `fields=${Object.keys(input).join(',')}${
          typeof input.disabled === 'boolean' ? ` disabled=${input.disabled}` : ''
        }${typeof input.role === 'string' ? ` role=${input.role}` : ''}`,
    },
  );
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    { write: true, targetId: id, fullSnapshot: true },
    (db, actorId, input) => deleteManagedUser(db, actorId, id, input),
    {
      action: 'user.delete',
      target: id,
      // The account is gone afterwards, so keep who it was in the trail.
      detail: (result) => {
        const d = (result as { deleted: { email: string; role: string; submissions: number } })
          .deleted;
        return `email=${d.email} role=${d.role} submissions=${d.submissions}`;
      },
    },
  );
}
