import { driveRoute, slideUrl } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Embeddable slide-show URL of a PPTX the caller may read (same access rules as /view). */
export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  driveRoute(request, false, async ({ userId }) => slideUrl(userId, (await params).id));
