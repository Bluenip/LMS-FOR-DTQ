import { emailMode } from '@/lib/server/mail';
import { demoMode } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return Response.json(
    { demo: demoMode(request), emailMode: emailMode() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
