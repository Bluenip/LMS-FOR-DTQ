import { versionedAction } from './versioned-action';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppState, Assignment, Classroom } from '../src/lib/types';

async function login(api: APIRequestContext, role: 'teacher' | 'student', email?: string) {
  const r = await api.post('/api/auth/login', {
    data: { email: email || `${role}@detuquy.vn`, password: 'Demo@2026' },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function action<T>(api: APIRequestContext, action: string, data: Record<string, unknown>) {
  const r = await api.post('/api/actions', {
    data: { action, ...(await versionedAction(api, action, data)) },
  });
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
        .filter({ hasText: 'Nhắc nộp bài:' })
        .getByText('Chưa đọc', { exact: true }),
    ).toBeVisible();
    expect(
      (await state(student.request)).notifications.find(
        (n) => n.assignmentId === a.id && n.content.startsWith('Nhắc nộp bài:'),
      )?.read,
    ).toBe(false);
    await notices.getByRole('button', { name: 'Đóng', exact: true }).click();
    await row.getByRole('button', { name: 'Nhắc nộp', exact: true }).click();
    await studentPage
      .getByRole('button', { name: `Thông báo (${unreadBefore + 2} chưa đọc)`, exact: true })
      .click();
    const items = notices
      .locator('.notification-item')
      .filter({ hasText: a.title })
      .filter({ hasText: 'Nhắc nộp bài:' });
    await expect(items).toHaveCount(2);
    await items.last().getByRole('button', { name: 'Đánh dấu đã đọc', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await state(student.request)).notifications.filter(
            (n) => n.assignmentId === a.id && n.content.startsWith('Nhắc nộp bài:') && !n.read,
          ).length,
      )
      .toBe(1);
    await notices
      .locator('.notification-item.unread')
      .filter({ hasText: a.title })
      .filter({ hasText: 'Nhắc nộp bài:' })
      .getByRole('link', { name: 'Xem bài tập', exact: true })
      .click();
    await expect(studentPage).toHaveURL(new RegExp(`/classes/${c.id}/assignments/${a.id}$`));
    await expect(studentPage.getByRole('heading', { name: a.title, exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await state(student.request)).notifications.filter(
            (n) => n.assignmentId === a.id && n.content.startsWith('Nhắc nộp bài:') && !n.read,
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
    await page.getByRole('button', { name: 'Giao bài tập', exact: true }).first().click();
    const create = dialog(page, 'Giao bài tập mới');
    await expect(create.getByLabel('Số từ tối thiểu', { exact: true })).toHaveValue('150');
    await expect(create.getByLabel('Số từ tối đa', { exact: true })).toHaveValue('');
    const title = `Bài cảm ngộ tùy chỉnh ${Date.now()}`;
    await create.getByLabel('Tiêu đề bài tập (bắt buộc)', { exact: true }).fill(title);
    await create.getByLabel('Hướng dẫn đề bài').fill('Viết cảm nhận của bạn.');
    await create
      .getByLabel('Ngày hết hạn', { exact: true })
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await create.getByLabel('Số từ tối đa', { exact: true }).fill('100');
    await create.getByRole('button', { name: 'Giao bài tập', exact: true }).click();
    await expect(create.getByRole('alert')).toContainText('tối đa phải lớn hơn');
    await create.getByLabel('Số từ tối đa', { exact: true }).fill('200');
    await create.getByRole('button', { name: 'Giao bài tập', exact: true }).click();
    await expect(create).not.toBeVisible();
    await expect(page.getByRole('status')).toContainText(title);
    await expect(page.getByRole('status').getByRole('link', { name: 'Xem bài nộp' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Quản lý bài tập đã giao' })).toBeVisible();
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
    await managedRow.locator('summary').click();
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
    await managedRow.locator('summary').click();
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

test('gradebook and CSV cover the entire approved class and protect a zero draft', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const students = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ baseURL })),
  );
  let classroom: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher');
    const initial = await state(teacher.request);
    const users = ['student-1', 'student-2', 'student-3', 'student-4'].map((id) =>
      initial.users.find((user) => user.id === id)!,
    );
    expect(users.every(Boolean)).toBeTruthy();
    for (let i = 0; i < students.length; i++)
      await login(students[i].request, 'student', users[i].email);
    classroom = await action<Classroom>(teacher.request, 'createClass', {
      title: `Sổ điểm ${Date.now()}`,
      autoApprove: true,
    });
    for (const student of students)
      await action(student.request, 'joinClass', { code: classroom.code });
    const first = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Cảm ngộ thứ nhất',
      instructions: 'Bài thử nghiệm',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const second = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Cảm ngộ thứ hai',
      instructions: 'Bài thử nghiệm khác',
      minWords: 0,
      dueAt: new Date(Date.now() + 172800000).toISOString(),
    });
    for (let i = 0; i < 3; i++)
      await action(students[i].request, 'submitAssignment', {
        assignmentId: first.id,
        content: 'Bài nộp',
        pledge: true,
      });
    await action(students[3].request, 'submitAssignment', {
      assignmentId: second.id,
      content: 'Bài khác',
      pledge: true,
    });
    const snapshot = await state(teacher.request);
    const submitted = (studentId: string, assignmentId: string) =>
      snapshot.submissions.find(
        (s) => s.studentId === studentId && s.assignmentId === assignmentId,
      )!;
    const zero = submitted(users[1].id, first.id);
    await action(teacher.request, 'gradeSubmission', {
      submissionId: zero.id,
      rubric: { understanding: 0, application: 0, presentation: 0 },
      feedback: 'Điểm nháp riêng tư',
      returnGrade: false,
    });
    await action(teacher.request, 'gradeSubmission', {
      submissionId: submitted(users[2].id, first.id).id,
      rubric: { understanding: 35, application: 35, presentation: 20 },
      feedback: 'Đã trả',
      returnGrade: true,
    });
    await action(teacher.request, 'gradeSubmission', {
      submissionId: submitted(users[3].id, second.id).id,
      rubric: { understanding: 30, application: 30, presentation: 10 },
      feedback: '',
      returnGrade: true,
    });
    const privateState = await state(students[1].request);
    expect(privateState.submissions.find((s) => s.id === zero.id)).toMatchObject({
      status: 'SUBMITTED',
      feedback: '',
    });
    expect(privateState.submissions.find((s) => s.id === zero.id)?.score).toBeUndefined();
    expect(
      privateState.notifications.filter(
        (n) => n.assignmentId === first.id && n.content.includes('đã được chấm'),
      ),
    ).toHaveLength(0);

    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${classroom.id}`);
    const list = page.getByRole('table', { name: 'Quản lý bài tập đã giao' });
    await expect(list).toBeVisible();
    await expect(page.getByRole('table', { name: 'Theo dõi và chấm bài học viên' })).toHaveCount(0);
    const firstRow = list.getByRole('row').filter({ hasText: first.title });
    await expect(firstRow).toContainText('3/4');
    await firstRow.getByRole('link', { name: 'Xem bài nộp' }).click();
    await expect(page).toHaveURL(new RegExp(`assignment=${first.id}`));
    await expect(list).toHaveCount(0);
    const stats = page.locator('.assignment-stats');
    await expect(stats.locator('.stat').nth(0)).toContainText('3 / 4');
    await expect(stats.locator('.stat').nth(1)).toContainText('2');
    await expect(stats.locator('.stat').nth(2)).toContainText('1');
    await expect(stats.locator('.stat').nth(3)).toContainText('1');
    await expect(stats.locator('.stat').nth(4)).toContainText('90');
    await page.getByRole('tab', { name: /Cần chấm/ }).click();
    await page.getByLabel('Tìm tên học viên…').fill(users[1].name);
    const zeroRow = page.getByRole('row').filter({ hasText: users[1].email });
    await expect(zeroRow).toContainText('Chờ chấm · Có điểm nháp');
    await expect(zeroRow).toContainText('0 (nháp)');
    await expect(page.getByRole('row').filter({ hasText: users[0].email })).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Xuất điểm bài này: ${first.title}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(classroom.code);
    expect(download.suggestedFilename()).toContain(first.id);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines.find((line) => line.includes(users[1].email))).toContain(
      '"Chờ chấm · Có điểm nháp","",',
    );
    expect(lines.find((line) => line.includes(users[2].email))).toContain('"Đã chấm","90",');
    expect(lines.find((line) => line.includes(users[3].email))).toContain('"Chưa nộp","","",');
    expect(lines.slice(1).every((line) => line.includes(first.title))).toBeTruthy();

    await zeroRow.getByRole('button', { name: 'Chấm bài' }).click();
    const grade = dialog(page, `Bài làm của ${users[1].name}`);
    await grade.getByRole('button', { name: 'Trả bài học viên' }).click();
    await dialog(page, 'Công bố điểm cho học viên?')
      .getByRole('button', { name: 'Xác nhận trả bài' })
      .click();
    await expect(grade).not.toBeVisible();
    await expect(stats.locator('.stat').nth(4)).toContainText('45');
    const after = await state(students[1].request);
    expect(after.submissions.find((s) => s.id === zero.id)).toMatchObject({
      status: 'GRADED',
      score: 0,
    });
    expect(
      after.notifications.some((n) => n.assignmentId === first.id && n.content.includes('0/100')),
    ).toBeTruthy();

    await page.getByRole('link', { name: '← Danh sách bài tập' }).click();
    await list
      .getByRole('row')
      .filter({ hasText: second.title })
      .getByRole('link', { name: 'Xem bài nộp' })
      .click();
    await expect(page.getByRole('heading', { name: second.title })).toBeVisible();
    await expect(stats.locator('.stat').nth(0)).toContainText('1 / 4');
    await expect(page.getByLabel('Tìm tên học viên…')).toHaveValue('');
    const otherDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Xuất điểm bài này: ${second.title}` }).click();
    const otherDownload = await otherDownloadPromise;
    expect(otherDownload.suggestedFilename()).toContain(second.id);
    expect(otherDownload.suggestedFilename()).not.toBe(download.suggestedFilename());
    const otherCsv = await readFile((await otherDownload.path())!, 'utf8');
    expect(otherCsv).toContain('"Đã chấm","70",');
    expect(otherCsv).not.toContain('"Đã chấm","90",');
    expect(otherCsv).not.toContain(first.title);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    for (const student of students) await student.close();
  }
});

test('assignment navigation preserves context, handles stale links and warns before discarding grading', async ({
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
      title: `Điều hướng ${Date.now()}`,
      autoApprove: true,
    });
    const empty = await action<Classroom>(teacher.request, 'createClass', {
      title: `Lớp rỗng ${Date.now()}`,
      autoApprove: true,
    });
    classes.push(c, empty);
    await action(student.request, 'joinClass', { code: c.code });
    const a = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: c.id,
      title: 'Bài kiểm tra điều hướng',
      instructions: 'Nội dung',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const blank = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: empty.id,
      title: 'Bài lớp rỗng',
      instructions: 'Nội dung',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await action(student.request, 'submitAssignment', {
      assignmentId: a.id,
      content: 'Bài nộp',
      pledge: true,
    });
    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${c.id}`);
    const table = page.getByRole('table', { name: 'Quản lý bài tập đã giao' });
    const row = table.getByRole('row').filter({ hasText: a.title });
    const menu = row.locator('summary');
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(row.getByRole('button', { name: 'Sửa bài tập' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.getByRole('button', { name: 'Sửa bài tập' })).toBeHidden();
    await row.getByRole('link', { name: a.title }).click();
    await expect(page.getByRole('heading', { name: a.title })).toBeVisible();
    await page.goBack();
    await expect(table).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: a.title })).toBeVisible();
    await page.getByRole('tab', { name: /Cần chấm/ }).click();
    await page.getByLabel('Tìm tên học viên…').fill('Nguyễn');
    await page.getByLabel('Lớp học').selectOption(empty.id);
    await expect(page).toHaveURL(new RegExp(`class=${empty.id}$`));
    await expect(page.getByRole('table', { name: 'Quản lý bài tập đã giao' })).toBeVisible();
    await expect(page.getByLabel('Tìm tên học viên…')).toHaveCount(0);
    await page.goto(`/teacher/assignments?assignment=${a.id}`);
    await expect(page.getByRole('heading', { name: a.title })).toBeVisible();
    await page.goto(`/teacher/assignments?class=${empty.id}&assignment=${a.id}`);
    await expect(page.getByRole('heading', { name: 'Bài tập không còn khả dụng' })).toBeVisible();
    await page.goto('/teacher/assignments?class=khong-ton-tai');
    await expect(page.getByRole('heading', { name: /Không tìm thấy lớp/ })).toBeVisible();
    await page.goto(`/teacher/assignments?class=${empty.id}&assignment=${blank.id}`);
    await expect(
      page.getByRole('heading', { name: 'Lớp chưa có học viên chính thức' }),
    ).toBeVisible();
    const emptyDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: `Xuất điểm bài này: ${blank.title}` }).click();
    expect(
      (await readFile((await (await emptyDownload).path())!, 'utf8')).split('\r\n'),
    ).toHaveLength(1);
    await page.goto(`/teacher/assignments?class=${c.id}`);
    await page.getByRole('link', { name: a.title }).click();
    await page.getByRole('button', { name: 'Chấm bài' }).click();
    const grading = dialog(page, 'Bài làm của Nguyễn Văn An');
    await grading.getByLabel('Lời khuyên & nhận xét').fill('Nhận xét chưa lưu');
    const cancelClose = page.waitForEvent('dialog').then((prompt) => prompt.dismiss());
    await Promise.all([cancelClose, page.keyboard.press('Escape')]);
    await expect(grading).toBeVisible();
    const cancelBack = page.waitForEvent('dialog').then((prompt) => prompt.dismiss());
    await Promise.all([cancelBack, page.evaluate(() => history.back())]);
    await expect(grading).toBeVisible();
    await expect(grading.getByLabel('Lời khuyên & nhận xét')).toHaveValue('Nhận xét chưa lưu');
    await expect(page).toHaveURL(new RegExp(`assignment=${a.id}`));
    await grading.getByRole('button', { name: 'Đóng bài chấm' }).click();
    await dialog(page, 'Điểm chưa được lưu').getByRole('button', { name: 'Bỏ thay đổi' }).click();
    await expect(grading).not.toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('button', { name: `Xuất điểm bài này: ${a.title}` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'student@detuquy.vn' })).toBeVisible();
    await page.locator('.assignment-menu summary').click();
    await expect(page.getByRole('button', { name: 'Sửa bài tập' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Sửa bài tập' })).toBeHidden();
    await action(teacher.request, 'deleteAssignment', {
      assignmentId: a.id,
      confirmTitle: a.title,
    });
    await expect(page.getByRole('heading', { name: 'Bài tập không còn khả dụng' })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('link', { name: '← Danh sách bài tập' }).click();
    await expect(page.getByRole('heading', { name: 'Lớp này chưa có bài tập' })).toBeVisible();
  } finally {
    for (const c of classes)
      await action(teacher.request, 'deleteClass', { classId: c.id, code: c.code });
    await teacher.close();
    await student.close();
  }
});

test('an open grading draft survives withdrawal and blocks grading a later attempt', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher');
    await login(student.request, 'student');
    classroom = await action<Classroom>(teacher.request, 'createClass', {
      title: `Thu hồi khi chấm ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài cho phép nộp lại',
      instructions: 'Nội dung',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await action(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: 'Lần nộp thứ nhất',
      pledge: true,
    });
    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    await page.getByRole('button', { name: 'Chấm bài' }).click();
    const grading = dialog(page, 'Bài làm của Nguyễn Văn An');
    await grading.getByLabel('Lời khuyên & nhận xét').fill('Nhận xét chưa lưu');
    await action(student.request, 'withdrawSubmission', { assignmentId: assignment.id });
    await expect(grading.getByRole('alert')).toContainText('Học viên đã thu hồi bài', {
      timeout: 20000,
    });
    await expect(grading.getByLabel('Lời khuyên & nhận xét')).toHaveValue('Nhận xét chưa lưu');
    await expect(grading.getByRole('button', { name: 'Lưu điểm nháp' })).toBeDisabled();
    await action(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: 'Lần nộp thứ hai',
      pledge: true,
    });
    await expect(grading.getByRole('alert')).toContainText('Học viên đã nộp lại bài', {
      timeout: 20000,
    });
    await expect(grading.getByLabel('Lời khuyên & nhận xét')).toHaveValue('Nhận xét chưa lưu');
    await expect(grading.getByRole('button', { name: 'Trả bài học viên' })).toBeDisabled();
    await grading.getByRole('button', { name: 'Đóng bài chấm' }).click();
    await dialog(page, 'Điểm chưa được lưu').getByRole('button', { name: 'Bỏ thay đổi' }).click();
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('detail editing and deletion return to the correct class and failed writes show errors', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher');
    classroom = await action<Classroom>(teacher.request, 'createClass', {
      title: `Thao tác chi tiết ${Date.now()}`,
      autoApprove: true,
    });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài sửa từ chi tiết',
      instructions: 'Nội dung',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    await page.locator('.assignment-menu summary').click();
    await page.getByRole('button', { name: 'Sửa bài tập' }).click();
    const edit = dialog(page, 'Sửa bài tập');
    await edit.getByLabel('Hướng dẫn đề bài').fill('Hướng dẫn đã sửa');
    await edit.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(edit).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`assignment=${assignment.id}`));
    expect(
      (await state(teacher.request)).assignments.find((a) => a.id === assignment.id)?.instructions,
    ).toBe('Hướng dẫn đã sửa');
    await page.locator('.assignment-menu summary').click();
    await page.getByRole('button', { name: 'Xóa bài tập' }).click();
    const remove = dialog(page, 'Xóa bài tập?');
    await expect(remove).toContainText('bài đã nộp, điểm và thông báo');
    await remove.getByLabel('Nhập tên bài tập để xác nhận').fill(assignment.title);
    await remove.getByRole('button', { name: 'Xác nhận xóa bài tập' }).click();
    await expect(page).toHaveURL(new RegExp(`class=${classroom.id}$`));
    await expect(page.getByRole('status')).toContainText(`Đã xóa bài tập “${assignment.title}”`);
    await expect(page.getByRole('heading', { name: 'Lớp này chưa có bài tập' })).toBeVisible();

    await page.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'createAssignment')
        await route.fulfill({
          status: 500,
          json: { error: 'Máy chủ từ chối yêu cầu thử nghiệm.' },
        });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Giao bài tập', exact: true }).first().click();
    const create = dialog(page, 'Giao bài tập mới');
    await create.getByLabel('Tiêu đề bài tập (bắt buộc)').fill('Bài tạo thất bại');
    await create.getByLabel('Hướng dẫn đề bài').fill('Đề bài thử nghiệm');
    await create
      .getByLabel('Ngày hết hạn')
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await create.getByRole('button', { name: 'Giao bài tập' }).click();
    await expect(create.getByRole('alert')).toHaveText('Máy chủ từ chối yêu cầu thử nghiệm.');
    await expect(create).toBeVisible();
    await create.getByRole('button', { name: 'Hủy bỏ' }).click();
    await page.unroute('**/api/actions');
    await page.route('**/api/state', async (route) => {
      const response = await route.fetch();
      const current = await response.json();
      await route.fulfill({
        response,
        json: {
          ...current,
          classes: [],
          assignments: [],
          enrollments: [],
          lessons: [],
          submissions: [],
        },
      });
    });
    await page.goto('/teacher/assignments');
    await expect(page.getByRole('heading', { name: 'Bạn chưa phụ trách lớp nào' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lớp giảng dạy' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Giao bài tập' })).toHaveCount(0);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
  }
});
