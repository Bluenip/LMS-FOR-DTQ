import nodemailer from 'nodemailer';
import { APP_NAME } from '@/lib/brand';
import { HttpError } from './auth';

export type EmailMode = 'smtp' | 'preview' | 'unavailable';
export interface AccountMail {
  to: string;
  url: string;
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD';
}
export function emailMode(): EmailMode {
  if (process.env.SMTP_HOST && process.env.SMTP_FROM) return 'smtp';
  if (process.env.DATABASE_URL) return 'unavailable';
  if (process.env.APP_URL) {
    try {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.APP_URL).hostname))
        return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  return 'preview';
}
export function mailOrigin(request: Request) {
  const mode = emailMode();
  if (mode === 'unavailable')
    throw new HttpError(
      503,
      'Email chưa được cấu hình. Vui lòng liên hệ quản trị viên để hỗ trợ tài khoản.',
    );
  if (mode === 'smtp' && !process.env.APP_URL)
    throw new HttpError(503, 'Quản trị viên cần cấu hình APP_URL trước khi gửi email tài khoản.');
  const incoming = new URL(request.url);
  const origin = new URL(
    process.env.APP_URL || `${incoming.protocol}//${request.headers.get('host') || incoming.host}`,
  );
  if (mode === 'preview' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    throw new HttpError(
      503,
      'Chế độ xem trước email chỉ dành cho máy cục bộ. Vui lòng cấu hình email để sử dụng trực tuyến.',
    );
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (mode === 'smtp' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
      origin.protocol !== 'https:')
  ) {
    throw new HttpError(503, 'APP_URL cần là địa chỉ HTTPS hợp lệ của ứng dụng.');
  }
  return origin.origin;
}
export async function sendAccountMail(mail: AccountMail): Promise<{ previewUrl?: string }> {
  const mode = emailMode();
  if (mode === 'preview') return { previewUrl: mail.url };
  if (mode === 'unavailable')
    throw new HttpError(
      503,
      'Email chưa được cấu hình. Vui lòng liên hệ quản trị viên để hỗ trợ tài khoản.',
    );
  const host = process.env.SMTP_HOST!;
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const port = Number(process.env.SMTP_PORT || 587);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !!process.env.SMTP_USER !== !!process.env.SMTP_PASSWORD
  )
    throw new HttpError(503, 'Cấu hình SMTP chưa hợp lệ. Vui lòng liên hệ quản trị viên.');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && (!local || process.env.SMTP_REQUIRE_TLS !== 'false'),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD! }
      : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const verify = mail.purpose === 'VERIFY_EMAIL';
  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: mail.to,
      subject: `${verify ? 'Xác minh email' : 'Đặt lại mật khẩu'} — ${APP_NAME}`,
      text: `${verify ? 'Xác minh địa chỉ email để bắt đầu học tập' : 'Bạn đã yêu cầu đặt lại mật khẩu'} tại ${APP_NAME}.\n\nMở liên kết sau và xác nhận trên trang:\n${mail.url}\n\nLiên kết có hiệu lực ${verify ? '60' : '30'} phút và chỉ dùng một lần. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
    });
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error('Recipient not accepted');
    return {};
  } catch {
    throw new HttpError(
      503,
      'Chưa gửi được email. Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
    );
  } finally {
    transport.close();
  }
}
