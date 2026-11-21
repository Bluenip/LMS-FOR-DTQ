import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AppState, Assignment, Classroom, Submission } from '../src/lib/types';
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
async function state(api: APIRequestContext): Promise<AppState> {
  const response = await api.get('/api/state');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

const existingLinks = [1, 2, 3, 4].map((n) => `https://example.com/minh-chung-${n}`);

test('a student adds a note and a link to a handed-in assignment without withdrawing it', async ({
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
      title: `Bổ sung bài nộp ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài cần bổ sung',
      instructions: 'Gửi minh chứng',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    const submitted = await action<Submission>(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: 'Bài làm ban đầu.',
      link: existingLinks.join('\n'),
      pledge: true,
    });

    const page = await student.newPage();
    await page.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    await page.getByRole('button', { name: 'Bổ sung bài nộp', exact: true }).click();
    const panel = page.locator('section.panel').filter({
      has: page.getByRole('heading', { name: 'Bổ sung bài nộp', exact: true }),
    });
    await expect(
      panel.getByText('Bài nộp đã có 4 liên kết, còn thêm được 1 (tối đa 5).', { exact: true }),
    ).toBeVisible();
    // Only one slot is left, so the editor offers no second row.
    await expect(panel.getByRole('button', { name: 'Thêm liên kết', exact: true })).toHaveCount(0);
    const send = panel.getByRole('button', { name: 'Gửi bổ sung', exact: true });
    await expect(send).toBeDisabled();

    // Re-entering a link that was already handed in adds nothing.
    const linkInput = panel.getByLabel('Liên kết bài thuyết trình / minh chứng', { exact: true });
    await linkInput.fill(existingLinks[0]);
    await expect(send).toBeDisabled();

    // The textarea sits inside its <label>, so its accessible name grows with what is typed.
    const note = panel.getByPlaceholder('Viết thêm điều bạn muốn gửi kèm bài đã nộp…');
    await note.fill('Em gửi thêm video trình bày.');
    await linkInput.fill('https://example.com/video-trinh-bay');

    // A failed send keeps what was typed.
    await page.route('**/api/actions', async (route) => {
      if (route.request().postDataJSON()?.action === 'addToSubmission')
        await route.fulfill({ status: 503, json: { error: 'Mạng tạm gián đoạn' } });
      else await route.continue();
    });
    await send.click();
    await expect(panel.getByRole('alert').filter({ hasText: 'Mạng tạm gián đoạn' })).toBeVisible();
    await expect(note).toHaveValue('Em gửi thêm video trình bày.');
    await expect(linkInput).toHaveValue('https://example.com/video-trinh-bay');
    await page.unroute('**/api/actions');

    await send.click();
    await expect(
      page.getByText('Đã gửi phần bổ sung. Giáo viên sẽ thấy cả bài nộp cũ và phần mới.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'https://example.com/video-trinh-bay', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Em gửi thêm video trình bày\./)).toBeVisible();

    const stored = (await state(student.request)).submissions.find((s) => s.id === submitted.id)!;
    expect(stored.status).toBe('SUBMITTED');
    expect(stored.attempt).toBe(submitted.attempt);
    expect(stored.submittedAt).toBe(submitted.submittedAt);
    expect(stored.content).toMatch(/^Bài làm ban đầu\.\n\n— Bổ sung lúc .+ —\nEm gửi thêm/);
    expect(stored.link.split('\n')).toEqual([
      ...existingLinks,
      'https://example.com/video-trinh-bay',
    ]);

    const teacherState = await state(teacher.request);
    expect(
      teacherState.notifications.some(
        (n) => n.assignmentId === assignment.id && /đã bổ sung bài nộp/.test(n.content),
      ),
    ).toBeTruthy();

    // With five links the form says no more links fit, but a note can still be added.
    await page.getByRole('button', { name: 'Bổ sung bài nộp', exact: true }).click();
    await expect(
      page.getByText('Bài nộp đã có đủ 5 liên kết nên không thêm được liên kết mới.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Liên kết bài thuyết trình / minh chứng', { exact: true }),
    ).toHaveCount(0);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});

test('the addendum disappears once the grade is returned and the server refuses it', async ({
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
      title: `Bổ sung sau khi chấm ${Date.now()}`,
      autoApprove: true,
    });
    await action(student.request, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher.request, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài đã chấm',
      instructions: 'Gửi minh chứng',
      minWords: 0,
      dueAt: '2099-01-01T00:00:00.000Z',
    });
    const submission = await action<Submission>(student.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: '',
      link: 'https://example.com/bai-lam',
      pledge: true,
    });
    const page = await student.newPage();
    await page.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    const open = page.getByRole('button', { name: 'Bổ sung bài nộp', exact: true });
    await expect(open).toBeVisible();

    await action(teacher.request, 'gradeSubmission', {
      submissionId: submission.id,
      rubric: { understanding: 30, application: 30, presentation: 15 },
      returnGrade: true,
    });
    await expect(
      page.getByRole('heading', { name: 'Nhận xét của giáo viên', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(open).toHaveCount(0);

    const refused = await student.request.post('/api/actions', {
      data: {
        action: 'addToSubmission',
        ...(await versionedAction(student.request, 'addToSubmission', {
          assignmentId: assignment.id,
          content: 'Bổ sung muộn',
        })),
      },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toMatch(/đã được chấm/);
  } finally {
    if (classroom)
      await action(teacher.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.close();
    await student.close();
  }
});
