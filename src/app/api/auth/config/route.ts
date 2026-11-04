import { demoMode } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return Response.json(
    // Email delivery is not part of the managed-account flow.
    { demo: demoMode(request), emailMode: 'unavailable' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
