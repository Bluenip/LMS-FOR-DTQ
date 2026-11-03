import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './auth';
import { withDatabase } from './repository';

/**
 * Thin client for Google OAuth 2.0 (web server flow) and Drive API v3.
 * Every request goes to the documented REST endpoints; no token or session URI is ever logged.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 * https://developers.google.com/workspace/drive/api/guides/manage-uploads
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const CONNECTION_ID = 'shared';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,size,webViewLink,trashed,appProperties,parents,createdTime';
/** Resumable chunks must be a multiple of 256 KiB (Drive requirement). */
export const CHUNK_SIZE = 32 * 256 * 1024;

export function driveConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && encryptionSecret());
}
function encryptionSecret() {
  const value = process.env.DRIVE_ENCRYPTION_KEY || process.env.SESSION_SECRET || '';
  return value.length >= 32 ? value : '';
}
function requireConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !encryptionSecret())
    throw new HttpError(
      503,
      'Google Drive chưa được cấu hình. Quản trị viên cần đặt GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET và DRIVE_ENCRYPTION_KEY.',
    );
  return { clientId, clientSecret };
}
export function appOrigin(request: Request) {
  const configured = process.env.APP_URL;
  return (configured ? new URL(configured) : new URL(request.url)).origin;
}
export function redirectUri(request: Request) {
  return process.env.GOOGLE_REDIRECT_URI || `${appOrigin(request)}/api/drive/callback`;
}

// ---------------------------------------------------------------------------
// Secret storage (AES-256-GCM). The refresh token and upload session URIs are
// encrypted at rest; the key never lives in the database.
// ---------------------------------------------------------------------------
function key() {
  return createHash('sha256').update(`dtq-drive-v1:${encryptionSecret()}`).digest();
}
export function encryptSecret(plain: string) {
  if (!encryptionSecret()) throw new HttpError(503, 'Chưa cấu hình DRIVE_ENCRYPTION_KEY.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', ...[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'))].join(
    '.',
  );
}
export function decryptSecret(envelope: string) {
  const [version, iv, tag, body] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !body)
    throw new HttpError(500, 'Dữ liệu mã hóa không hợp lệ.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new HttpError(
      500,
      'Không giải mã được kết nối Google Drive. Có thể khóa DRIVE_ENCRYPTION_KEY đã đổi; hãy kết nối lại.',
    );
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
export function newOAuthState() {
  return randomBytes(24).toString('base64url');
}
export function statesMatch(expected: string | undefined, actual: string | null) {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authorizationUrl(request: Request, state: string) {
  const { clientId } = requireConfig();
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    // Guarantees a refresh token even if this Google account approved the app before.
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  }).toString();
  return url.toString();
}
const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
async function tokenRequest(params: Record<string, string>) {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { res, data };
}
export async function exchangeCode(request: Request, code: string) {
  const { res, data } = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(request),
  });
  if (!res.ok) {
    console.error('Google token exchange failed', res.status, data.error);
    throw new HttpError(400, 'Google từ chối mã xác thực. Hãy thử kết nối lại.');
  }
  return tokenResponse.parse(data);
}

let cached: { token: string; expires: number } | undefined;
export function clearAccessTokenCache() {
  cached = undefined;
}
export function rememberAccessToken(token: string, expiresIn: number) {
  cached = { token, expires: Date.now() + expiresIn * 1000 - 60000 };
}
async function markRevoked() {
  clearAccessTokenCache();
  await withDatabase(
    (db) => {
      const connection = db.driveConnections.find((c) => c.id === CONNECTION_ID);
      if (connection) {
        connection.status = 'REVOKED';
        connection.updatedAt = new Date().toISOString();
      }
    },
    true,
    ['driveConnections'],
  );
}
export async function driveAccessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  const connection = await withDatabase(
    (db) => db.driveConnections.find((c) => c.id === CONNECTION_ID),
    false,
    ['driveConnections'],
  );
  if (!connection)
    throw new HttpError(409, 'Google Drive chưa được kết nối. Quản trị viên cần kết nối trước.');
  if (connection.status === 'DISCONNECTED')
    throw new HttpError(409, 'Google Drive đã được ngắt kết nối. Quản trị viên cần kết nối lại.');
  if (connection.status !== 'ACTIVE')
    throw new HttpError(409, 'Kết nối Google Drive đã bị thu hồi. Quản trị viên cần kết nối lại.');
  const { res, data } = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
  });
  if (!res.ok) {
    if (data.error === 'invalid_grant') {
      await markRevoked();
      throw new HttpError(
        409,
        'Kết nối Google Drive đã bị thu hồi hoặc hết hiệu lực. Quản trị viên cần kết nối lại.',
      );
    }
    console.error('Google token refresh failed', res.status, data.error);
    throw new HttpError(
      res.status >= 500 ? 503 : 502,
      'Không làm mới được phiên Google Drive. Vui lòng thử lại.',
    );
  }
  const parsed = tokenResponse.parse(data);
  rememberAccessToken(parsed.access_token, parsed.expires_in);
  return parsed.access_token;
}
export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Authenticated REST calls and error classification
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Maps a Google error response to an HttpError. 429/503 are safe to retry; others need action. */
export async function googleError(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  };
  const reason = body.error?.errors?.[0]?.reason || '';
  console.error('Google Drive API error', res.status, reason);
  if (res.status === 403 && /rateLimit|quota/i.test(reason) && !/storage/i.test(reason))
    return new HttpError(429, 'Google Drive đang giới hạn tần suất. Vui lòng thử lại sau ít phút.');
  if (reason === 'storageQuotaExceeded')
    return new HttpError(
      507,
      'Tài khoản Google Drive đã hết dung lượng. Hãy giải phóng dung lượng rồi thử lại.',
    );
  switch (res.status) {
    case 400:
      return new HttpError(400, 'Google Drive từ chối yêu cầu không hợp lệ.');
    case 401:
      return new HttpError(
        502,
        'Phiên Google Drive không hợp lệ. Quản trị viên có thể cần kết nối lại.',
      );
    case 403:
      return new HttpError(
        502,
        'Google Drive từ chối quyền truy cập. Quản trị viên cần kiểm tra lại kết nối.',
      );
    case 404:
      return new HttpError(404, 'Không tìm thấy tệp trên Google Drive.');
    case 429:
      return new HttpError(
        429,
        'Google Drive đang giới hạn tần suất. Vui lòng thử lại sau ít phút.',
      );
    default:
      return new HttpError(
        res.status >= 500 ? 503 : 502,
        'Google Drive tạm thời không phản hồi. Vui lòng thử lại.',
      );
  }
}
export async function driveCall(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const idempotent = ['GET', 'DELETE', 'PATCH', 'PUT'].includes(method);
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await driveAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      signal: init.signal ?? AbortSignal.timeout(30000),
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      clearAccessTokenCache();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && idempotent && attempt < 3) {
      await sleep(400 * 2 ** attempt);
      continue;
    }
    return res;
  }
}
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await googleError(res);
  return (await res.json()) as T;
}

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
  parents?: string[];
  createdTime?: string;
}
export async function driveAccountEmail(accessToken: string) {
  const res = await fetch(`${API}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await json<{ user?: { emailAddress?: string } }>(res);
  return data.user?.emailAddress || 'không rõ';
}
export async function createFolder(name: string) {
  const res = await driveCall(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await json<{ id: string }>(res)).id;
}
export async function getDriveFile(fileId: string) {
  return json<DriveRemoteFile>(
    await driveCall(`${API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`),
  );
}
export async function renameDriveFile(fileId: string, name: string) {
  return json<DriveRemoteFile>(
    await driveCall(`${API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name }),
    }),
  );
}
/** A file that is already gone counts as deleted so retries stay idempotent. */
export async function deleteDriveFile(fileId: string) {
  const res = await driveCall(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  if (res.status === 404) return;
  if (!res.ok) throw await googleError(res);
}
const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export async function listDriveFiles(folderId: string | undefined, search: string) {
  const clauses = ['trashed = false'];
  if (folderId) clauses.push(`'${escapeQuery(folderId)}' in parents`);
  if (search) clauses.push(`name contains '${escapeQuery(search)}'`);
  const params = new URLSearchParams({
    q: clauses.join(' and '),
    pageSize: '100',
    orderBy: 'createdTime desc',
    fields: `files(${FILE_FIELDS})`,
  });
  return (await json<{ files: DriveRemoteFile[] }>(await driveCall(`${API}/files?${params}`)))
    .files;
}

// --- Permissions -----------------------------------------------------------
interface Permission {
  id: string;
  type: string;
  role: string;
}
export async function listPermissions(fileId: string) {
  const res = await driveCall(
    `${API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role)`,
  );
  return (await json<{ permissions: Permission[] }>(res)).permissions;
}
/** "Anyone with the link can view". Idempotent; allowFileDiscovery stays false (not searchable). */
export async function ensurePublicReader(fileId: string) {
  if ((await listPermissions(fileId)).some((p) => p.type === 'anyone' && p.role === 'reader'))
    return;
  await json(
    await driveCall(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
    }),
  );
}
export async function revokePublicReader(fileId: string) {
  for (const permission of (await listPermissions(fileId)).filter((p) => p.type === 'anyone')) {
    const res = await driveCall(
      `${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permission.id)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) throw await googleError(res);
  }
}

// --- Content sniffing --------------------------------------------------------
export function matchesSignature(mime: string, data: Buffer) {
  const ascii = (from: number, to: number) => data.subarray(from, to).toString('latin1');
  switch (mime) {
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    case 'image/jpeg':
      return data[0] === 255 && data[1] === 216 && data[2] === 255;
    case 'image/png':
      return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/gif':
      return ascii(0, 4) === 'GIF8';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4;
    case 'video/mp4':
    case 'video/quicktime':
      return ['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(ascii(4, 8));
    case 'video/webm':
      return data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
    default:
      return false;
  }
}
/** Streams a (private) file through the server; callers must have authorised the reader. */
export async function driveDownload(fileId: string, range?: string) {
  const res = await driveCall(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    // Forwarding Range lets <video> seek and PDF viewers fetch pages without the whole file.
    ...(range && /^bytes=\d*-\d*$/.test(range) ? { headers: { Range: range } } : {}),
    signal: AbortSignal.timeout(30 * 60 * 1000), // large learner videos are streamed
  });
  if (!res.ok || !res.body) throw await googleError(res);
  return res;
}
/**
 * DOCX, PPTX and XLSX are all ZIP files starting with "PK", so the first bytes cannot tell them
 * apart. Their ZIP central directory (at the end of the file) lists the part names, which can.
 */
const OFFICE_MARKERS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'ppt/presentation.xml',
};
export const needsOfficeCheck = (mime: string) => mime in OFFICE_MARKERS;
export function matchesOfficeTail(mime: string, tail: Buffer) {
  const marker = OFFICE_MARKERS[mime];
  return !marker || tail.includes(Buffer.from(marker));
}
export async function readFileTail(fileId: string, size: number, bytes = 262144) {
  const start = Math.max(0, size - bytes);
  const res = await driveCall(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Range: `bytes=${start}-${size - 1}` },
  });
  if (!res.ok) throw await googleError(res);
  return Buffer.from(await res.arrayBuffer());
}
/** Reads only the first 4 KiB so a 2 GB video is never pulled through the server. */
export async function readFileHead(fileId: string, bytes = 4096) {
  const res = await driveCall(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Range: `bytes=0-${bytes - 1}` },
  });
  if (!res.ok || !res.body) throw await googleError(res);
  const reader = res.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  while (size < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(parts).subarray(0, bytes);
}

// --- Resumable upload sessions ---------------------------------------------
export async function startResumable(input: {
  name: string;
  mimeType: string;
  size: number;
  folderId?: string;
  jobId: string;
  origin: string;
}) {
  const params = new URLSearchParams({ uploadType: 'resumable', fields: FILE_FIELDS });
  const res = await driveCall(`${UPLOAD_API}/files?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.mimeType,
      'X-Upload-Content-Length': String(input.size),
      // Lets the browser read Drive's responses (CORS) when it PUTs chunks to the session URI.
      Origin: input.origin,
    },
    body: JSON.stringify({
      name: input.name,
      mimeType: input.mimeType,
      ...(input.folderId ? { parents: [input.folderId] } : {}),
      // Binds the resulting Drive file to this job so a client cannot claim someone else's file id.
      appProperties: { lmsJobId: input.jobId },
    }),
  });
  if (!res.ok) throw await googleError(res);
  const location = res.headers.get('location');
  if (!location || !location.startsWith('https://'))
    throw new HttpError(502, 'Google Drive không tạo được phiên tải lên.');
  return location;
}
export type ResumableState =
  | { state: 'done'; file: DriveRemoteFile }
  | { state: 'partial'; offset: number }
  | { state: 'expired' };
/** Asks Drive how many bytes it has (empty PUT with a wildcard Content-Range; 308 + Range header). */
export async function queryResumable(sessionUri: string, size: number): Promise<ResumableState> {
  const res = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${size}` },
    body: '',
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 200 || res.status === 201)
    return { state: 'done', file: (await res.json()) as DriveRemoteFile };
  if (res.status === 308) {
    const match = /bytes=0-(\d+)/.exec(res.headers.get('range') || '');
    return { state: 'partial', offset: match ? Number(match[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) return { state: 'expired' };
  throw await googleError(res);
}
export async function cancelResumable(sessionUri: string) {
  // Drive answers 499 on success; any outcome is fine because the session also expires by itself.
  await fetch(sessionUri, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(
    () => undefined,
  );
}
export const previewUrl = (fileId: string) =>
  `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
