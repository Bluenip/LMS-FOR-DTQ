import { withDatabase } from '@/lib/server/repository';
import { errorResponse, publicUser, requireUser, sessionUserId } from '@/lib/server/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await sessionUserId();
    return Response.json(
      { user: await withDatabase((db) => publicUser(requireUser(db, id))) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
