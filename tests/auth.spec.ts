import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('login contains only credentials and no public account or demo controls', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Chào mừng trở lại', exact: true })).toBeVisible();
  await expect(page.locator('form input')).toHaveCount(2);
  const email = page.getByRole('textbox', { name: 'Địa chỉ email', exact: true });
  const password = page.getByLabel('Mật khẩu', { exact: true });
  await expect(email).toBeVisible();
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Đăng ký|Quên mật khẩu/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Học viên', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Giáo viên', exact: true })).toHaveCount(0);
  await expect(page.getByText('Demo@2026', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('public registration and email recovery pages redirect and their APIs reject changes', async ({
  page,
  request,
}) => {
  for (const path of ['register', 'verify-email', 'forgot-password', 'reset-password']) {
    await page.goto(`/${path}?token=${'a'.repeat(64)}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Chào mừng trở lại', exact: true }),
    ).toBeVisible();
  }
  for (const endpoint of [
    'register',
    'verify-email',
    'resend-verification',
    'forgot-password',
    'reset-password',
  ]) {
    const response = await request.post(`/api/auth/${endpoint}`, {
      data: {
        name: 'Không được tạo',
        email: `e2e-denied-${randomUUID()}@example.invalid`,
        password: 'DeniedTestPassword26',
        token: 'a'.repeat(64),
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toContain('quản trị viên');
  }
  expect((await request.get('/api/profile')).status()).toBe(401);
});

test('an issued account edits its profile and changes its own password without being logged out', async ({
  page,
  playwright,
  baseURL,
}) => {
  const adminEmail = process.env.ADMIN_E2E_EMAIL;
  const adminPassword = process.env.ADMIN_E2E_PASSWORD;
  test.skip(
    !adminEmail || !adminPassword,
    'Provide a dedicated temporary admin for account management tests.',
  );
  const admin = await playwright.request.newContext({ baseURL });
  const otherSession = await playwright.request.newContext({ baseURL });
  try {
    expect(
      (
        await admin.post('/api/auth/login', {
          data: { email: adminEmail, password: adminPassword },
        })
      ).ok(),
    ).toBeTruthy();
    const email = `e2e-admin-created-profile-${Date.now()}-${randomUUID().slice(0, 8)}@example.invalid`;
    const created = await admin.post('/api/admin/users', {
      data: { role: 'STUDENT', name: 'Học viên thông tin cá nhân', email },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { temporaryPassword } = await created.json();
    expect(
      (
        await otherSession.post('/api/auth/login', {
          data: { email, password: temporaryPassword },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Địa chỉ email', exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(temporaryPassword);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole('heading', { name: 'Thông tin cá nhân', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Email đăng nhập', exact: false }),
    ).toHaveAttribute('readonly', '');
    await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('SaiMat26');
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Custom28');
    await page.getByLabel('Nhập lại mật khẩu mới', { exact: true }).fill('Custom28');
    await page.getByRole('button', { name: 'Lưu mật khẩu mới', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Mật khẩu hiện tại chưa đúng',
    );
    await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(temporaryPassword);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/profile') && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Lưu mật khẩu mới', exact: true }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.getByRole('status').filter({ hasText: 'Đã đổi mật khẩu' })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Họ và tên', exact: true })
      .fill('Tên học viên đã cập nhật');
    await page.getByRole('button', { name: 'Lưu thông tin', exact: true }).click();
    await expect(page.locator('.account-name')).toContainText('Tên học viên đã cập nhật');
    await expect(page).toHaveURL(/\/profile$/);
    expect((await page.request.get('/api/state')).status()).toBe(200);
    expect((await otherSession.get('/api/state')).status()).toBe(401);
    expect(
      (
        await otherSession.post('/api/auth/login', {
          data: { email, password: temporaryPassword },
        })
      ).status(),
    ).toBe(401);
    const relogin = await otherSession.post('/api/auth/login', {
      data: { email, password: 'Custom28' },
    });
    expect(relogin.ok()).toBeTruthy();
    expect((await relogin.json()).user.isAdmin).not.toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await admin.dispose();
    await otherSession.dispose();
  }
});
