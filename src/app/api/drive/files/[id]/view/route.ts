import { errorResponse, HttpError, sessionUserId } from '@/lib/server/auth';
import { serveDocument } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** In-page viewing (video/PDF/image) of a private Drive file with Range support. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await sessionUserId();
    if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    return await serveDocument(userId, (await params).id, request.headers.get('range'), true);
  } catch (error) {
    return errorResponse(error);
  }
}
