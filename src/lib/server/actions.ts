import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AppState,
  Assignment,
  Attachment,
  Classroom,
  Database,
  Lesson,
  StoredFile,
  StoredUser,
  Submission,
} from '@/lib/types';
import { HttpError, publicUser } from './auth';
const id = z.string().min(1).max(120);
const text = z.string().max(50000);
const title = z.string().trim().min(2).max(200);
const time = () => new Date().toISOString();
const uid = () => randomUUID();
function needed<T>(value: T | undefined, message = 'Không tìm thấy dữ liệu.'): T {
  if (!value) throw new HttpError(404, message);
  return value;
}
export function teacherClass(db: Database, user: StoredUser, classId: string): Classroom {
  const c = needed(
    db.classes.find((x) => x.id === classId),
    'Không tìm thấy lớp học.',
  );
  if (user.role !== 'TEACHER' || c.teacherId !== user.id)
    throw new HttpError(403, 'Bạn không có quyền quản lý lớp này.');
  return c;
}
export function accessClass(db: Database, user: StoredUser, classId: string) {
  const c = needed(db.classes.find((x) => x.id === classId));
  if (c.teacherId === user.id) return c;
  if (
    !db.enrollments.some(
      (e) => e.classId === classId && e.userId === user.id && e.status === 'APPROVED',
    )
  )
    throw new HttpError(403, 'Bạn chưa được duyệt vào lớp học này.');
  return c;
}
export function accessLesson(db: Database, user: StoredUser, lessonId: string) {
  const l = needed(
    db.lessons.find((x) => x.id === lessonId),
    'Không tìm thấy bài giảng.',
  );
  accessClass(db, user, l.classId);
  if (!l.published && user.role !== 'TEACHER') throw new HttpError(403, 'Bài giảng chưa xuất bản.');
  return l;
}
export function accessFile(db: Database, user: StoredUser, fileId: string): StoredFile {
  const file = needed(
    db.files.find((f) => f.id === fileId && f.verified),
    'Không tìm thấy tệp.',
  );
  const classroom = accessClass(db, user, file.classId);
  if (file.ownerId === user.id) return file;
  if (
    db.lessons.some(
      (lesson) =>
        lesson.classId === classroom.id &&
        lesson.published &&
        (lesson.videoFileId === file.id || lesson.documents.some((d) => d.id === file.id)),
    )
  )
    return file;
  if (
    classroom.teacherId === user.id &&
    db.submissions.some(
      (submission) =>
        submission.status !== 'DRAFT' &&
        submission.attachments.some((attachment) => attachment.id === file.id) &&
        db.assignments.some(
          (assignment) =>
            assignment.id === submission.assignmentId && assignment.classId === classroom.id,
        ),
    )
  )
    return file;
  throw new HttpError(403, 'Bạn không có quyền đọc tệp này.');
}
function submissionFor(submission: Submission, user: StoredUser): Submission {
  if (user.role === 'TEACHER' || submission.status === 'GRADED') return { ...submission };
  const {
    score: _score,
    rubric: _rubric,
    feedback: _feedback,
    gradedAt: _gradedAt,
    ...rest
  } = submission;
  return { ...rest, feedback: '' };
}
function clearDraftGrade(submission: Submission) {
  delete submission.score;
  delete submission.rubric;
  delete submission.gradedAt;
  submission.feedback = '';
}
function student(user: StoredUser) {
  if (user.role !== 'STUDENT') throw new HttpError(403, 'Thao tác dành cho học viên.');
}
function active(c: Classroom) {
  if (c.status === 'ARCHIVED')
    throw new HttpError(409, 'Lớp học đã lưu trữ, không thể thay đổi nội dung.');
}
function assignment(db: Database, user: StoredUser, assignmentId: string) {
  const a = needed(db.assignments.find((x) => x.id === assignmentId));
  const c = accessClass(db, user, a.classId);
  return { a, c };
}
const attachmentSchema = z.object({
  id,
  name: z.string().max(255),
  size: z.number().nonnegative(),
  mimeType: z.string(),
  url: z.string().optional(),
});
function attachments(db: Database, user: StoredUser, classId: string, values: Attachment[]) {
  return values.map((a) => {
    const f = needed(
      db.files.find(
        (f) => f.id === a.id && f.ownerId === user.id && f.classId === classId && f.verified,
      ),
      'Tệp chưa được tải lên hoặc bạn không có quyền sử dụng.',
    );
    return {
      id: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      url: `/api/files/${f.id}`,
    };
  });
}
function newCode(db: Database) {
  let code = '';
  do {
    code = `DTQ-${randomBytes(3).toString('hex').toUpperCase()}`;
  } while (db.classes.some((c) => c.code === code));
  return code;
}
function deleteClassData(db: Database, classId: string) {
  const lessonIds = new Set(db.lessons.filter((x) => x.classId === classId).map((x) => x.id));
  const assignmentIds = new Set(
    db.assignments.filter((x) => x.classId === classId).map((x) => x.id),
  );
  db.classes = db.classes.filter((x) => x.id !== classId);
  db.enrollments = db.enrollments.filter((x) => x.classId !== classId);
  db.lessons = db.lessons.filter((x) => x.classId !== classId);
  db.assignments = db.assignments.filter((x) => x.classId !== classId);
  db.submissions = db.submissions.filter((x) => !assignmentIds.has(x.assignmentId));
  db.progress = db.progress.filter((x) => !lessonIds.has(x.lessonId));
  db.notes = db.notes.filter((x) => !lessonIds.has(x.lessonId));
  db.discussions = db.discussions.filter((x) => !lessonIds.has(x.lessonId));
  db.files = db.files.filter((x) => x.classId !== classId);
}
export function stateFor(db: Database, user: StoredUser): AppState {
  const classes = db.classes.filter(
    (c) =>
      c.teacherId === user.id ||
      db.enrollments.some((e) => e.classId === c.id && e.userId === user.id),
  );
  const classIds = new Set(classes.map((c) => c.id));
  const allowed = new Set(
    classes
      .filter(
        (c) =>
          c.teacherId === user.id ||
          db.enrollments.some(
            (e) => e.classId === c.id && e.userId === user.id && e.status === 'APPROVED',
          ),
      )
      .map((c) => c.id),
  );
  const lessons = db.lessons.filter(
    (l) => allowed.has(l.classId) && (user.role === 'TEACHER' || l.published),
  );
  const lessonIds = new Set(lessons.map((l) => l.id));
  const assignments = db.assignments.filter((a) => allowed.has(a.classId));
  const assignmentIds = new Set(assignments.map((a) => a.id));
  const enrollments = db.enrollments.filter(
    (e) =>
      (allowed.has(e.classId) && (user.role === 'TEACHER' || e.status === 'APPROVED')) ||
      (e.userId === user.id && classIds.has(e.classId)),
  );
  const people = new Set([
    user.id,
    ...classes.map((c) => c.teacherId),
    ...enrollments
      .filter((e) => e.status === 'APPROVED' || user.role === 'TEACHER')
      .map((e) => e.userId),
  ]);
  return {
    user: publicUser(user),
    users: db.users.filter((u) => people.has(u.id)).map(publicUser),
    classes,
    enrollments,
    lessons,
    assignments,
    submissions: db.submissions
      .filter(
        (s) =>
          assignmentIds.has(s.assignmentId) &&
          (s.studentId === user.id || (user.role === 'TEACHER' && s.status !== 'DRAFT')),
      )
      .map((s) => submissionFor(s, user)),
    progress: db.progress.filter(
      (p) => lessonIds.has(p.lessonId) && (p.userId === user.id || user.role === 'TEACHER'),
    ),
    notes: db.notes.filter((n) => n.userId === user.id && lessonIds.has(n.lessonId)),
    discussions: db.discussions.filter((d) => lessonIds.has(d.lessonId)),
    notifications: db.notifications.filter((n) => n.userId === user.id),
    demo: !process.env.DATABASE_URL,
    storageConfigured: !!(
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
    ),
  };
}
export function runAction(db: Database, user: StoredUser, input: Record<string, unknown>): unknown {
  const action = z.string().parse(input.action);
  switch (action) {
    case 'createClass': {
      if (user.role !== 'TEACHER') throw new HttpError(403, 'Chỉ giáo viên được tạo lớp.');
      const v = z
        .object({
          title,
          description: text.default(''),
          capacity: z.number().int().min(1).max(500).default(50),
          schedule: z.string().max(200).default(''),
          autoApprove: z.boolean().default(false),
          enrollmentOpen: z.boolean().default(true),
        })
        .parse(input);
      const c: Classroom = {
        id: uid(),
        ...v,
        code: newCode(db),
        teacherId: user.id,
        status: 'ACTIVE',
        cover: '/images/classroom.jpg',
        createdAt: time(),
      };
      db.classes.push(c);
      return c;
    }
    case 'updateClass': {
      const v = z
        .object({
          classId: id,
          title: title.optional(),
          description: text.optional(),
          capacity: z.number().int().min(1).max(500).optional(),
          schedule: z.string().max(200).optional(),
          enrollmentOpen: z.boolean().optional(),
          autoApprove: z.boolean().optional(),
          cover: z.string().max(2000).optional(),
        })
        .parse(input);
      const c = teacherClass(db, user, v.classId);
      if (
        v.capacity !== undefined &&
        v.capacity <
          db.enrollments.filter((e) => e.classId === c.id && e.status === 'APPROVED').length
      )
        throw new HttpError(400, 'Sĩ số không được nhỏ hơn số học viên hiện tại.');
      const { classId: _classId, ...changes } = v;
      Object.assign(c, changes);
      return c;
    }
    case 'archiveClass': {
      const v = z.object({ classId: id, archived: z.boolean() }).parse(input);
      const c = teacherClass(db, user, v.classId);
      c.status = v.archived ? 'ARCHIVED' : 'ACTIVE';
      return c;
    }
    case 'regenerateCode': {
      const c = teacherClass(db, user, id.parse(input.classId));
      c.code = newCode(db);
      return c;
    }
    case 'deleteClass': {
      const v = z.object({ classId: id, code: z.string() }).parse(input);
      const c = teacherClass(db, user, v.classId);
      if (v.code !== c.code) throw new HttpError(400, 'Mã xác nhận không khớp mã lớp học.');
      deleteClassData(db, c.id);
      return null;
    }
    case 'previewClass': {
      const code = z.string().trim().toUpperCase().parse(input.code);
      const c = needed(
        db.classes.find((c) => c.code === code && c.enrollmentOpen && c.status === 'ACTIVE'),
        'Mã lớp không tồn tại hoặc lớp đã đóng đăng ký.',
      );
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        code: c.code,
        schedule: c.schedule,
        teacher: db.users.find((u) => u.id === c.teacherId)?.name,
        autoApprove: c.autoApprove,
      };
    }
    case 'joinClass': {
      student(user);
      const code = z.string().trim().toUpperCase().parse(input.code);
      const c = needed(
        db.classes.find((c) => c.code === code),
        'Không tìm thấy mã lớp.',
      );
      active(c);
      if (!c.enrollmentOpen) throw new HttpError(409, 'Lớp học đã đóng đăng ký.');
      if (db.enrollments.some((e) => e.classId === c.id && e.userId === user.id))
        throw new HttpError(409, 'Bạn đã tham gia hoặc đang chờ duyệt vào lớp này.');
      if (
        db.enrollments.filter((e) => e.classId === c.id && e.status === 'APPROVED').length >=
        c.capacity
      )
        throw new HttpError(409, 'Lớp đã đủ sĩ số.');
      const e = {
        id: uid(),
        classId: c.id,
        userId: user.id,
        status: c.autoApprove ? ('APPROVED' as const) : ('PENDING' as const),
        group: 1,
        joinedAt: time(),
      };
      db.enrollments.push(e);
      return e;
    }
    case 'cancelEnrollment': {
      student(user);
      const classId = id.parse(input.classId);
      const e = needed(db.enrollments.find((e) => e.classId === classId && e.userId === user.id));
      if (e.status !== 'PENDING')
        throw new HttpError(400, 'Chỉ có thể hủy yêu cầu đang chờ duyệt.');
      db.enrollments = db.enrollments.filter((x) => x.id !== e.id);
      return null;
    }
    case 'approveEnrollment':
    case 'rejectEnrollment': {
      const e = needed(db.enrollments.find((e) => e.id === input.enrollmentId));
      const c = teacherClass(db, user, e.classId);
      if (e.status !== 'PENDING') throw new HttpError(409, 'Yêu cầu này đã được xử lý.');
      if (action === 'rejectEnrollment') {
        db.enrollments = db.enrollments.filter((x) => x.id !== e.id);
        return null;
      }
      if (
        db.enrollments.filter((e) => e.classId === c.id && e.status === 'APPROVED').length >=
        c.capacity
      )
        throw new HttpError(409, 'Lớp đã đủ sĩ số.');
      e.status = 'APPROVED';
      return e;
    }
    case 'saveLesson': {
      const v = z
        .object({
          id: id.optional(),
          lessonId: id.optional(),
          classId: id,
          title,
          chapter: z.string().max(200).default('Nội dung khóa học'),
          order: z.number().int().min(1).max(10000),
          description: text.default(''),
          videoType: z.enum(['YOUTUBE', 'UPLOAD']).default('YOUTUBE'),
          videoUrl: z.string().max(2000).default(''),
          videoFileId: id.optional(),
          duration: z.string().max(30).default(''),
          published: z.boolean().default(false),
          timestamps: z
            .array(z.object({ time: z.string().max(20), title: z.string().max(200) }))
            .max(100)
            .default([]),
          documents: z.array(attachmentSchema).max(20).default([]),
        })
        .parse(input);
      const c = teacherClass(db, user, v.classId);
      active(c);
      let videoUrl = v.videoType === 'UPLOAD' ? '' : v.videoUrl;
      if (v.videoType === 'YOUTUBE' && videoUrl) {
        try {
          const u = new URL(videoUrl);
          if (!['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(u.hostname))
            throw new Error();
          const vid =
            u.hostname === 'youtu.be'
              ? u.pathname.slice(1)
              : u.searchParams.get('v') || u.pathname.split('/').pop();
          if (!vid || !/^[\w-]{11}$/.test(vid)) throw new Error();
          videoUrl = `https://www.youtube.com/watch?v=${vid}`;
        } catch {
          throw new HttpError(400, 'Đường dẫn YouTube không hợp lệ.');
        }
      }
      if (v.videoType === 'UPLOAD' && v.videoFileId) {
        const f = needed(
          db.files.find(
            (f) =>
              f.id === v.videoFileId &&
              f.ownerId === user.id &&
              f.classId === c.id &&
              f.verified &&
              f.mimeType.startsWith('video/'),
          ),
          'Video chưa được xác thực.',
        );
        videoUrl = `/api/files/${f.id}`;
      }
      if (v.published && !videoUrl)
        throw new HttpError(400, 'Vui lòng thêm video trước khi xuất bản bài giảng.');
      const docs = attachments(db, user, c.id, v.documents);
      const existingId = v.id || v.lessonId;
      const existing = existingId
        ? needed(db.lessons.find((l) => l.id === existingId && l.classId === c.id))
        : undefined;
      const { lessonId: _lessonId, id: _id, ...fields } = v;
      const l: Lesson = {
        id: existing?.id || uid(),
        ...fields,
        videoFileId: v.videoType === 'UPLOAD' ? v.videoFileId : undefined,
        videoUrl,
        documents: docs,
        createdAt: existing?.createdAt || time(),
      };
      if (existing) Object.assign(existing, l);
      else db.lessons.push(l);
      return l;
    }
    case 'deleteLesson': {
      const l = needed(db.lessons.find((l) => l.id === input.lessonId));
      teacherClass(db, user, l.classId);
      db.lessons = db.lessons.filter((x) => x.id !== l.id);
      db.progress = db.progress.filter((x) => x.lessonId !== l.id);
      db.notes = db.notes.filter((x) => x.lessonId !== l.id);
      db.discussions = db.discussions.filter((x) => x.lessonId !== l.id);
      db.assignments.forEach((a) => {
        if (a.lessonId === l.id) delete a.lessonId;
      });
      return null;
    }
    case 'completeLesson':
    case 'bookmarkLesson': {
      const l = accessLesson(db, user, id.parse(input.lessonId));
      student(user);
      let p = db.progress.find((p) => p.userId === user.id && p.lessonId === l.id);
      if (!p) {
        p = { id: uid(), userId: user.id, lessonId: l.id, completed: false, bookmarked: false };
        db.progress.push(p);
      }
      if (action === 'completeLesson')
        p.completed = z.boolean().default(true).parse(input.completed);
      else p.bookmarked = z.boolean().parse(input.bookmarked);
      return p;
    }
    case 'saveNote': {
      const v = z.object({ lessonId: id, content: text }).parse(input);
      accessLesson(db, user, v.lessonId);
      let n = db.notes.find((n) => n.userId === user.id && n.lessonId === v.lessonId);
      if (!n) {
        n = {
          id: uid(),
          userId: user.id,
          lessonId: v.lessonId,
          content: v.content,
          updatedAt: time(),
        };
        db.notes.push(n);
      } else Object.assign(n, { content: v.content, updatedAt: time() });
      return n;
    }
    case 'comment': {
      const v = z
        .object({ lessonId: id, content: z.string().trim().min(1).max(5000) })
        .parse(input);
      accessLesson(db, user, v.lessonId);
      const d = { id: uid(), userId: user.id, ...v, createdAt: time() };
      db.discussions.push(d);
      return d;
    }
    case 'createAssignment': {
      const v = z
        .object({
          classId: id,
          lessonId: id.optional(),
          title,
          instructions: text,
          dueAt: z.string().datetime(),
          allowLate: z.boolean().default(false),
          allowResubmit: z.boolean().default(true),
          maxAttempts: z.number().int().min(1).max(5).default(2),
          minWords: z.number().int().min(0).max(10000).default(300),
          maxWords: z.number().int().min(1).max(20000).default(500),
        })
        .parse(input);
      active(teacherClass(db, user, v.classId));
      if (v.lessonId && !db.lessons.some((l) => l.id === v.lessonId && l.classId === v.classId))
        throw new HttpError(400, 'Bài giảng không thuộc lớp.');
      if (v.maxWords < v.minWords) throw new HttpError(400, 'Giới hạn số từ không hợp lệ.');
      const a: Assignment = { id: uid(), ...v, createdAt: time() };
      db.assignments.push(a);
      return a;
    }
    case 'saveSubmission':
    case 'submitAssignment': {
      student(user);
      const v = z
        .object({
          assignmentId: id,
          content: text.default(''),
          link: z.string().max(2000).default(''),
          attachments: z.array(attachmentSchema).max(10).default([]),
          pledge: z.boolean().optional(),
        })
        .parse(input);
      const { a, c } = assignment(db, user, v.assignmentId);
      active(c);
      if (!a.allowLate && Date.now() > Date.parse(a.dueAt))
        throw new HttpError(409, 'Đã hết hạn nộp bài.');
      if (v.link) {
        try {
          if (!['https:', 'http:'].includes(new URL(v.link).protocol)) throw new Error();
        } catch {
          throw new HttpError(400, 'Liên kết phải bắt đầu bằng http:// hoặc https://.');
        }
      }
      const files = attachments(db, user, c.id, v.attachments);
      let s = db.submissions.find((s) => s.assignmentId === a.id && s.studentId === user.id);
      if (s && s.status !== 'DRAFT')
        throw new HttpError(409, 'Vui lòng thu hồi bài trước khi chỉnh sửa hoặc nộp lại.');
      if (action === 'submitAssignment') {
        if (!v.pledge) throw new HttpError(400, 'Vui lòng xác nhận bài làm của chính bạn.');
        const words = v.content.trim() ? v.content.trim().split(/\s+/u).length : 0;
        if (!files.length && (words < a.minWords || words > a.maxWords))
          throw new HttpError(
            400,
            `Bài viết cần từ ${a.minWords} đến ${a.maxWords} từ, hoặc đính kèm tệp bài làm.`,
          );
      }
      if (!s) {
        s = {
          id: uid(),
          assignmentId: a.id,
          studentId: user.id,
          content: '',
          link: '',
          attachments: [],
          status: 'DRAFT',
          attempt: 0,
          feedback: '',
        };
        db.submissions.push(s);
      }
      clearDraftGrade(s);
      Object.assign(s, { content: v.content, link: v.link, attachments: files });
      if (action === 'submitAssignment') {
        if (s.attempt >= a.maxAttempts) throw new HttpError(409, 'Bạn đã hết số lượt nộp bài.');
        s.status = 'SUBMITTED';
        s.attempt++;
        s.submittedAt = time();
      }
      return submissionFor(s, user);
    }
    case 'withdrawSubmission': {
      student(user);
      const { a } = assignment(db, user, id.parse(input.assignmentId));
      const s = needed(
        db.submissions.find((s) => s.assignmentId === a.id && s.studentId === user.id),
      );
      if (s.status === 'GRADED') throw new HttpError(409, 'Bài đã chấm không thể thu hồi.');
      if (Date.now() > Date.parse(a.dueAt)) throw new HttpError(409, 'Đã hết hạn thu hồi bài làm.');
      if (!a.allowResubmit || s.attempt >= a.maxAttempts)
        throw new HttpError(409, 'Bài tập không cho phép nộp lại hoặc đã hết lượt.');
      s.status = 'DRAFT';
      clearDraftGrade(s);
      return submissionFor(s, user);
    }
    case 'gradeSubmission': {
      const v = z
        .object({
          submissionId: id,
          rubric: z.object({
            understanding: z.number().min(0).max(40),
            application: z.number().min(0).max(40),
            presentation: z.number().min(0).max(20),
          }),
          feedback: text.default(''),
          returnGrade: z.boolean().default(false),
        })
        .parse(input);
      const s = needed(db.submissions.find((s) => s.id === v.submissionId));
      const a = needed(db.assignments.find((a) => a.id === s.assignmentId));
      teacherClass(db, user, a.classId);
      if (s.status === 'DRAFT') throw new HttpError(400, 'Học viên chưa nộp bài.');
      if (s.status === 'GRADED' && !v.returnGrade)
        throw new HttpError(409, 'Bài đã trả điểm cần xác nhận trả lại điểm mới khi chỉnh sửa.');
      s.rubric = v.rubric;
      s.score = Object.values(v.rubric).reduce((a, b) => a + b, 0);
      s.feedback = v.feedback;
      if (v.returnGrade) {
        s.status = 'GRADED';
        s.gradedAt = time();
        db.notifications.push({
          id: uid(),
          userId: s.studentId,
          content: `Bài “${a.title}” đã được chấm: ${s.score}/100.`,
          createdAt: time(),
          read: false,
        });
      }
      return s;
    }
    case 'remindStudents': {
      const a = needed(db.assignments.find((a) => a.id === input.assignmentId));
      teacherClass(db, user, a.classId);
      const missing = db.enrollments.filter(
        (e) =>
          e.classId === a.classId &&
          e.status === 'APPROVED' &&
          (!input.userId || e.userId === input.userId) &&
          !db.submissions.some(
            (s) => s.assignmentId === a.id && s.studentId === e.userId && s.status !== 'DRAFT',
          ),
      );
      for (const e of missing)
        db.notifications.push({
          id: uid(),
          userId: e.userId,
          content: `Nhắc nộp bài: ${a.title}. Hạn nộp ${new Date(a.dueAt).toLocaleString('vi-VN')}.`,
          createdAt: time(),
          read: false,
        });
      return { count: missing.length };
    }
    case 'markNotificationsRead': {
      db.notifications.filter((n) => n.userId === user.id).forEach((n) => (n.read = true));
      return null;
    }
    default:
      throw new HttpError(400, 'Thao tác không được hỗ trợ.');
  }
}
