import { findSessionUser } from '@/lib/server/repository';
import {
  accountEnabled,
  errorResponse,
  HttpError,
  publicUser,
  sessionUserId,
} from '@/lib/server/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await sessionUserId();
    const user = id ? await findSessionUser(id) : undefined;
    if (!user || !accountEnabled(user)) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    return Response.json({ user: publicUser(user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
