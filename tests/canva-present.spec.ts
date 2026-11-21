import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Assignment, Classroom } from '../src/lib/types';
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

const design = 'https://www.canva.com/design/DAGtest123/AbCdEf_456/view';
const embed = 'https://www.canva.com/design/DAGtest123/AbCdEf_456/view?embed';

test('a teacher presents a Canva submission full screen from the grading dialog', async ({
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
      title: `Trình chiếu Canva ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Báo cáo tâm đắc',
      instructions: 'Nộp bài thuyết trình Canva',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    await action(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: '',
      link: `${design}\nhttps://example.com/khong-phai-canva`,
      pledge: true,
    });

    const page = await teacher.newPage();
    // Stand in for Canva so the test does not depend on the network or a real design.
    await page.route(/^https:\/\/www\.canva\.com\//, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>Canva</title><body style="background:#fff"><h1>Slide 1 của học viên</h1></body>',
      }),
    );
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    await page.getByRole('button', { name: 'Chấm bài', exact: true }).first().click();

    // Only the Canva link offers a presentation.
    const present = page.getByRole('button', { name: 'Trình chiếu bài Canva toàn màn hình' });
    await expect(present).toHaveCount(1);
    await present.click();

    const stage = page.getByRole('dialog', { name: 'Trình chiếu bài Canva' });
    await expect(stage).toBeVisible();
    await expect(stage.locator('iframe')).toHaveAttribute('src', embed);
    await expect(
      page.frameLocator('.canva-stage iframe').getByText('Slide 1 của học viên'),
    ).toBeVisible();
    // The stage covers the whole window, above the grading dialog.
    const box = await stage.boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.round(box!.width)).toBe(viewport.width);
    expect(Math.round(box!.height)).toBe(viewport.height);
    const exit = page.getByRole('button', { name: 'Thoát trình chiếu' });
    await expect(exit).toBeFocused();

    await exit.click();
    await expect(stage).toHaveCount(0);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    // The grading dialog is still open behind it.
    await expect(present).toBeVisible();

    // Escape also ends it when the browser is not in full screen.
    await present.click();
    await expect(stage).toBeVisible();
    if (await page.evaluate(() => document.fullscreenElement !== null))
      await page.evaluate(() => document.exitFullscreen());
    else await page.keyboard.press('Escape');
    await expect(stage).toHaveCount(0);
    await expect(present).toBeVisible();
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('a canva.link short link also gets "Trình chiếu", using the design it leads to', async ({
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
      title: `Canva rút gọn ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Báo cáo tâm đắc',
      instructions: 'Nộp bài thuyết trình Canva',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    await action(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: '',
      link: 'https://canva.link/v91ulg5rmmzzj0r',
      pledge: true,
    });
    const page = await teacher.newPage();
    // The server reads where canva.link redirects; here that answer is stubbed.
    const asked: string[] = [];
    await page.route('**/api/canva/resolve?**', (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('url') || '');
      return route.fulfill({ json: { embed } });
    });
    await page.route(/^https:\/\/www\.canva\.com\//, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><body style="background:#fff"><h1>Slide rút gọn</h1></body>',
      }),
    );
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`);
    await page.getByRole('button', { name: 'Chấm bài', exact: true }).first().click();
    await page.getByRole('button', { name: 'Trình chiếu bài Canva toàn màn hình' }).click();
    const stage = page.getByRole('dialog', { name: 'Trình chiếu bài Canva' });
    await expect(stage.locator('iframe')).toHaveAttribute('src', embed);
    await expect(page.frameLocator('.canva-stage iframe').getByText('Slide rút gọn')).toBeVisible();
    expect(asked).toContain('https://canva.link/v91ulg5rmmzzj0r');
    await page.getByRole('button', { name: 'Thoát trình chiếu' }).click();
    await expect(stage).toHaveCount(0);

    // The real endpoint refuses links that are not canva.link short links.
    const refused = await teacher.request.get(
      `/api/canva/resolve?url=${encodeURIComponent('https://evil.example/abc')}`,
    );
    expect(refused.status()).toBe(400);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});
