import { checkDatabaseConnection } from '@/lib/server/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (process.env.DATABASE_URL && (process.env.SESSION_SECRET?.length ?? 0) < 32)
      throw new Error('Invalid session configuration');
    if (process.env.APP_URL && new URL(process.env.APP_URL).origin !== process.env.APP_URL)
      throw new Error('Invalid app origin');
    await checkDatabaseConnection();
    return Response.json({ status: 'ok' }, { headers });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
