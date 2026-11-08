import { errorResponse, sessionUserId } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/admin';
import { listAudit, withDatabase } from '@/lib/server/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Latest administrative actions (newest first). Administrators only. */
export async function GET() {
  try {
    const id = await sessionUserId();
    const names = await withDatabase((db) => {
      requireAdmin(db, id);
      return Object.fromEntries(db.users.map((u) => [u.id, u.name]));
    });
    const entries = (await listAudit(200)).map((e) => ({
      ...e,
      actorName: names[e.actorId] ?? e.actorId,
      targetName: e.targetId ? (names[e.targetId] ?? '') : '',
    }));
    return Response.json({ entries }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
