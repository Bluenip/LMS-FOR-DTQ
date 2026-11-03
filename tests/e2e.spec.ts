import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { AppState, Assignment, Classroom, Lesson, Submission } from '../src/lib/types';

const password = 'Demo@2026';
const essay = Array.from({ length: 40 }, () => 'Con học cách lắng nghe cha mẹ mỗi ngày.').join(' ');

async function apiLogin(api: APIRequestContext, role: 'student' | 'teacher') {
  const response = await api.post('/api/auth/login', {
    data: { email: `${role}@detuquy.vn`, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function action<T>(
  api: APIRequestContext,
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const response = await api.post('/api/actions', { data: { action: name, ...data } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result as T;
}

async function state(api: APIRequestContext): Promise<AppState> {
  const response = await api.get('/api/state');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function login(page: Page, role: 'student' | 'teacher') {
  await page.goto('/login');
  const authentication = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page
    .getByRole('textbox', { name: 'Địa chỉ email', exact: true })
    .fill(`${role}@detuquy.vn`);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const response = await authentication;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page).toHaveURL(role === 'student' ? /\/classes$/ : /\/teacher\/classes$/);
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
}

function actionResponse(page: Page, name: string) {
  return page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/actions') || response.request().method() !== 'POST')
      return false;
    return response.request().postDataJSON()?.action === name;
  });
}

test('API rejects malformed and oversized JSON and rate limits concurrent login attempts', async ({
  request,
  playwright,
  baseURL,
}) => {
  const headers = { 'Content-Type': 'application/json' };
  for (const data of ['{', 'null', '[]']) {
    const response = await request.post('/api/auth/login', { data, headers });
    expect(response.status()).toBe(400);
  }
  const oversized = await request.post('/api/auth/login', {
    data: JSON.stringify({ email: 'large@example.invalid', password: 'x'.repeat(9000) }),
    headers,
  });
  expect(oversized.status()).toBe(413);
  const email = `rate-${Date.now()}@example.invalid`;
  const responses = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      request.post('/api/auth/login', {
        data: { email, password: 'incorrect-password' },
        headers: { 'X-Forwarded-For': `203.0.113.${index + 1}` },
      }),
    ),
  );
  expect(responses.filter((r) => r.status() === 401)).toHaveLength(20);
  expect(responses.filter((r) => r.status() === 429)).toHaveLength(4);
  const student = await playwright.request.newContext({ baseURL });
  try {
    await apiLogin(student, 'student');
    const invalidAction = await student.post('/api/actions', { data: 'null', headers });
    expect(invalidAction.status()).toBe(400);
    const invalidFile = await student.post('/api/uploads/complete', { data: { fileId: null } });
    expect(invalidFile.status()).toBe(400);
    const health = await student.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers()['cache-control']).toContain('no-store');
  } finally {
    await student.dispose();
  }
});

test('drafts and unreturned grades stay private across the submission API lifecycle', async ({
  playwright,
  baseURL,
}) => {
  const teacher = await playwright.request.newContext({ baseURL });
  const student = await playwright.request.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await apiLogin(teacher, 'teacher');
    await apiLogin(student, 'student');
    classroom = await action<Classroom>(teacher, 'createClass', {
      title: `Quyền riêng tư bài làm E2E ${Date.now()}`,
      autoApprove: true,
    });
    await action(student, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài kiểm tra bản nháp riêng tư',
      instructions: 'Bài viết thử nghiệm riêng.',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const payload = { assignmentId: assignment.id, content: essay, pledge: true };
    const draft = await action<Submission>(student, 'saveSubmission', payload);
    expect((await state(teacher)).submissions.some((s) => s.id === draft.id)).toBe(false);
    expect((await state(student)).submissions.find((s) => s.id === draft.id)?.content).toBe(essay);

    await action(student, 'submitAssignment', payload);
    expect((await state(teacher)).submissions.find((s) => s.id === draft.id)?.status).toBe(
      'SUBMITTED',
    );
    await action(teacher, 'gradeSubmission', {
      submissionId: draft.id,
      rubric: { understanding: 35, application: 30, presentation: 18 },
      feedback: 'Nhận xét chưa được trả cho học viên.',
      returnGrade: false,
    });
    expect((await state(student)).submissions.find((s) => s.id === draft.id)).not.toHaveProperty(
      'score',
    );
    const withdrawn = await action<Submission>(student, 'withdrawSubmission', {
      assignmentId: assignment.id,
    });
    expect(withdrawn.status).toBe('DRAFT');
    for (const field of ['score', 'rubric', 'gradedAt'])
      expect(withdrawn).not.toHaveProperty(field);
    expect(withdrawn.feedback).toBe('');
    expect((await state(teacher)).submissions.some((s) => s.id === draft.id)).toBe(false);

    const resubmitted = await action<Submission>(student, 'submitAssignment', payload);
    expect(resubmitted.attempt).toBe(2);
    expect(resubmitted).not.toHaveProperty('score');
    expect((await state(teacher)).submissions.find((s) => s.id === draft.id)).not.toHaveProperty(
      'score',
    );

    const invalidVideo = await teacher.post('/api/actions', {
      data: {
        action: 'saveLesson',
        classId: classroom.id,
        title: 'Video không có tệp',
        order: 1,
        videoType: 'UPLOAD',
        videoUrl: 'https://example.invalid/unverified.mp4',
        published: true,
      },
    });
    expect(invalidVideo.status()).toBe(400);
  } finally {
    if (classroom)
      await action(teacher, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.dispose();
    await student.dispose();
  }
});

test('a late first submission is accepted while expired withdrawal is unavailable in the UI', async ({
  page,
  playwright,
  baseURL,
}) => {
  const teacher = await playwright.request.newContext({ baseURL });
  const student = await playwright.request.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await apiLogin(teacher, 'teacher');
    await apiLogin(student, 'student');
    classroom = await action<Classroom>(teacher, 'createClass', {
      title: `Thời hạn thu hồi E2E ${Date.now()}`,
      autoApprove: true,
    });
    await action(student, 'joinClass', { code: classroom.code });
    const assignment = await action<Assignment>(teacher, 'createAssignment', {
      classId: classroom.id,
      title: 'Bài cho phép nộp muộn',
      instructions: 'Bài thử nghiệm.',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      allowLate: true,
      allowResubmit: true,
      minWords: 1,
      maxWords: 50,
    });
    const submission = await action<Submission>(student, 'submitAssignment', {
      assignmentId: assignment.id,
      content: 'Bài nộp muộn được chấp nhận.',
      pledge: true,
    });
    expect(submission.attempt).toBe(1);
    await login(page, 'student');
    await page.goto(`/classes/${classroom.id}/assignments/${assignment.id}`);
    await expect(page.getByRole('heading', { name: 'Bài đã nộp', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Chỉnh sửa & nộp lại', exact: true }),
    ).toHaveCount(0);
    const withdrawal = await student.post('/api/actions', {
      data: { action: 'withdrawSubmission', assignmentId: assignment.id },
    });
    expect(withdrawal.status()).toBe(409);
  } finally {
    if (classroom)
      await action(teacher, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.dispose();
    await student.dispose();
  }
});

test('student persists lesson activity, drafts and submits an assignment', async ({
  page,
  playwright,
  baseURL,
}) => {
  const teacher = await playwright.request.newContext({ baseURL });
  const student = await playwright.request.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await apiLogin(teacher, 'teacher');
    classroom = await action<Classroom>(teacher, 'createClass', {
      title: `Giảng đường học viên E2E ${Date.now()}`,
      description: 'Lớp kiểm tra hành trình học tập, tự động dọn sau khi chạy.',
      autoApprove: true,
    });
    const lesson = await action<Lesson>(teacher, 'saveLesson', {
      classId: classroom.id,
      title: 'Thực hành lắng nghe và hiếu kính',
      chapter: 'Nhập tắc hiếu',
      order: 1,
      published: true,
      videoType: 'YOUTUBE',
      videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      description: 'Ghi lại một việc làm thiết thực dành cho cha mẹ.',
    });
    const assignment = await action<Assignment>(teacher, 'createAssignment', {
      classId: classroom.id,
      lessonId: lesson.id,
      title: 'Bài thực hành lắng nghe E2E',
      instructions: 'Viết từ 300 đến 500 từ về trải nghiệm thực hành.',
      minWords: 300,
      maxWords: 500,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      allowLate: false,
    });
    await apiLogin(student, 'student');
    await action(student, 'joinClass', { code: classroom.code });

    await login(page, 'student');
    const card = page
      .locator('article.class-card')
      .filter({ has: page.getByRole('heading', { name: classroom.title, exact: true }) });
    await card.getByRole('link', { name: 'Vào lớp' }).click();
    await expect(page.getByRole('heading', { level: 1, name: classroom.title })).toBeVisible();
    await page.getByRole('link', { name: 'Học tiếp', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `Bài 1: ${lesson.title}` }),
    ).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute(
      'src',
      /youtube-nocookie\.com\/embed\/aqz-KE-bpKQ/,
    );

    await page.getByRole('tab', { name: 'Ghi chép của tôi', exact: true }).click();
    await expect(page).toHaveURL(/tab=notes/);
    const note = 'Con sẽ trả lời lễ phép và lắng nghe khi cha mẹ gọi.';
    await page.getByLabel('Ghi chép cá nhân').fill(note);
    await page.getByRole('button', { name: 'Lưu ghi chép', exact: true }).click();
    await expect(page.getByText('Ghi chép đã được lưu.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Bỏ lưu bài học', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Đánh dấu hoàn thành', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đã hoàn thành', exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Ghi chép cá nhân')).toHaveValue(note);
    await expect(page.getByRole('button', { name: 'Bỏ lưu bài học', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã hoàn thành', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Thảo luận', exact: true }).click();
    const discussion = 'Hôm nay con đã chủ động giúp mẹ dọn bàn ăn.';
    await page.getByLabel('Chia sẻ cùng lớp').fill(discussion);
    await page.getByRole('button', { name: 'Gửi thảo luận', exact: true }).click();
    await expect(page.getByText(discussion, { exact: true })).toBeVisible();

    await page.goto(`/classes/${classroom.id}/assignments/${assignment.id}`, {
      waitUntil: 'domcontentloaded',
    });
    const draft = 'Con bắt đầu viết cảm nhận về bài học.';
    await page.getByLabel('Bài thu hoạch').fill(draft);
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    await expect(page.getByText('Bản nháp đã lưu.', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Bài thu hoạch')).toHaveValue(draft);
    await page.getByLabel('Tôi xác nhận đây là bài làm của mình').check();
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Bài viết cần từ 300 đến 500 từ',
    );
    await page.getByLabel('Bài thu hoạch').fill(essay);
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    const confirmation = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Xác nhận nộp bài', exact: true }) });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bài đã nộp', exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Bài đã nộp', exact: true })).toBeVisible();

    const persisted = await state(student);
    expect(persisted.notes.find((n) => n.lessonId === lesson.id)?.content).toBe(note);
    expect(persisted.progress.find((p) => p.lessonId === lesson.id)).toMatchObject({
      completed: true,
      bookmarked: true,
    });
    expect(persisted.submissions.find((s) => s.assignmentId === assignment.id)).toMatchObject({
      status: 'SUBMITTED',
      attempt: 1,
      content: essay,
    });
  } finally {
    if (classroom)
      await action(teacher, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await teacher.dispose();
    await student.dispose();
  }
});

test('teacher creates and publishes a lesson, approves enrollment and returns a rubric grade', async ({
  page,
  playwright,
  baseURL,
}) => {
  const student = await playwright.request.newContext({ baseURL });
  let classroom: Classroom | undefined;
  try {
    await login(page, 'student');
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, 'teacher');
    await expect(page.getByRole('heading', { name: 'Lớp giảng dạy', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tạo lớp học', exact: true }).first().click();
    const createDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Tạo lớp học mới', exact: true }) });
    const title = `Giảng đường giáo viên E2E ${Date.now()}`;
    await createDialog.getByLabel('Tên lớp học (bắt buộc)', { exact: true }).fill(title);
    await createDialog
      .getByLabel('Mô tả lớp học', { exact: true })
      .fill('Lớp kiểm tra quản lý, phê duyệt và chấm bài.');
    await createDialog.getByLabel('Sĩ số tối đa (1–500)', { exact: true }).fill('12');
    await createDialog.getByLabel('Lịch học', { exact: true }).fill('Chủ nhật, 19:30');
    const created = actionResponse(page, 'createClass');
    await createDialog.getByRole('button', { name: 'Tạo lớp học', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.ok()).toBeTruthy();
    classroom = (await createdResponse.json()).result as Classroom;
    await expect(createDialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

    await page.goto(`/teacher/lessons?class=${classroom.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Thêm bài giảng', exact: true }).click();
    const lessonTitle = 'Bài thực hành hiếu kính E2E';
    await expect(page.getByLabel('Chương mục', { exact: true })).toHaveValue('');
    await page.getByLabel('Chương mục', { exact: true }).fill('Chương thực hành của lớp');
    await page.getByLabel('Tiêu đề bài giảng (bắt buộc)', { exact: true }).fill(lessonTitle);
    await page
      .getByLabel('Mô tả bài học', { exact: true })
      .fill('Lắng nghe và thực hành bằng việc làm cụ thể.');
    await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeDisabled();
    const drafted = actionResponse(page, 'saveLesson');
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
    const draftResponse = await drafted;
    expect(draftResponse.ok()).toBeTruthy();
    const lesson = (await draftResponse.json()).result as Lesson;
    expect(lesson.published).toBe(false);
    await expect(
      page.getByRole('heading', { name: 'Biên tập bài giảng', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Liên kết YouTube', { exact: true }).fill('https://youtu.be/aqz-KE-bpKQ');
    await expect(
      page.getByText('Định dạng liên kết YouTube hợp lệ.', { exact: true }),
    ).toBeVisible();
    const published = actionResponse(page, 'saveLesson');
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    const publishedResponse = await published;
    expect(publishedResponse.ok()).toBeTruthy();
    expect((await publishedResponse.json()).result).toMatchObject({
      id: lesson.id,
      published: true,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Liên kết YouTube', { exact: true })).toHaveValue(
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    );

    await apiLogin(student, 'student');
    await action(student, 'joinClass', { code: classroom.code });
    await page.goto('/teacher/classes', { waitUntil: 'domcontentloaded' });
    const card = page
      .locator('article.class-card')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await card.getByRole('button', { name: /Thành viên/ }).click();
    const memberDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: `Thành viên lớp ${classroom.code}`, exact: true }),
    });
    const studentRow = memberDialog.getByRole('row').filter({ hasText: 'student@detuquy.vn' });
    await studentRow.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(
      memberDialog.getByText('Không có yêu cầu tham gia đang chờ xét duyệt.', { exact: true }),
    ).toBeVisible();
    await memberDialog.getByRole('tab', { name: /Chính thức/ }).click();
    await expect(
      memberDialog.getByRole('row').filter({ hasText: 'student@detuquy.vn' }),
    ).toBeVisible();
    await memberDialog.getByRole('button', { name: 'Đóng', exact: true }).click();

    const assignment = await action<Assignment>(page.request, 'createAssignment', {
      classId: classroom.id,
      lessonId: lesson.id,
      title: 'Bài cảm nhận để chấm E2E',
      instructions: 'Viết cảm nhận 300–500 từ.',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await action(student, 'submitAssignment', {
      assignmentId: assignment.id,
      content: essay,
      pledge: true,
    });
    await page.goto(`/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('tab', { name: /Cần chấm/ }).click();
    await page
      .getByRole('row')
      .filter({ hasText: 'student@detuquy.vn' })
      .getByRole('button', { name: 'Chấm bài', exact: true })
      .click();
    const gradeDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Bài làm của Nguyễn Văn An', exact: true }),
    });
    await gradeDialog.getByLabel('Hiểu nội dung (40 điểm)', { exact: true }).fill('39');
    await gradeDialog.getByLabel('Ví dụ & liên hệ thực tế (40 điểm)', { exact: true }).fill('37');
    await gradeDialog.getByLabel('Trình bày (20 điểm)', { exact: true }).fill('19');
    const feedback = 'Bài viết chân thành, tiếp tục thực hành mỗi ngày nhé.';
    await gradeDialog.getByLabel('Lời khuyên & nhận xét', { exact: true }).fill(feedback);
    await expect(gradeDialog.getByText('95 / 100', { exact: true })).toBeVisible();
    await gradeDialog.getByRole('button', { name: 'Lưu điểm nháp', exact: true }).click();
    await expect(gradeDialog).not.toBeVisible();
    const studentBeforeReturn = await state(student);
    expect(
      studentBeforeReturn.submissions.find((s) => s.assignmentId === assignment.id),
    ).toMatchObject({ status: 'SUBMITTED', feedback: '' });
    expect(
      studentBeforeReturn.submissions.find((s) => s.assignmentId === assignment.id)?.score,
    ).toBeUndefined();

    await page
      .getByRole('row')
      .filter({ hasText: 'student@detuquy.vn' })
      .getByRole('button', { name: 'Chấm bài', exact: true })
      .click();
    await expect(gradeDialog.getByLabel('Hiểu nội dung (40 điểm)', { exact: true })).toHaveValue(
      '39',
    );
    await gradeDialog.getByRole('button', { name: 'Trả bài học viên', exact: true }).click();
    const returnDialog = page
      .getByRole('dialog')
      .filter({
        has: page.getByRole('heading', { name: 'Công bố điểm cho học viên?', exact: true }),
      })
      .last();
    await returnDialog.getByRole('button', { name: 'Xác nhận trả bài', exact: true }).click();
    await expect(gradeDialog).not.toBeVisible();
    const returned = await state(student);
    expect(returned.submissions.find((s) => s.assignmentId === assignment.id)).toMatchObject({
      status: 'GRADED',
      score: 95,
      feedback,
    });
    expect(returned.notifications.some((n) => n.content.includes('95/100'))).toBeTruthy();

    await page.getByRole('tab', { name: /Đã chấm/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất bảng điểm', exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`bang-diem-${classroom.code}.csv`);
  } finally {
    if (classroom)
      await action(page.request, 'deleteClass', { classId: classroom.id, code: classroom.code });
    await student.dispose();
  }
});

test('all eight canonical screens render on desktop and mobile without horizontal overflow', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir('.hallmark/screens', { recursive: true });
  const screens = [
    { name: '01-classes', role: 'student', route: '/classes' },
    { name: '02-class-detail', role: 'student', route: '/classes/dtq-2026' },
    { name: '03-lesson', role: 'student', route: '/classes/dtq-2026/lessons/lesson-1' },
    { name: '04-assignment', role: 'student', route: '/classes/dtq-2026/assignments/assignment-1' },
    { name: '05-members', role: 'student', route: '/classes/dtq-2026/members' },
    { name: '06-teacher-classes', role: 'teacher', route: '/teacher/classes' },
    { name: '07-lesson-editor', role: 'teacher', route: '/teacher/lessons' },
    { name: '08-gradebook', role: 'teacher', route: '/teacher/assignments' },
  ] as const;
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    let role = '';
    for (const screen of screens) {
      if (role !== screen.role) {
        await apiLogin(page.request, screen.role);
        role = screen.role;
      }
      await page.goto(screen.route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${screen.route} at ${viewport.width}px`,
      ).toBeTruthy();
      await page.screenshot({
        path: `.hallmark/screens/${screen.name}-${viewport.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});
