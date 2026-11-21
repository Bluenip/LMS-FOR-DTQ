import { errorResponse, HttpError, sessionUserId } from '@/lib/server/auth';
import { resolveCanvaShortLink } from '@/lib/server/canva';
import { RateLimit } from '@/lib/server/rate-limit';
import { isCanvaShortLink } from '@/lib/submission-links';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limit = new RateLimit(120, 15 * 60 * 1000, 10000, 'Bạn mở quá nhiều liên kết. Thử lại sau.');

/** GET /api/canva/resolve?url=https://canva.link/<code> → { embed } (null when not a design). */
export async function GET(request: Request) {
  try {
    const userId = await sessionUserId();
    if (!userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const link = new URL(request.url).searchParams.get('url') || '';
    if (!isCanvaShortLink(link)) throw new HttpError(400, 'Không phải liên kết rút gọn của Canva.');
    limit.consume(userId);
    const embed = await resolveCanvaShortLink(link).catch(() => {
      throw new HttpError(502, 'Không mở được liên kết Canva. Thử lại sau.');
    });
    return Response.json({ embed }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) {
    return errorResponse(error);
  }
}
