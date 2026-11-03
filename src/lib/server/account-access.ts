export function managedAccountsOnly() {
  return Response.json(
    {
      error:
        'Tài khoản do quản trị viên cấp. Vui lòng liên hệ quản trị viên để tạo, kích hoạt hoặc đặt lại mật khẩu.',
    },
    { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
