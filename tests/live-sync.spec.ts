import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { AppState, Assignment, Classroom, Lesson, Submission } from '../src/lib/types';

async function signIn(api: APIRequestContext, role: 'teacher' | 'student') {
  const response = await api.post('/api/auth/login', {
    data: { email: `${role}@detuquy.vn`, password: 'Demo@2026' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function mutate<T>(
  api: APIRequestContext,
  action: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await api.post('/api/actions', { data: { action, ...data } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).result as T;
}

async function openDocument(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  const marker = `document-${Date.now()}-${Math.random()}`;
  await page.evaluate((value) => {
    (window as Window & { __liveSyncDocument?: string }).__liveSyncDocument = value;
  }, marker);
  return marker;
}

async function expectSameDocument(page: Page, marker: string) {
  expect(
    await page.evaluate(
      () => (window as Window & { __liveSyncDocument?: string }).__liveSyncDocument,
    ),
  ).toBe(marker);
}

function observeState(page: Page, includes: (state: AppState) => boolean) {
  return page.waitForResponse(
    async (response) => {
      if (!response.url().endsWith('/api/state') || !response.ok()) return false;
      return includes((await response.json()) as AppState);
    },
    { timeout: 20_000 },
  );
}

test('teacher and student receive remote changes without reload and keep unsaved input', async ({
  browser,
  baseURL,
}) => {
  const teacherContext = await browser.newContext({ baseURL });
  const studentContext = await browser.newContext({ baseURL });
  const teacherPage = await teacherContext.newPage();
  const studentPage = await studentContext.newPage();
  let classroom: Classroom | undefined;

  try {
    await signIn(teacherContext.request, 'teacher');
    await signIn(studentContext.request, 'student');
    classroom = await mutate<Classroom>(teacherContext.request, 'createClass', {
      title: `Đồng bộ hai phiên ${Date.now()}`,
      description: 'Lớp riêng để kiểm tra đồng bộ không tải lại trang.',
      autoApprove: false,
    });
    const enrollment = await mutate<{ id: string }>(studentContext.request, 'joinClass', {
      code: classroom.code,
    });

    await openDocument(teacherPage, '/teacher/classes');
    let studentMarker = await openDocument(studentPage, '/classes');
    const classCard = studentPage.locator('article.class-card').filter({
      has: studentPage.getByRole('heading', { name: classroom.title, exact: true }),
    });
    await expect(classCard).toHaveCount(0);

    // Approval happens in a separate authenticated session while the student keeps this page open.
    await mutate(teacherContext.request, 'approveEnrollment', { enrollmentId: enrollment.id });
    await expect(classCard).toBeVisible({ timeout: 20_000 });
    await expectSameDocument(studentPage, studentMarker);

    studentMarker = await openDocument(studentPage, `/classes/${classroom.id}?tab=lessons`);
    await expect(studentPage.getByRole('heading', { name: 'Chưa có bài giảng' })).toBeVisible();
    const lesson = await mutate<Lesson>(teacherContext.request, 'saveLesson', {
      classId: classroom.id,
      title: 'Bài học vừa được xuất bản',
      chapter: 'Thực hành hằng ngày',
      order: 1,
      description: 'Nội dung bài học ban đầu.',
      published: true,
      videoType: 'YOUTUBE',
      videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    });
    await expect(studentPage.getByRole('link').filter({ hasText: lesson.title })).toBeVisible({
      timeout: 20_000,
    });
    await expectSameDocument(studentPage, studentMarker);

    studentMarker = await openDocument(
      studentPage,
      `/classes/${classroom.id}/lessons/${lesson.id}?tab=notes`,
    );
    const unsavedNote = 'Ghi chép đang viết phải được giữ nguyên khi giáo viên cập nhật bài giảng.';
    await studentPage.getByLabel('Ghi chép cá nhân').fill(unsavedNote);
    const renamedTitle = 'Bài học đã cập nhật từ phiên giáo viên';
    await mutate(teacherContext.request, 'saveLesson', { ...lesson, title: renamedTitle });
    await expect(
      studentPage.getByRole('heading', { level: 1, name: `Bài 1: ${renamedTitle}` }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(studentPage.getByLabel('Ghi chép cá nhân')).toHaveValue(unsavedNote);
    await expectSameDocument(studentPage, studentMarker);

    const assignment = await mutate<Assignment>(teacherContext.request, 'createAssignment', {
      classId: classroom.id,
      lessonId: lesson.id,
      title: 'Bài cảm nhận có đồng bộ tự động',
      instructions: 'Viết cảm nhận từ 300 đến 500 từ.',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    studentMarker = await openDocument(
      studentPage,
      `/classes/${classroom.id}/assignments/${assignment.id}`,
    );
    const unsavedEssay = 'Bài thu hoạch chưa lưu vẫn còn nguyên sau lần cập nhật nền.';
    await studentPage.getByLabel('Bài thu hoạch').fill(unsavedEssay);
    const observedNewLesson = observeState(studentPage, (state) =>
      state.lessons.some((entry) => entry.title === 'Bài giảng thứ hai kiểm tra giữ bản nháp'),
    );
    await mutate(teacherContext.request, 'saveLesson', {
      ...lesson,
      id: undefined,
      order: 2,
      title: 'Bài giảng thứ hai kiểm tra giữ bản nháp',
    });
    await observedNewLesson;
    await expect(studentPage.getByLabel('Bài thu hoạch')).toHaveValue(unsavedEssay);
    await expectSameDocument(studentPage, studentMarker);

    const teacherMarker = await openDocument(
      teacherPage,
      `/teacher/assignments?class=${classroom.id}&assignment=${assignment.id}`,
    );
    const studentRow = teacherPage.getByRole('row').filter({ hasText: 'student@detuquy.vn' });
    await expect(studentRow.getByRole('button', { name: 'Nhắc nộp', exact: true })).toBeVisible();
    const essay = Array.from({ length: 40 }, () => 'Con học cách lắng nghe cha mẹ mỗi ngày.').join(
      ' ',
    );

    // An external submission must reconcile both the teacher list and the student's open editor.
    const submission = await mutate<Submission>(studentContext.request, 'submitAssignment', {
      assignmentId: assignment.id,
      content: essay,
      pledge: true,
    });
    await expect(studentRow.getByRole('button', { name: 'Chấm bài', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expectSameDocument(teacherPage, teacherMarker);
    await expect(studentPage.getByRole('heading', { name: 'Bài đã nộp', exact: true })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(studentPage.getByLabel('Bài thu hoạch')).toHaveCount(0);
    await expect(studentPage.locator('p.reading-copy').filter({ hasText: essay })).toBeVisible();
    await expectSameDocument(studentPage, studentMarker);

    // Unsaved teacher grading inputs also survive an unrelated remote change.
    await studentRow.getByRole('button', { name: 'Chấm bài', exact: true }).click();
    const gradeDialog = teacherPage.getByRole('dialog').filter({
      has: teacherPage.getByRole('heading', { name: 'Bài làm của Nguyễn Văn An', exact: true }),
    });
    await gradeDialog.getByLabel('Hiểu nội dung (40 điểm)', { exact: true }).fill('38');
    const unsavedFeedback = 'Nhận xét đang soạn phải được giữ nguyên.';
    await gradeDialog
      .getByRole('textbox', { name: 'Lời khuyên & nhận xét', exact: true })
      .fill(unsavedFeedback);
    const observedDiscussion = observeState(teacherPage, (state) =>
      state.discussions.some((entry) => entry.content === 'Trao đổi mới từ học viên.'),
    );
    await mutate(studentContext.request, 'comment', {
      lessonId: lesson.id,
      content: 'Trao đổi mới từ học viên.',
    });
    await observedDiscussion;
    await expect(gradeDialog.getByLabel('Hiểu nội dung (40 điểm)', { exact: true })).toHaveValue(
      '38',
    );
    await expect(
      gradeDialog.getByRole('textbox', { name: 'Lời khuyên & nhận xét', exact: true }),
    ).toHaveValue(unsavedFeedback);

    const feedback = 'Giáo viên đã trả điểm, học viên nhận được ngay khi trang vẫn mở.';
    await mutate(teacherContext.request, 'gradeSubmission', {
      submissionId: submission.id,
      rubric: { understanding: 38, application: 36, presentation: 19 },
      feedback,
      returnGrade: true,
    });
    await expect(studentPage.getByRole('heading', { name: 'Nhận xét của giáo viên' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(studentPage.locator('.assignment-result')).toContainText('93');
    await expect(studentPage.getByText(feedback, { exact: true })).toBeVisible();
    await expectSameDocument(studentPage, studentMarker);
    await expectSameDocument(teacherPage, teacherMarker);
  } finally {
    if (classroom)
      await mutate(teacherContext.request, 'deleteClass', {
        classId: classroom.id,
        code: classroom.code,
      });
    await teacherContext.close();
    await studentContext.close();
  }
});
