import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { AdminState, AdminUser, Classroom, Role } from '../src/lib/types';

const customPassword = 'Custom26';

async function loginApi(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/auth/login', { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function adminState(request: APIRequestContext): Promise<AdminState> {
  const response = await request.get('/api/admin/users');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function mutationResponse(page: Page, path: string, method: string) {
  return page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === method,
  );
}

async function expectAdminForbidden(request: APIRequestContext, status: number) {
  const target = '/api/admin/users/teacher-1';
  const responses = [
    await request.get('/api/admin/users'),
    await request.post('/api/admin/users', {
      data: {
        name: 'Không được tạo',
        email: `e2e-admin-denied-${randomUUID()}@example.invalid`,
        role: 'STUDENT',
      },
    }),
    await request.patch(target, { data: { name: 'Không được sửa', isAdmin: true } }),
    await request.post(`${target}/reset-password`, { data: {} }),
  ];
  for (const response of responses) expect(response.status()).toBe(status);
}

function accountRow(page: Page, email: string) {
  return page.getByRole('row').filter({ hasText: email });
}

async function findAccount(page: Page, role: Role, email: string) {
  const tab = page.getByRole('tab', { name: role === 'TEACHER' ? /^Giáo viên/ : /^Học viên/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: 'Tìm tên hoặc email…', exact: true }).fill(email);
  await expect(accountRow(page, email)).toBeVisible();
}

async function createAccount(page: Page, role: Role, name: string, email: string) {
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Tạo tài khoản', exact: true }),
  });
  await dialog.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption(role);
  await dialog.getByRole('textbox', { name: 'Họ và tên', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'Địa chỉ email', exact: true }).fill(email);
  await expect(dialog).toContainText('mật khẩu tạm riêng');
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  const responsePromise = mutationResponse(page, '/api/admin/users', 'POST');
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { user, temporaryPassword } = (await response.json()) as {
    user: AdminUser;
    temporaryPassword: string;
  };
  expect(user.role).toBe(role);
  expect(user.emailVerified).toBe(true);
  expect(user.isAdmin).toBe(false);
  await expect(dialog).not.toBeVisible();
  const passwordDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Mật khẩu tạm', exact: true }) });
  await expect(passwordDialog).toContainText(temporaryPassword);
  await passwordDialog.getByRole('button', { name: 'Đã lưu lại' }).click();
  await findAccount(page, role, email);
  await expect(accountRow(page, email)).toContainText(name);
  return { ...user, temporaryPassword };
}

async function renameAccount(page: Page, user: AdminUser, name: string) {
  await accountRow(page, user.email)
    .getByRole('button', { name: 'Sửa tài khoản', exact: true })
    .click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Sửa tài khoản', exact: true }),
  });
  await dialog.getByRole('textbox', { name: 'Họ và tên', exact: true }).fill(name);
  const response = mutationResponse(page, `/api/admin/users/${user.id}`, 'PATCH');
  await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(accountRow(page, user.email)).toContainText(name);
}

async function resetAccountPassword(page: Page, user: AdminUser) {
  await accountRow(page, user.email)
    .getByRole('button', { name: 'Đặt lại mật khẩu', exact: true })
    .click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Đặt lại mật khẩu', exact: true }),
  });
  await expect(dialog).toContainText('mật khẩu tạm mới');
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog
    .getByRole('checkbox', {
      name: 'Tôi hiểu người dùng sẽ phải đăng nhập lại bằng mật khẩu tạm mới.',
      exact: true,
    })
    .check();
  const response = mutationResponse(page, `/api/admin/users/${user.id}/reset-password`, 'POST');
  await dialog.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  const reply = await response;
  expect(reply.ok()).toBeTruthy();
  const { temporaryPassword } = await reply.json();
  await expect(dialog).not.toBeVisible();
  const passwordDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Mật khẩu tạm', exact: true }) });
  await expect(passwordDialog).toContainText(temporaryPassword);
  await passwordDialog.getByRole('button', { name: 'Đã lưu lại' }).click();
  return temporaryPassword as string;
}

async function changeAccountStatus(page: Page, user: AdminUser, disabled: boolean) {
  const action = disabled ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
  await accountRow(page, user.email).getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: action, exact: true }),
  });
  const response = mutationResponse(page, `/api/admin/users/${user.id}`, 'PATCH');
  await dialog
    .getByRole('button', { name: disabled ? 'Xác nhận khóa' : 'Xác nhận mở khóa', exact: true })
    .click();
  expect((await response).ok()).toBeTruthy();
  await expect(accountRow(page, user.email)).toContainText(disabled ? 'Đã khóa' : 'Đang hoạt động');
}

async function expectOldPasswordRejected(request: APIRequestContext, email: string) {
  expect((await request.get('/api/state')).status()).toBe(401);
  const response = await request.post('/api/auth/login', {
    data: { email, password: customPassword },
  });
  expect(response.status()).toBe(401);
}

async function expectAccountLocked(request: APIRequestContext, email: string, password: string) {
  expect((await request.get('/api/state')).status()).toBe(401);
  const response = await request.post('/api/auth/login', {
    data: { email, password },
  });
  expect(response.status()).toBe(403);
}

test('administrator account APIs reject anonymous users, teachers and students', async ({
  request,
  playwright,
  baseURL,
}) => {
  await expectAdminForbidden(request, 401);
  const config = await request.get('/api/auth/config');
  expect(config.ok()).toBeTruthy();
  test.skip(!(await config.json()).demo, 'Sample-role accounts are local demo fixtures only.');
  for (const role of ['teacher', 'student']) {
    const context = await playwright.request.newContext({ baseURL });
    try {
      const user = await loginApi(context, `${role}@detuquy.vn`, 'Demo@2026');
      expect(user.user.isAdmin).not.toBe(true);
      await expectAdminForbidden(context, 403);
    } finally {
      await context.dispose();
    }
  }
});

test('an administrator manages teacher and student accounts while preserving classes and enrollments', async ({
  page,
  playwright,
  baseURL,
}) => {
  const administratorEmail = process.env.ADMIN_E2E_EMAIL;
  const administratorPassword = process.env.ADMIN_E2E_PASSWORD;
  test.skip(
    !administratorEmail || !administratorPassword,
    'Supply a dedicated temporary administrator through ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD.',
  );
  const admin = await playwright.request.newContext({ baseURL });
  const teacher = await playwright.request.newContext({ baseURL });
  const student = await playwright.request.newContext({ baseURL });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const teacherEmail = `e2e-admin-created-teacher-${suffix}@example.invalid`;
  const studentEmail = `e2e-admin-created-student-${suffix}@example.invalid`;
  let classroom: Classroom | undefined;
  let currentTeacherPassword = '';

  try {
    const signedIn = await loginApi(admin, administratorEmail!, administratorPassword!);
    expect(signedIn.user.isAdmin).toBe(true);
    const initial = await adminState(admin);
    const ownAccount = initial.users.find((user) => user.email === administratorEmail);
    expect(ownAccount?.isAdmin).toBe(true);
    for (const user of initial.users) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('sessionVersion');
      expect(user).not.toHaveProperty('authTokens');
    }

    await page.goto('/login');
    await page
      .getByRole('textbox', { name: 'Địa chỉ email', exact: true })
      .fill(administratorEmail!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(administratorPassword!);
    const authentication = mutationResponse(page, '/api/auth/login', 'POST');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    expect((await authentication).ok()).toBeTruthy();
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
    await page.getByRole('link', { name: 'Quản trị', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Quản trị tài khoản', exact: true }),
    ).toBeVisible();

    await findAccount(page, 'TEACHER', administratorEmail!);
    const ownRow = accountRow(page, administratorEmail!);
    await expect(ownRow.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true })).toHaveCount(
      0,
    );
    await expect(ownRow.getByRole('button', { name: 'Khóa tài khoản', exact: true })).toHaveCount(
      0,
    );
    const selfLock = await admin.patch(`/api/admin/users/${ownAccount!.id}`, {
      data: { disabled: true },
    });
    expect(selfLock.status()).toBe(403);
    const selfReset = await admin.post(`/api/admin/users/${ownAccount!.id}/reset-password`, {
      data: {},
    });
    expect(selfReset.status()).toBe(403);

    const teacherUser = await createAccount(
      page,
      'TEACHER',
      'Giáo viên quản trị kiểm thử',
      teacherEmail,
    );
    currentTeacherPassword = teacherUser.temporaryPassword;
    const teacherLogin = await loginApi(teacher, teacherEmail, currentTeacherPassword);
    expect(teacherLogin.user.role).toBe('TEACHER');
    expect(teacherLogin.user.mustChangePassword).toBe(true);
    expect(teacherLogin.user.isAdmin).not.toBe(true);
    expect((await teacher.get('/api/admin/users')).status()).toBe(403);
    expect(
      (
        await teacher.patch(`/api/admin/users/${teacherUser.id}`, { data: { isAdmin: true } })
      ).status(),
    ).toBe(403);

    expect(
      (
        await teacher.post('/api/actions', {
          data: { action: 'createClass', title: 'Phải đổi mật khẩu' },
        })
      ).status(),
    ).toBe(403);
    const initialTeacherChange = await teacher.patch('/api/profile', {
      data: {
        currentPassword: currentTeacherPassword,
        newPassword: customPassword,
        confirmPassword: customPassword,
      },
    });
    expect(initialTeacherChange.ok(), await initialTeacherChange.text()).toBeTruthy();
    currentTeacherPassword = customPassword;
    const newClass = await teacher.post('/api/actions', {
      data: {
        action: 'createClass',
        title: `Lớp kiểm tra giữ dữ liệu ${Date.now()}`,
        description: 'Lớp thử sẽ được xóa sau kiểm thử.',
        autoApprove: true,
      },
    });
    expect(newClass.ok(), await newClass.text()).toBeTruthy();
    classroom = (await newClass.json()).result as Classroom;
    await expect
      .poll(
        async () =>
          (await adminState(admin)).users.find((user) => user.id === teacherUser.id)?.classCount,
      )
      .toBe(1);
    await expect(
      accountRow(page, teacherEmail).getByRole('cell', { name: '1', exact: true }),
    ).toBeVisible();

    await renameAccount(page, teacherUser, 'Giáo viên đã cập nhật tên');
    currentTeacherPassword = await resetAccountPassword(page, teacherUser);
    await expectOldPasswordRejected(teacher, teacherEmail);
    await loginApi(teacher, teacherEmail, currentTeacherPassword);
    await changeAccountStatus(page, teacherUser, true);
    await expectAccountLocked(teacher, teacherEmail, currentTeacherPassword);
    const lockedTeacher = (await adminState(admin)).users.find(
      (user) => user.id === teacherUser.id,
    );
    expect(lockedTeacher?.disabled).toBe(true);
    expect(lockedTeacher?.classCount).toBe(1);

    await mkdir('.hallmark/screens', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: '.hallmark/screens/admin-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      accountRow(page, teacherEmail).getByRole('button', {
        name: 'Mở khóa tài khoản',
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: '.hallmark/screens/admin-mobile.png', fullPage: true });
    await changeAccountStatus(page, teacherUser, false);
    const restoredTeacher = await loginApi(teacher, teacherEmail, currentTeacherPassword);
    expect(restoredTeacher.user.name).toBe('Giáo viên đã cập nhật tên');
    expect(
      (
        await teacher.patch('/api/profile', {
          data: {
            currentPassword: currentTeacherPassword,
            newPassword: customPassword,
            confirmPassword: customPassword,
          },
        })
      ).ok(),
    ).toBeTruthy();
    currentTeacherPassword = customPassword;
    const retained = await teacher.get('/api/state');
    expect(retained.ok()).toBeTruthy();
    expect(
      (await retained.json()).classes.some((entry: Classroom) => entry.id === classroom!.id),
    ).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    const studentUser = await createAccount(
      page,
      'STUDENT',
      'Học viên quản trị kiểm thử',
      studentEmail,
    );
    const studentLogin = await loginApi(student, studentEmail, studentUser.temporaryPassword);
    expect(studentLogin.user.role).toBe('STUDENT');
    expect(studentLogin.user.mustChangePassword).toBe(true);
    expect(studentLogin.user.isAdmin).not.toBe(true);
    expect((await student.get('/api/admin/users')).status()).toBe(403);
    const studentChange = await student.patch('/api/profile', {
      data: {
        currentPassword: studentUser.temporaryPassword,
        newPassword: customPassword,
        confirmPassword: customPassword,
      },
    });
    expect(studentChange.ok()).toBeTruthy();
    const joined = await student.post('/api/actions', {
      data: { action: 'joinClass', code: classroom.code },
    });
    expect(joined.ok(), await joined.text()).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await adminState(admin)).users.find((user) => user.id === studentUser.id)
            ?.enrollmentCount,
      )
      .toBe(1);
    await expect(
      accountRow(page, studentEmail).getByRole('cell', { name: '1', exact: true }),
    ).toBeVisible();

    await renameAccount(page, studentUser, 'Học viên đã cập nhật tên');
    const studentProfile = await student.get('/api/profile');
    expect(studentProfile.ok(), await studentProfile.text()).toBeTruthy();
    expect((await studentProfile.json()).user.id).toBe(studentUser.id);
    const resetStudentPassword = await resetAccountPassword(page, studentUser);
    await expectOldPasswordRejected(student, studentEmail);
    await loginApi(student, studentEmail, resetStudentPassword);
    await changeAccountStatus(page, studentUser, true);
    await expectAccountLocked(student, studentEmail, resetStudentPassword);
    const lockedStudent = (await adminState(admin)).users.find(
      (user) => user.id === studentUser.id,
    );
    expect(lockedStudent?.disabled).toBe(true);
    expect(lockedStudent?.enrollmentCount).toBe(1);
    await page.screenshot({ path: '.hallmark/screens/admin-students-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      accountRow(page, studentEmail).getByRole('button', {
        name: 'Mở khóa tài khoản',
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: '.hallmark/screens/admin-students-mobile.png', fullPage: true });
    await changeAccountStatus(page, studentUser, false);
    const restoredStudent = await loginApi(student, studentEmail, resetStudentPassword);
    expect(restoredStudent.user.name).toBe('Học viên đã cập nhật tên');
    expect(
      (
        await student.patch('/api/profile', {
          data: {
            currentPassword: resetStudentPassword,
            newPassword: customPassword,
            confirmPassword: customPassword,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const retainedStudent = await student.get('/api/state');
    expect(retainedStudent.ok()).toBeTruthy();
    const studentState = await retainedStudent.json();
    expect(studentState.classes.some((entry: Classroom) => entry.id === classroom!.id)).toBe(true);
    expect(
      studentState.enrollments.some(
        (entry: { userId: string; classId: string; status: string }) =>
          entry.userId === studentUser.id &&
          entry.classId === classroom!.id &&
          entry.status === 'APPROVED',
      ),
    ).toBe(true);
  } finally {
    if (classroom) {
      // Keep fixture cleanup authorized; an interrupted test may have left its new teacher locked.
      const state = await adminState(admin).catch(() => null);
      const account = state?.users.find((user) => user.email === teacherEmail);
      if (account?.disabled)
        await admin.patch(`/api/admin/users/${account.id}`, { data: { disabled: false } });
      const auth = await teacher.post('/api/auth/login', {
        data: { email: teacherEmail, password: currentTeacherPassword },
      });
      if (auth.ok()) {
        const loggedIn = await auth.json();
        if (loggedIn.user.mustChangePassword) {
          const replacement = `Cleanup-${randomUUID()}`;
          await teacher.patch('/api/profile', {
            data: {
              currentPassword: currentTeacherPassword,
              newPassword: replacement,
              confirmPassword: replacement,
            },
          });
        }
        const response = await teacher.post('/api/actions', {
          data: { action: 'deleteClass', classId: classroom.id, code: classroom.code },
        });
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }
    await admin.dispose();
    await teacher.dispose();
    await student.dispose();
  }
});
