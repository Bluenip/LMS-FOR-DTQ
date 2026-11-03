import { versionedAction } from './versioned-action';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AppState, Assignment, Classroom } from '../src/lib/types';

const emails = [
  process.env.E2E_OWNER_EMAIL,
  process.env.E2E_TEACHER_A_EMAIL,
  process.env.E2E_TEACHER_B_EMAIL,
  process.env.E2E_STUDENT_EMAIL,
];
const password = process.env.E2E_TEACHER_TEST_PASSWORD;

test.skip(
  process.env.E2E_ISOLATED !== 'true' || !password || emails.some((email) => !email),
  'Requires dedicated isolated teacher test accounts.',
);

async function login(api: APIRequestContext, email: string) {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}
async function action<T>(api: APIRequestContext, name: string, values: Record<string, unknown>) {
  const response = await api.post('/api/actions', {
    data: { action: name, ...(await versionedAction(api, name, values)) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result as T;
}
async function state(api: APIRequestContext): Promise<AppState> {
  const response = await api.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('the creator assigns two teachers, who can teach and grade until removed', async ({
  browser,
  baseURL,
}) => {
  const [owner, first, second, student] = await Promise.all(
    emails.map(() => browser.newContext({ baseURL })),
  );
  let classroom: Classroom | undefined;
  try {
    await Promise.all(
      [owner, first, second, student].map((context, index) =>
        login(context.request, emails[index]!),
      ),
    );
    classroom = await action<Classroom>(owner.request, 'createClass', {
      title: `Lớp nhiều giáo viên ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(owner.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài kiểm tra phân công',
      instructions: 'Nội dung',
      minWords: 0,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await action(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: 'Bài nộp',
      pledge: true,
    });
    const ownerPage = await owner.newPage();
    await ownerPage.goto('/teacher/classes');
    const card = ownerPage
      .locator('article.class-card')
      .filter({ has: ownerPage.getByRole('heading', { name: classroom.title, exact: true }) });
    await expect(card).toContainText('Chưa phân công giáo viên');
    await card.getByRole('button', { name: 'Giáo viên phụ trách', exact: true }).click();
    const manager = ownerPage
      .getByRole('dialog')
      .filter({ has: ownerPage.getByRole('heading', { name: 'Phân công giáo viên phụ trách' }) });
    await manager.getByLabel(/Giáo viên Kiểm thử A/).check();
    await manager.getByLabel(/Giáo viên Kiểm thử B/).check();
    await manager.getByRole('button', { name: 'Lưu phân công' }).click();
    await expect(manager).not.toBeVisible();
    await expect(card).toContainText('Giáo viên Kiểm thử A, Giáo viên Kiểm thử B');
    expect((await first.request.get(`/api/classes/${classroom.id}/teachers`)).status()).toBe(403);
    expect((await student.request.get(`/api/classes/${classroom.id}/teachers`)).status()).toBe(403);
    const studentPage = await student.newPage();
    await studentPage.goto('/classes');
    const studentCard = studentPage
      .locator('article.class-card')
      .filter({ has: studentPage.getByRole('heading', { name: classroom.title, exact: true }) });
    await expect(studentCard).toContainText('Giáo viên Kiểm thử A, Giáo viên Kiểm thử B');
    const firstPage = await first.newPage();
    await firstPage.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    await expect(firstPage.getByRole('heading', { name: assignment.title })).toBeVisible();
    await firstPage.getByRole('button', { name: 'Chấm bài' }).click();
    const grade = firstPage
      .getByRole('dialog')
      .filter({ has: firstPage.getByRole('heading', { name: /Bài làm của/ }) });
    await grade.getByLabel('Hiểu nội dung (40 điểm)').fill('30');
    await grade.getByLabel('Ví dụ & liên hệ thực tế (40 điểm)').fill('30');
    await grade.getByLabel('Trình bày (20 điểm)').fill('20');
    await grade.getByRole('button', { name: 'Trả bài học viên' }).click();
    await firstPage
      .getByRole('dialog')
      .filter({ has: firstPage.getByRole('heading', { name: 'Công bố điểm cho học viên?' }) })
      .getByRole('button', { name: 'Xác nhận trả bài' })
      .click();
    await expect(grade).not.toBeVisible();
    expect(
      (await state(student.request)).submissions.find((s) => s.assignmentId === assignment.id)
        ?.score,
    ).toBe(80);
    expect((await state(second.request)).classes.some((c) => c.id === classroom!.id)).toBe(true);
    await card.getByRole('button', { name: 'Giáo viên phụ trách', exact: true }).click();
    await manager.getByLabel(/Giáo viên Kiểm thử A/).uncheck();
    await manager.getByRole('button', { name: 'Lưu phân công' }).click();
    await expect(card).toContainText('Giáo viên Kiểm thử B');
    expect((await state(first.request)).classes.some((c) => c.id === classroom!.id)).toBe(false);
    await expect(firstPage.getByRole('heading', { name: /Không tìm thấy lớp/ })).toBeVisible({
      timeout: 20_000,
    });
    const forbidden = await first.request.post('/api/actions', {
      data: {
        action: 'createAssignment',
        classId: classroom.id,
        title: 'Không còn quyền',
        instructions: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    if (classroom)
      await action(owner.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    for (const context of [owner, first, second, student]) await context.close();
  }
});
