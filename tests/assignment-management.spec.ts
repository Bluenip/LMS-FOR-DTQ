import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { AppState, Assignment, Classroom } from '../src/lib/types';

async function login(api: APIRequestContext, role: 'teacher' | 'student') {
  const r = await api.post('/api/auth/login', {
    data: { email: `${role}@detuquy.vn`, password: 'Demo@2026' },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function action<T>(api: APIRequestContext, action: string, data: Record<string, unknown>) {
  const r = await api.post('/api/actions', { data: { action, ...data } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).result as T;
}
async function state(api: APIRequestContext): Promise<AppState> {
  const r = await api.get('/api/state');
  expect(r.ok()).toBeTruthy();
  return r.json();
}
function dialog(page: Page, title: string) {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

test('a reminder is visible without reload, opening the bell keeps it unread and its link opens the assignment', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  let c: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher');
    await login(student.request, 'student');
    c = await action<Classroom>(teacher.request, 'createClass', {
      title: `Lời nhắc ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: c.code });
    const a = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: c.id,
      title: `Cảm ngộ cần nhắc ${Date.now()}`,
      instructions: 'Viết cảm nhận.',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const teacherPage = await teacher.newPage();
    const studentPage = await student.newPage();
    await teacherPage.goto(`/teacher/assignments?class=${c.id}&assignment=${a.id}`);
    await studentPage.goto('/classes');
    await expect(studentPage.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
    await studentPage.evaluate(() => {
      (window as Window & { reminderDocument?: string }).reminderDocument = 'same-document';
    });
    const unreadBefore = (await state(student.request)).notifications.filter((n) => !n.read).length;
    const row = teacherPage
      .getByRole('table', { name: 'Theo dõi và chấm bài học viên' })
      .getByRole('row')
      .filter({ hasText: 'student@detuquy.vn' });
    await row.getByRole('button', { name: 'Nhắc nộp', exact: true }).click();
    const bell = studentPage.getByRole('button', {
      name: `Thông báo (${unreadBefore + 1} chưa đọc)`,
      exact: true,
    });
    await expect(bell).toBeVisible({ timeout: 20000 });
    await expect(bell.locator('.notification-badge')).toHaveText(String(unreadBefore + 1));
    await expect(studentPage.locator('.unread-notification')).toContainText(a.title);
    expect(
      await studentPage.evaluate(
        () => (window as Window & { reminderDocument?: string }).reminderDocument,
      ),
    ).toBe('same-document');
    await bell.click();
    const notices = dialog(studentPage, 'Thông báo');
    await expect(
      notices
        .locator('.notification-item')
        .filter({ hasText: a.title })
        .getByText('Chưa đọc', { exact: true }),
    ).toBeVisible();
    expect(
      (await state(student.request)).notifications.find((n) => n.assignmentId === a.id)?.read,
    ).toBe(false);
    await notices.getByRole('button', { name: 'Đóng', exact: true }).click();
    await row.getByRole('button', { name: 'Nhắc nộp', exact: true }).click();
    await studentPage
      .getByRole('button', { name: `Thông báo (${unreadBefore + 2} chưa đọc)`, exact: true })
      .click();
    const items = notices.locator('.notification-item').filter({ hasText: a.title });
    await expect(items).toHaveCount(2);
    await items.last().getByRole('button', { name: 'Đánh dấu đã đọc', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await state(student.request)).notifications.filter(
            (n) => n.assignmentId === a.id && !n.read,
          ).length,
      )
      .toBe(1);
    await notices
      .locator('.notification-item.unread')
      .filter({ hasText: a.title })
      .getByRole('link', { name: 'Xem bài tập', exact: true })
      .click();
    await expect(studentPage).toHaveURL(new RegExp(`/classes/${c.id}/assignments/${a.id}$`));
    await expect(studentPage.getByRole('heading', { name: a.title, exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await state(student.request)).notifications.filter(
            (n) => n.assignmentId === a.id && !n.read,
          ).length,
      )
      .toBe(0);
  } finally {
    if (c) await action(teacher.request, 'deleteClass', { classId: c.id, code: c.code });
    await teacher.close();
    await student.close();
  }
});

test('teachers manage word requirements, a student submits over 500 words, and assignment deletion removes its data only', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  let c: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher');
    await login(student.request, 'student');
    c = await action<Classroom>(teacher.request, 'createClass', {
      title: `Quản lý bài ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: c.code });
    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${c.id}`);
    await page.getByRole('button', { name: 'Giao bài tập', exact: true }).click();
    const create = dialog(page, 'Giao bài tập mới');
    await expect(create.getByLabel('Số từ tối thiểu', { exact: true })).toHaveValue('150');
    await expect(create.getByLabel('Số từ tối đa', { exact: true })).toHaveValue('');
    const title = `Bài cảm ngộ tùy chỉnh ${Date.now()}`;
    await create.getByLabel('Tiêu đề bài tập (bắt buộc)', { exact: true }).fill(title);
    await create
      .getByLabel('Ngày hết hạn', { exact: true })
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await create.getByLabel('Số từ tối đa', { exact: true }).fill('100');
    await create.getByRole('button', { name: 'Giao bài tập', exact: true }).click();
    await expect(create.getByRole('alert')).toContainText('tối đa phải lớn hơn');
    await create.getByLabel('Số từ tối đa', { exact: true }).fill('200');
    await create.getByRole('button', { name: 'Giao bài tập', exact: true }).click();
    await expect(create).not.toBeVisible();
    const a = (await state(teacher.request)).assignments.find((a) => a.title === title)!;
    expect(a).toMatchObject({ minWords: 150, maxWords: 200 });
    const other = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: c.id,
      title: `Bài phải giữ ${Date.now()}`,
      instructions: 'Không xóa bài này.',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const studentPage = await student.newPage();
    await studentPage.goto(`/classes/${c.id}/assignments/${a.id}`);
    const essay = Array(650).fill('thực hành').join(' ');
    await studentPage.getByLabel('Bài thu hoạch', { exact: true }).fill(essay);
    await studentPage.getByLabel('Tôi xác nhận đây là bài làm của mình').check();
    await studentPage.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await expect(studentPage.locator('main').getByRole('alert')).toContainText('150 đến 200 từ');
    const managedRow = page
      .getByRole('table', { name: 'Quản lý bài tập đã giao' })
      .getByRole('row')
      .filter({ hasText: title });
    await managedRow.getByRole('button', { name: 'Sửa bài tập', exact: true }).click();
    const edit = dialog(page, 'Sửa bài tập');
    await expect(edit.getByLabel('Số từ tối đa', { exact: true })).toHaveValue('200');
    await edit.getByLabel('Số từ tối đa', { exact: true }).fill('');
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await expect(studentPage.locator('main')).toContainText('không giới hạn tối đa', {
      timeout: 20000,
    });
    await expect(studentPage.getByLabel('Bài thu hoạch', { exact: true })).toHaveValue(essay);
    await studentPage.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await dialog(studentPage, 'Xác nhận nộp bài')
      .getByRole('button', { name: 'Xác nhận nộp bài', exact: true })
      .click();
    await expect(
      studentPage.getByRole('heading', { name: 'Bài đã nộp', exact: true }),
    ).toBeVisible();
    await expect(managedRow).toContainText('1/1', { timeout: 20000 });
    await managedRow.getByRole('button', { name: 'Xóa bài tập', exact: true }).click();
    const remove = dialog(page, 'Xóa bài tập?');
    await expect(
      remove.getByRole('button', { name: 'Xác nhận xóa bài tập', exact: true }),
    ).toBeDisabled();
    await remove.getByLabel('Nhập tên bài tập để xác nhận', { exact: true }).fill(title);
    await remove.getByRole('button', { name: 'Xác nhận xóa bài tập', exact: true }).click();
    await expect(remove).not.toBeVisible();
    await expect(managedRow).toHaveCount(0);
    await expect(
      studentPage.getByRole('heading', { name: 'Không tìm thấy nội dung', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    const after = await state(student.request);
    expect(after.assignments.some((x) => x.id === a.id)).toBe(false);
    expect(after.submissions.some((s) => s.assignmentId === a.id)).toBe(false);
    expect(after.assignments.some((x) => x.id === other.id)).toBe(true);
  } finally {
    if (c) await action(teacher.request, 'deleteClass', { classId: c.id, code: c.code });
    await teacher.close();
    await student.close();
  }
});

test('class attribution can be edited and cleared, and new lesson chapters come only from their class', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  const classes: Classroom[] = [];
  try {
    await login(teacher.request, 'teacher');
    await login(student.request, 'student');
    const c = await action<Classroom>(teacher.request, 'createClass', {
      title: `Tác giả riêng ${Date.now()}`,
      contentAuthor: 'Cô An',
      autoApprove: true,
    });
    classes.push(c);
    const other = await action<Classroom>(teacher.request, 'createClass', {
      title: `Lớp không gắn tác giả ${Date.now()}`,
      autoApprove: true,
    });
    classes.push(other);
    for (const a of classes) await action(student.request, 'joinClass', { code: a.code });
    const studentPage = await student.newPage();
    await studentPage.goto('/classes');
    const card = studentPage
      .locator('article.class-card')
      .filter({ has: studentPage.getByRole('heading', { name: c.title, exact: true }) });
    const otherCard = studentPage
      .locator('article.class-card')
      .filter({ has: studentPage.getByRole('heading', { name: other.title, exact: true }) });
    await expect(card).toContainText('Nội dung: Cô An');
    await expect(otherCard.getByText(/^Nội dung:/)).toHaveCount(0);
    const page = await teacher.newPage();
    await page.goto('/teacher/classes');
    const teacherCard = page
      .locator('article.class-card')
      .filter({ has: page.getByRole('heading', { name: c.title, exact: true }) });
    await teacherCard.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    const edit = dialog(page, 'Cài đặt lớp học');
    await expect(edit.getByLabel('Người giảng nội dung', { exact: true })).toHaveValue('Cô An');
    await edit.getByLabel('Người giảng nội dung', { exact: true }).fill('Thầy Bình');
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await expect(card).toContainText('Nội dung: Thầy Bình', { timeout: 20000 });
    await teacherCard.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await edit.getByLabel('Người giảng nội dung', { exact: true }).fill('');
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await expect(card.getByText(/^Nội dung:/)).toHaveCount(0, { timeout: 20000 });
    await action(teacher.request, 'saveLesson', {
      classId: c.id,
      title: 'Bài có chương riêng',
      chapter: 'Chương riêng của lớp',
      order: 1,
      published: false,
    });
    await page.goto(`/teacher/lessons?class=${c.id}`);
    await page.getByRole('button', { name: 'Thêm bài giảng', exact: true }).click();
    await expect(page.getByLabel('Chương mục', { exact: true })).toHaveValue('');
    await expect(page.locator('#chapter-options option')).toHaveCount(1);
    await expect(page.locator('#chapter-options option')).toHaveAttribute(
      'value',
      'Chương riêng của lớp',
    );
    await page.goto(`/teacher/lessons?class=${other.id}`);
    await page.getByRole('button', { name: 'Thêm bài giảng', exact: true }).click();
    await expect(page.getByLabel('Chương mục', { exact: true })).toHaveValue('');
    await expect(page.locator('#chapter-options option')).toHaveCount(0);
  } finally {
    for (const c of classes)
      await action(teacher.request, 'deleteClass', { classId: c.id, code: c.code });
    await teacher.close();
    await student.close();
  }
});
