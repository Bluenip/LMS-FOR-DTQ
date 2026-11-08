import { errorResponse, HttpError, sessionUserId } from '@/lib/server/auth';
import { servePdf } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** PDF rendering of a private PPTX/DOCX, after the same access checks as /view. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await sessionUserId();
    if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    return await servePdf(userId, (await params).id);
  } catch (error) {
    return errorResponse(error);
  }
}
