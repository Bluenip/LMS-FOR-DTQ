import { z } from 'zod';
import { HttpError } from './auth';

export async function readJsonObject(
  request: Request,
  maxBytes = 8000,
): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes)
    throw new HttpError(413, 'Nội dung yêu cầu quá lớn.');
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new HttpError(413, 'Nội dung yêu cầu quá lớn.');
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  try {
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(Buffer.concat(parts, size).toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, 'Dữ liệu JSON không hợp lệ.');
    throw error;
  }
}
