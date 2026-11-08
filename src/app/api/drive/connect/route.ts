import { errorResponse } from '@/lib/server/auth';
import { beginConnect } from '@/lib/server/drive-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    return await beginConnect(request);
  } catch (error) {
    return errorResponse(error);
  }
}
