import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Assignment, Classroom, Discussion, Lesson, Submission } from '../src/lib/types';
import { versionedAction } from './versioned-action';

async function login(api: APIRequestContext, role: 'teacher' | 'student') {
  const response = await api.post('/api/auth/login', {
    data: { email: `${role}@detuquy.vn`, password: 'Demo@2026' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function action<T>(
  api: APIRequestContext,
  name: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await api.post('/api/actions', {
    data: { action: name, ...(await versionedAction(api, name, payload)) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result as T;
}

test('discussion edits survive navigation and failed saves, and cancellation requires confirmation', async ({
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
      title: `Bản sửa thảo luận ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const lesson = await action<Lesson>(teacher.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bài thảo luận',
      order: 1,
      published: true,
      description: 'Nội dung bài học',
    });
    const discussion = await action<Discussion>(student.request, 'comment', {
      lessonId: lesson.id,
      content: 'Nội dung gốc',
    });
    const page = await student.newPage();
    const url = `/classes/${classroom.id}/lessons/${lesson.id}?tab=discussion`;
    await page.goto(url);
    await page.getByRole('button', { name: 'Sửa', exact: true }).click();
    const editor = page.getByLabel('Sửa nội dung thảo luận', { exact: true });
    await editor.fill('Bản chỉnh sửa chưa lưu');
    const navigation = page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Lớp của tôi', exact: true });
    page.once('dialog', (dialog) => void dialog.dismiss());
    await navigation.click();
    await expect(editor).toHaveValue('Bản chỉnh sửa chưa lưu');
    page.once('dialog', (dialog) => void dialog.accept());
    await navigation.click();
    await expect(page).toHaveURL(/\/classes$/);
    await page.goto(url);
    await expect(editor).toHaveValue('Bản chỉnh sửa chưa lưu');
    await page.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'updateComment')
        await route.fulfill({ status: 503, json: { error: 'Mạng tạm gián đoạn' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Lưu chỉnh sửa', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mạng tạm gián đoạn' })).toBeVisible();
    await expect(editor).toHaveValue('Bản chỉnh sửa chưa lưu');
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(editor).toHaveValue('Bản chỉnh sửa chưa lưu');
    // A remote edit still conflicts with the original revision restored from session storage.
    await action(student.request, 'updateComment', {
      discussionId: discussion.id,
      expectedContent: discussion.content,
      content: 'Nội dung mới từ phiên khác',
    });
    await expect(page.getByText(/Thảo luận đã thay đổi trong một phiên khác/)).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('button', { name: 'Lưu chỉnh sửa', exact: true })).toBeDisabled();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Nội dung mới từ phiên khác', { exact: true })).toBeVisible();
    await expect(editor).toHaveCount(0);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('a remote link-only submission and returned grade keep a local draft visible without overwriting the submission', async ({
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
      title: `Bản viết hai phiên ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài nộp liên kết',
      instructions: 'Gửi minh chứng',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
      allowResubmit: false,
    });
    const page = await student.newPage();
    await page.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    await page.getByLabel('Bài thu hoạch', { exact: true }).fill('Bản viết đang dở cần giữ lại');
    const submission = await action<Submission>(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: '',
      link: 'https://example.com/evidence',
      pledge: true,
    });
    await expect(page.getByLabel('Nội dung bản đang viết', { exact: true })).toHaveValue(
      'Bản viết đang dở cần giữ lại',
      { timeout: 20000 },
    );
    await expect(
      page.getByText('Bài làm được gửi bằng liên kết minh chứng.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Bài làm được gửi dưới dạng tệp đính kèm.', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Sao chép bản đang viết', exact: true }),
    ).toBeVisible();
    await action(teacher.request, 'gradeSubmission', {
      submissionId: submission.id,
      rubric: { understanding: 30, application: 30, presentation: 15 },
      returnGrade: true,
    });
    await expect(
      page.getByRole('heading', { name: 'Nhận xét của giáo viên', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await expect(page.getByLabel('Nội dung bản đang viết', { exact: true })).toHaveValue(
      'Bản viết đang dở cần giữ lại',
    );
    await expect(page.getByRole('link', { name: 'Xem liên kết minh chứng' })).toHaveAttribute(
      'href',
      'https://example.com/evidence',
    );
    const state = await (await student.request.get('/api/state')).json();
    expect(state.submissions.find((item: Submission) => item.id === submission.id)).toMatchObject({
      status: 'GRADED',
      content: '',
      link: 'https://example.com/evidence',
    });
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('editing a linked draft keeps publication intent and detaching requires a fresh publication choice', async ({
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
      title: `Công bố bài tập ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const lesson = await action<Lesson>(teacher.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bài giảng nháp',
      order: 1,
    });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      lessonId: lesson.id,
      title: 'Bài chờ công bố',
      instructions: 'Đề bài gốc',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    const page = await teacher.newPage();
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    const edit = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Sửa bài tập', exact: true }) });
    async function openEdit() {
      await page.locator('.assignment-menu summary').click();
      await page.getByRole('button', { name: 'Sửa bài tập', exact: true }).click();
    }
    await openEdit();
    await expect(edit.getByLabel('Công bố bài tập', { exact: true })).toBeChecked();
    await edit.getByLabel('Hướng dẫn đề bài').fill('Đề bài đã sửa');
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    const teacherState = await (await teacher.request.get('/api/state')).json();
    expect(
      teacherState.assignments.find((entry: Assignment) => entry.id === assignment.id).published,
    ).toBe(true);
    await openEdit();
    await edit
      .getByRole('combobox', { name: 'Bài học liên quan', exact: true })
      .selectOption({ value: '' });
    await expect(edit.getByLabel('Công bố bài tập', { exact: true })).not.toBeChecked();
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    const studentState = await (await student.request.get('/api/state')).json();
    expect(studentState.assignments.some((entry: Assignment) => entry.id === assignment.id)).toBe(
      false,
    );
    await openEdit();
    await edit.getByLabel('Công bố bài tập', { exact: true }).check();
    await edit.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(edit).not.toBeVisible();
    const publishedState = await (await student.request.get('/api/state')).json();
    expect(publishedState.assignments.some((entry: Assignment) => entry.id === assignment.id)).toBe(
      true,
    );
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});
