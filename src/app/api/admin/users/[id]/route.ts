import { adminRequest, updateManagedUser } from '@/lib/server/admin';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRequest(
    request,
    true,
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
