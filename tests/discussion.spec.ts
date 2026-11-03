import { versionedAction } from './versioned-action';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { AppState, Classroom, Discussion, Lesson } from '../src/lib/types';

async function login(api: APIRequestContext, email: string) {
  const r = await api.post('/api/auth/login', { data: { email, password: 'Demo@2026' } });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function action<T>(api: APIRequestContext, action: string, payload: Record<string, unknown>) {
  const r = await api.post('/api/actions', {
    data: { action, ...(await versionedAction(api, action, payload)) },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).result as T;
}
async function state(api: APIRequestContext): Promise<AppState> {
  const r = await api.get('/api/state');
  expect(r.ok()).toBeTruthy();
  return r.json();
}
function deleteDialog(page: Page) {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Xóa thảo luận?', exact: true }) });
}
async function fixture(teacher: APIRequestContext, student: APIRequestContext) {
  const classroom = await action<Classroom>(teacher, 'createClass', {
    title: `Kiểm tra thảo luận ${Date.now()}`,
    autoApprove: true,
  });
  await action(student, 'joinClass', { code: classroom.code });
  const lesson = await action<Lesson>(teacher, 'saveLesson', {
    classId: classroom.id,
    title: 'Bài học thảo luận',
    chapter: 'Trao đổi',
    order: 1,
    published: true,
    videoType: 'YOUTUBE',
    videoUrl: 'https://youtu.be/abcdefghijk',
  });
  return { classroom, lesson, url: `/classes/${classroom.id}/lessons/${lesson.id}?tab=discussion` };
}

test('authors edit discussions while teachers moderate them and both pages synchronize without losing drafts', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher@detuquy.vn');
    await login(student.request, 'student@detuquy.vn');
    const f = await fixture(teacher.request, student.request);
    classroom = f.classroom;
    const studentName = (await state(student.request)).user.name;
    const studentPage = await student.newPage();
    await studentPage.goto(f.url, { waitUntil: 'domcontentloaded' });
    await studentPage
      .getByLabel('Chia sẻ cùng lớp', { exact: true })
      .fill('Chia sẻ ban đầu của học viên');
    await studentPage.getByRole('button', { name: 'Gửi thảo luận', exact: true }).click();
    const own = studentPage.getByRole('listitem', {
      name: `Thảo luận của ${studentName}`,
      exact: true,
    });
    await expect(own.getByText('Chia sẻ ban đầu của học viên', { exact: true })).toBeVisible();
    await own.getByRole('button', { name: 'Sửa', exact: true }).click();
    await own.getByLabel('Sửa nội dung thảo luận', { exact: true }).fill('Bản chưa lưu sẽ hủy');
    await own.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(own.getByText('Chia sẻ ban đầu của học viên', { exact: true })).toBeVisible();
    await expect(own.getByText('Đã chỉnh sửa', { exact: true })).toHaveCount(0);
    await own.getByRole('button', { name: 'Sửa', exact: true }).click();
    const edited = 'Nội dung học viên đã chỉnh sửa';
    await own.getByLabel('Sửa nội dung thảo luận', { exact: true }).fill(edited);
    const newDraft = 'Một thảo luận khác chưa gửi';
    await studentPage.getByLabel('Chia sẻ cùng lớp', { exact: true }).fill(newDraft);
    await studentPage.getByRole('tab', { name: 'Nội dung & tài liệu', exact: true }).click();
    await studentPage.getByRole('tab', { name: 'Thảo luận', exact: true }).click();
    await expect(own.getByLabel('Sửa nội dung thảo luận', { exact: true })).toHaveValue(edited);
    await expect(studentPage.getByLabel('Chia sẻ cùng lớp', { exact: true })).toHaveValue(newDraft);
    const teacherPage = await teacher.newPage();
    await teacherPage.goto(`/teacher/lessons?class=${classroom.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await teacherPage.getByRole('link', { name: 'Xem thảo luận', exact: true }).click();
    await expect(teacherPage).toHaveURL(new RegExp(`/lessons/${f.lesson.id}\\?tab=discussion$`));
    await action(teacher.request, 'comment', {
      lessonId: f.lesson.id,
      content: 'Lời nhắn riêng của giáo viên',
    });
    await expect(
      studentPage.getByText('Lời nhắn riêng của giáo viên', { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(own.getByLabel('Sửa nội dung thảo luận', { exact: true })).toHaveValue(edited);
    await own.getByRole('button', { name: 'Lưu chỉnh sửa', exact: true }).click();
    await expect(own.getByText(edited, { exact: true })).toBeVisible();
    await expect(own.getByText('Đã chỉnh sửa', { exact: true })).toBeVisible();
    const teacherView = teacherPage.getByRole('listitem', {
      name: `Thảo luận của ${studentName}`,
      exact: true,
    });
    await expect(teacherView.getByText(edited, { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(teacherView.getByRole('button', { name: 'Sửa', exact: true })).toHaveCount(0);
    await teacherView.getByRole('button', { name: 'Xóa', exact: true }).click();
    await deleteDialog(teacherPage).getByRole('button', { name: 'Giữ lại', exact: true }).click();
    await expect(own).toBeVisible();
    await own.getByRole('button', { name: 'Sửa', exact: true }).click();
    await own
      .getByLabel('Sửa nội dung thảo luận', { exact: true })
      .fill('Bản đang sửa khi giáo viên xóa');
    await teacherView.getByRole('button', { name: 'Xóa', exact: true }).click();
    await deleteDialog(teacherPage)
      .getByRole('button', { name: 'Xác nhận xóa', exact: true })
      .click();
    await expect(teacherView).toHaveCount(0);
    await expect(own).toHaveCount(0, { timeout: 20000 });
    await expect(studentPage.getByLabel('Sửa nội dung thảo luận', { exact: true })).toHaveValue(
      'Bản đang sửa khi giáo viên xóa',
    );
    await expect(
      studentPage.getByRole('button', { name: 'Lưu chỉnh sửa', exact: true }),
    ).toBeDisabled();
    await studentPage.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(
      studentPage.getByText('Lời nhắn riêng của giáo viên', { exact: true }),
    ).toBeVisible();
    await expect(studentPage.getByLabel('Chia sẻ cùng lớp', { exact: true })).toHaveValue(newDraft);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('peers cannot change other discussions and stale editing protects a newer revision before authors delete their own post', async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL });
  const student = await browser.newContext({ baseURL });
  const peer = await browser.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(teacher.request, 'teacher@detuquy.vn');
    await login(student.request, 'student@detuquy.vn');
    await login(peer.request, 'chau@detuquy.vn');
    const f = await fixture(teacher.request, student.request);
    classroom = f.classroom;
    await action(peer.request, 'joinClass', { code: classroom.code });
    const d = await action<Discussion>(student.request, 'comment', {
      lessonId: f.lesson.id,
      content: 'Bài của người viết',
    });
    const other = await action<Discussion>(peer.request, 'comment', {
      lessonId: f.lesson.id,
      content: 'Bài của học viên khác',
    });
    const studentName = (await state(student.request)).user.name;
    const page = await student.newPage();
    const peerPage = await peer.newPage();
    await page.goto(f.url, { waitUntil: 'domcontentloaded' });
    await peerPage.goto(f.url, { waitUntil: 'domcontentloaded' });
    const peerView = peerPage.getByRole('listitem', {
      name: `Thảo luận của ${studentName}`,
      exact: true,
    });
    await expect(peerView.getByText(d.content, { exact: true })).toBeVisible();
    await expect(peerView.getByRole('button')).toHaveCount(0);
    for (const actionName of ['updateComment', 'deleteComment']) {
      const r = await peer.request.post('/api/actions', {
        data: {
          action: actionName,
          discussionId: d.id,
          expectedContent: d.content,
          content: 'Không được sửa',
        },
      });
      expect(r.status()).toBe(403);
    }
    const own = page.getByRole('listitem', { name: `Thảo luận của ${studentName}`, exact: true });
    await own.getByRole('button', { name: 'Sửa', exact: true }).click();
    await own
      .getByLabel('Sửa nội dung thảo luận', { exact: true })
      .fill('Bản chưa lưu ở cửa sổ cũ');
    const latest = await action<Discussion>(student.request, 'updateComment', {
      discussionId: d.id,
      expectedContent: d.content,
      content: 'Phiên bản mới từ thiết bị khác',
    });
    await expect(own.getByRole('status')).toContainText('đã thay đổi trong một phiên khác', {
      timeout: 20000,
    });
    await expect(own.getByRole('button', { name: 'Lưu chỉnh sửa', exact: true })).toBeDisabled();
    await expect(own.getByLabel('Sửa nội dung thảo luận', { exact: true })).toHaveValue(
      'Bản chưa lưu ở cửa sổ cũ',
    );
    await own.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(own.getByText(latest.content, { exact: true })).toBeVisible();
    await own.getByRole('button', { name: 'Xóa', exact: true }).click();
    await deleteDialog(page).getByRole('button', { name: 'Xác nhận xóa', exact: true }).click();
    await expect(own).toHaveCount(0);
    await expect(peerView).toHaveCount(0, { timeout: 20000 });
    const after = await state(student.request);
    expect(after.discussions.some((x) => x.id === d.id)).toBe(false);
    expect(after.discussions.some((x) => x.id === other.id)).toBe(true);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
    await peer.close();
  }
});
