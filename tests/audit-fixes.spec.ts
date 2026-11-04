import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AppState, Assignment, Classroom, Lesson } from '../src/lib/types';
import { versionedAction } from './versioned-action';

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const teacherEmail = process.env.E2E_TEACHER_A_EMAIL;
const studentEmail = process.env.E2E_STUDENT_EMAIL;
const password = process.env.E2E_TEACHER_TEST_PASSWORD;
test.skip(
  process.env.E2E_ISOLATED !== 'true' || !ownerEmail || !teacherEmail || !studentEmail || !password,
  'Requires isolated test accounts.',
);
async function login(api: APIRequestContext, email: string) {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function action<T>(
  api: APIRequestContext,
  actionName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const data = await versionedAction(api, actionName, payload);
  const response = await api.post('/api/actions', { data: { action: actionName, ...data } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result as T;
}
async function state(api: APIRequestContext): Promise<AppState> {
  return (await api.get('/api/state')).json();
}

test('a teacher can join and learn another class without receiving teacher permissions', async ({
  browser,
  baseURL,
}) => {
  const owner = await browser.newContext({ baseURL });
  const learner = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await Promise.all([
      login(owner.request, ownerEmail!),
      login(learner.request, teacherEmail!),
      login(student.request, studentEmail!),
    ]);
    const studentId = (await state(student.request)).user.id;
    const learnerId = (await state(learner.request)).user.id;
    classroom = await action<Classroom>(owner.request, 'createClass', {
      title: `Lớp học của giáo viên ${Date.now()}`,
      autoApprove: true,
    });
    const secret = await action<Lesson>(owner.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Nháp riêng của giảng viên',
      order: 1,
    });
    const lesson = await action<Lesson>(owner.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bài giảng công khai',
      chapter: 'Học tập',
      order: 2,
      published: true,
      videoUrl: 'https://youtu.be/abcdefghijk',
    });
    const a = await action<Assignment>(owner.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài cho lớp khác',
      instructions: 'Bài kiểm tra',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    await action(student.request, 'submitAssignment', {
      assignmentId: a.id,
      content: 'Bài riêng của học viên',
      pledge: true,
    });
    const page = await learner.newPage();
    await page.goto('/classes');
    await page.getByRole('button', { name: 'Tham gia bằng mã' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mã lớp học').fill(classroom.code);
    await dialog.getByRole('button', { name: 'Kiểm tra mã lớp' }).click();
    await dialog.getByRole('button', { name: 'Xác nhận tham gia' }).click();
    await dialog.getByRole('button', { name: 'Về danh sách lớp' }).click();
    await expect(page.getByRole('heading', { name: classroom.title })).toBeVisible();
    const snapshot = await state(learner.request);
    expect(snapshot.lessons.some((l) => l.id === secret.id)).toBe(false);
    expect(snapshot.lessons.some((l) => l.id === lesson.id)).toBe(true);
    expect(snapshot.submissions.some((s) => s.assignmentId === a.id)).toBe(false);
    expect(snapshot.users.find((u) => u.id === studentId)?.email).toBe('');
    await page.goto(`/classes/${classroom.id}/lessons/${lesson.id}`);
    await page.getByRole('button', { name: 'Đánh dấu hoàn thành' }).click();
    await expect(page.getByRole('button', { name: 'Đã hoàn thành' })).toBeVisible();
    await page.goto(`/classes/${classroom.id}/assignments/${a.id}`);
    await page.getByLabel('Bài thu hoạch').fill('Giáo viên học ở lớp khác');
    await page.getByLabel(/Tôi xác nhận/).check();
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận nộp bài' }).click();
    await expect(page.getByText('Bài đã được gửi lúc', { exact: false })).toBeVisible();
    expect(
      (await state(learner.request)).submissions.some(
        (s) => s.assignmentId === a.id && s.content.includes('Giáo viên học'),
      ),
    ).toBe(true);
    const submitted = (await state(owner.request)).submissions.find(
      (s) => s.assignmentId === a.id && s.studentId === learnerId,
    )!;
    const grade = {
      action: 'gradeSubmission',
      submissionId: submitted.id,
      rubric: { understanding: 30, application: 30, presentation: 15 },
      returnGrade: true,
      expectedAttempt: submitted.attempt,
      expectedSubmittedAt: submitted.submittedAt || null,
      expectedGradeRevision: submitted.gradeRevision || '',
    };
    expect((await owner.request.post('/api/actions', { data: grade })).ok()).toBe(true);
    expect((await owner.request.post('/api/actions', { data: grade })).status()).toBe(409);
    const oldClient = await owner.request.post('/api/actions', {
      data: {
        action: 'gradeSubmission',
        submissionId: submitted.id,
        rubric: grade.rubric,
        returnGrade: true,
      },
    });
    expect(oldClient.status()).toBe(409);
  } finally {
    if (classroom)
      await action(owner.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await owner.close();
    await learner.close();
    await student.close();
  }
});

test('failed lesson saves and student drafts survive navigation', async ({ browser, baseURL }) => {
  const owner = await browser.newContext({ baseURL });
  const learner = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await Promise.all([login(owner.request, ownerEmail!), login(learner.request, studentEmail!)]);
    classroom = await action<Classroom>(owner.request, 'createClass', {
      title: `Lớp bảo vệ bản thảo ${Date.now()}`,
      autoApprove: true,
    });
    await action(learner.request, 'joinClass', { code: classroom.code });
    const draft = await action<Lesson>(owner.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bản gốc',
      chapter: 'Phần học',
      order: 1,
    });
    const lesson = await action<Lesson>(owner.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bài học',
      chapter: 'Phần học',
      order: 2,
      published: true,
      videoUrl: 'https://youtu.be/abcdefghijk',
    });
    const assignment = await action<Assignment>(owner.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài tập bảo vệ bản thảo',
      instructions: 'Viết câu trả lời',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    const page = await owner.newPage();
    await page.goto(`/teacher/lessons?class=${classroom.id}&lesson=${draft.id}`);
    const title = page.getByLabel('Tiêu đề bài giảng (bắt buộc)');
    await title.fill('Thay đổi chưa lưu');
    await page.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'saveLesson')
        await route.fulfill({ status: 500, json: { error: 'Lỗi mạng giả lập' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    await expect(page.getByText('Lỗi mạng giả lập')).toBeVisible();
    page.once('dialog', (d) => void d.dismiss());
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Lớp giảng dạy' })
      .click();
    await expect(page).toHaveURL(/teacher\/lessons/);
    page.once('dialog', (d) => void d.accept());
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Lớp giảng dạy' })
      .click();
    await page.goto(`/teacher/lessons?class=${classroom.id}&lesson=${draft.id}`);
    await expect(title).toHaveValue('Thay đổi chưa lưu');
    await page.unroute('**/api/actions');
    await page.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'saveLesson')
        await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    await expect(title).toBeDisabled();
    await expect
      .poll(async () => (await state(owner.request)).lessons.find((l) => l.id === draft.id)?.title)
      .toBe('Thay đổi chưa lưu');
    const studentPage = await learner.newPage();
    await studentPage.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    await studentPage.getByLabel('Bài thu hoạch').fill('Nội dung chưa lưu');
    studentPage.once('dialog', (d) => void d.accept());
    await studentPage
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Lớp của tôi' })
      .click();
    await studentPage.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    await expect(studentPage.getByLabel('Bài thu hoạch')).toHaveValue('Nội dung chưa lưu');
    await studentPage.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'saveSubmission')
        await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await studentPage.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    await expect(studentPage.getByLabel('Bài thu hoạch')).toBeDisabled();
    await expect(studentPage.getByText('Bản nháp đã lưu.')).toBeVisible();
    await studentPage.goto(`/classes/${classroom.id}/lessons/${lesson.id}?tab=notes`);
    await studentPage.getByLabel('Ghi chép cá nhân').fill('Ghi chép chưa lưu');
    studentPage.once('dialog', (d) => void d.accept());
    await studentPage
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Lớp của tôi' })
      .click();
    await studentPage.goto(`/classes/${classroom.id}/lessons/${lesson.id}?tab=notes`);
    await expect(studentPage.getByLabel('Ghi chép cá nhân')).toHaveValue('Ghi chép chưa lưu');
  } finally {
    if (classroom)
      await action(owner.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await owner.close();
    await learner.close();
  }
});

test('class settings and assignment editors protect changes when a dialog is closed', async ({
  browser,
  baseURL,
}) => {
  const owner = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(owner.request, ownerEmail!);
    classroom = await action<Classroom>(owner.request, 'createClass', {
      title: `Lớp bảo vệ chỉnh sửa ${Date.now()}`,
      autoApprove: true,
    });
    const page = await owner.newPage();
    await page.goto('/teacher/classes');
    const card = page.locator('article.class-card').filter({ hasText: classroom.title });
    await card.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    const classDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Cài đặt lớp học', exact: true }) });
    await classDialog.getByLabel('Mô tả lớp học').fill('Cài đặt chưa lưu');
    page.once('dialog', (dialog) => void dialog.dismiss());
    await classDialog.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(classDialog.getByLabel('Mô tả lớp học')).toHaveValue('Cài đặt chưa lưu');
    page.once('dialog', (dialog) => void dialog.accept());
    await classDialog.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(classDialog).not.toBeVisible();

    await page.goto(`/teacher/assignments?class=${classroom.id}`);
    await page.getByRole('button', { name: 'Giao bài tập', exact: true }).first().click();
    const assignmentDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Giao bài tập mới', exact: true }) });
    await assignmentDialog.getByLabel('Tiêu đề bài tập (bắt buộc)').fill('Đề bài chưa lưu');
    page.once('dialog', (dialog) => void dialog.dismiss());
    await assignmentDialog.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(assignmentDialog.getByLabel('Tiêu đề bài tập (bắt buộc)')).toHaveValue(
      'Đề bài chưa lưu',
    );
    const backPrompt = page.waitForEvent('dialog');
    await page.evaluate(() => window.history.back());
    await (await backPrompt).dismiss();
    await expect(page).toHaveURL(/\/teacher\/assignments/);
    await expect(assignmentDialog.getByLabel('Tiêu đề bài tập (bắt buộc)')).toHaveValue(
      'Đề bài chưa lưu',
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await assignmentDialog.getByRole('button', { name: 'Hủy bỏ' }).click();
    await expect(assignmentDialog).not.toBeVisible();
  } finally {
    if (classroom)
      await action(owner.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await owner.close();
  }
});
