import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AppState,
  Assignment,
  Attachment,
  Classroom,
  Database,
  DriveUpload,
  Lesson,
  StoredFile,
  StoredUser,
  Submission,
} from '@/lib/types';
import { accountEnabled, HttpError, needsPasswordChange, publicUser } from './auth';
import { acceptsWordCount, wordRequirement } from '../assignment-policy';
import type { TableKey } from './repository';
import { assignedTeacherIds, classTeacherNames, managesClass } from '../class-teachers';
const id = z.string().min(1).max(120);
const text = z.string().max(50000);
const commentContent = z.string().trim().min(1, 'Vui lòng nhập nội dung thảo luận.').max(5000);
const title = z.string().trim().min(2).max(200);
const time = () => new Date().toISOString();
const REMIND_COOLDOWN_MS = 3 * 3600 * 1000;
const REMINDER_PREFIX = 'Nhắc nộp bài:';
const uid = () => randomUUID();
const assignmentSchema = z.object({
  classId: id,
  lessonId: id.nullable().optional(),
  title,
  instructions: text,
  dueAt: z.string().datetime(),
  allowLate: z.boolean().default(false),
  allowResubmit: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  minWords: z.number().int().min(0).max(20000).default(150),
  maxWords: z.number().int().min(1).max(20000).nullable().default(null),
});
function assignmentValues(db: Database, input: unknown) {
  const values = assignmentSchema.parse(input);
  if (
    values.lessonId &&
    !db.lessons.some((l) => l.id === values.lessonId && l.classId === values.classId)
  )
    throw new HttpError(400, 'Bài giảng không thuộc lớp.');
  if (values.maxWords !== null && values.maxWords < values.minWords)
    throw new HttpError(400, 'Số từ tối đa phải lớn hơn hoặc bằng số từ tối thiểu.');
  return values;
}
function needed<T>(value: T | undefined, message = 'Không tìm thấy dữ liệu.'): T {
  if (!value) throw new HttpError(404, message);
  return value;
}
export function teacherClass(db: Database, user: StoredUser, classId: string): Classroom {
  const c = needed(
    db.classes.find((x) => x.id === classId),
    'Không tìm thấy lớp học.',
  );
  if (!managesClass(c, user)) throw new HttpError(403, 'Bạn không có quyền quản lý lớp này.');
  return c;
}
export function ownerClass(db: Database, user: StoredUser, classId: string): Classroom {
  const c = teacherClass(db, user, classId);
  if (c.teacherId !== user.id)
    throw new HttpError(
      403,
      'Chỉ người quản lý lớp được thay đổi cài đặt hoặc phân công giáo viên.',
    );
  return c;
}

export function classTeacherOptions(db: Database, user: StoredUser, classId: string) {
  ownerClass(db, user, classId);
  return db.users
    .filter((candidate) => candidate.role === 'TEACHER')
    .map((candidate) => ({ ...publicUser(candidate, false), available: accountEnabled(candidate) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
export function accessClass(db: Database, user: StoredUser, classId: string) {
  const c = needed(db.classes.find((x) => x.id === classId));
  if (managesClass(c, user)) return c;
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
  const c = accessClass(db, user, l.classId);
  if (!l.published && !managesClass(c, user)) throw new HttpError(403, 'Bài giảng chưa xuất bản.');
  return l;
}
/** Teacher-owned files (lesson videos/materials), as opposed to a learner's private submission files. */
export function isClassMaterial(db: Database, job: DriveUpload) {
  const owner = db.users.find((u) => u.id === job.ownerId);
  const classroom = db.classes.find((c) => c.id === job.classId);
  return !!owner && !!classroom && managesClass(classroom, owner);
}
/** Private Drive files (lesson materials, assignment attachments incl. videos): same rules as accessFile. */
export function accessDriveDocument(db: Database, user: StoredUser, jobId: string): DriveUpload {
  const job = needed(
    db.driveUploads.find((u) => u.id === jobId && u.status === 'COMPLETED' && u.driveFileId),
    'Không tìm thấy tệp.',
  );
  // Administrators can open any stored file, e.g. to moderate a submission.
  if (user.isAdmin) return job;
  const classroom = accessClass(db, user, job.classId);
  if (job.ownerId === user.id) return job;
  if (
    db.lessons.some(
      (lesson) =>
        lesson.classId === classroom.id &&
        (lesson.published || managesClass(classroom, user)) &&
        lesson.documents.some((d) => d.id === job.id),
    )
  )
    return job;
  if (
    managesClass(classroom, user) &&
    db.submissions.some(
      (submission) =>
        submission.status !== 'DRAFT' &&
        submission.attachments.some((attachment) => attachment.id === job.id) &&
        db.assignments.some(
          (assignment) =>
            assignment.id === submission.assignmentId && assignment.classId === classroom.id,
        ),
    )
  )
    return job;
  throw new HttpError(403, 'Bạn không có quyền đọc tệp này.');
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
        (lesson.published || managesClass(classroom, user)) &&
        (lesson.videoFileId === file.id || lesson.documents.some((d) => d.id === file.id)),
    )
  )
    return file;
  if (
    managesClass(classroom, user) &&
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
function submissionFor(submission: Submission, canGrade = false): Submission {
  if (canGrade || submission.status === 'GRADED') return { ...submission };
  const {
    score: _score,
    rubric: _rubric,
    feedback: _feedback,
    gradedAt: _gradedAt,
    gradeRevision: _gradeRevision,
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
function learnerClass(db: Database, user: StoredUser, classId: string) {
  const c = accessClass(db, user, classId);
  if (
    managesClass(c, user) ||
    !db.enrollments.some(
      (e) => e.classId === classId && e.userId === user.id && e.status === 'APPROVED',
    )
  )
    throw new HttpError(403, 'Thao tác dành cho học viên đã được duyệt trong lớp này.');
  return c;
}
function active(c: Classroom) {
  if (c.status === 'ARCHIVED')
    throw new HttpError(409, 'Lớp học đã lưu trữ, không thể thay đổi nội dung.');
}
function assignment(db: Database, user: StoredUser, assignmentId: string) {
  const a = needed(db.assignments.find((x) => x.id === assignmentId));
  const c = accessClass(db, user, a.classId);
  if (
    a.lessonId &&
    !managesClass(c, user) &&
    !db.lessons.some((l) => l.id === a.lessonId && l.published)
  )
    throw new HttpError(403, 'Bài tập chưa được công bố.');
  return { a, c };
}
const attachmentSchema = z.object({
  id,
  name: z.string().max(255),
  size: z.number().nonnegative(),
  mimeType: z.string(),
  url: z.string().optional(),
});
function attachments(
  db: Database,
  user: StoredUser,
  classId: string,
  values: Attachment[],
  existingFileIds: string[] = [],
) {
  return values.map((a) => {
    // Files live in Google Drive; the attachment id is the DriveUpload id.
    const drive = db.driveUploads.find((u) => u.id === a.id);
    if (drive) {
      if (
        drive.status !== 'COMPLETED' ||
        drive.classId !== classId ||
        (drive.ownerId !== user.id && !existingFileIds.includes(drive.id))
      )
        throw new HttpError(404, 'Tệp chưa được tải lên hoặc bạn không có quyền sử dụng.');
      return {
        id: drive.id,
        name: drive.name,
        size: drive.size,
        mimeType: drive.mimeType,
        url: `/api/drive/files/${drive.id}/download`,
      };
    }
    const f = needed(
      db.files.find(
        (f) =>
          f.id === a.id &&
          (f.ownerId === user.id || existingFileIds.includes(f.id)) &&
          f.classId === classId &&
          f.verified,
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
    code = `LH-${randomBytes(6).toString('hex').toUpperCase()}`;
  } while (db.classes.some((c) => c.code === code));
  return code;
}
/** Queue a Drive file for deletion; the network call cannot run inside a database transaction. */
function trashDriveFile(db: Database, driveFileId: string | undefined) {
  if (driveFileId && !db.driveTrash.some((t) => t.id === driveFileId))
    db.driveTrash.push({ id: driveFileId, createdAt: time() });
}
export function driveJobUnused(db: Database, job: DriveUpload) {
  return (
    !db.lessons.some(
      (l) =>
        (!!job.driveFileId && l.driveFileId === job.driveFileId) ||
        l.documents.some((d) => d.id === job.id),
    ) && !db.submissions.some((s) => s.attachments.some((a) => a.id === job.id))
  );
}
/** Drops the records of Drive files whose owner (lesson/assignment) was deleted and queues the files. */
function discardDriveJobs(db: Database, ids: Set<string>) {
  const gone = db.driveUploads.filter((u) => ids.has(u.id) && driveJobUnused(db, u));
  gone.forEach((u) => trashDriveFile(db, u.driveFileId));
  db.driveUploads = db.driveUploads.filter((u) => !gone.includes(u));
}
function deleteClassData(db: Database, classId: string) {
  db.driveUploads
    .filter((u) => u.classId === classId)
    .forEach((u) => trashDriveFile(db, u.driveFileId));
  const lessonIds = new Set(db.lessons.filter((x) => x.classId === classId).map((x) => x.id));
  const assignmentIds = new Set(
    db.assignments.filter((x) => x.classId === classId).map((x) => x.id),
  );
  db.classes = db.classes.filter((x) => x.id !== classId);
  db.enrollments = db.enrollments.filter((x) => x.classId !== classId);
  db.lessons = db.lessons.filter((x) => x.classId !== classId);
  db.assignments = db.assignments.filter((x) => x.classId !== classId);
  db.submissions = db.submissions.filter((x) => !assignmentIds.has(x.assignmentId));
  db.notifications = db.notifications.filter(
    (n) => !n.assignmentId || !assignmentIds.has(n.assignmentId),
  );
  db.progress = db.progress.filter((x) => !lessonIds.has(x.lessonId));
  db.notes = db.notes.filter((x) => !lessonIds.has(x.lessonId));
  db.discussions = db.discussions.filter((x) => !lessonIds.has(x.lessonId));
  db.files = db.files.filter((x) => x.classId !== classId);
  db.driveUploads = db.driveUploads.filter((x) => x.classId !== classId);
}
function announceAssignment(db: Database, a: Assignment) {
  // Once per assignment: unpublishing and republishing a lesson must not notify learners again.
  if (a.announcedAt) return;
  a.announcedAt = time();
  for (const enrollment of db.enrollments.filter(
    (e) => e.classId === a.classId && e.status === 'APPROVED',
  ))
    db.notifications.push({
      id: uid(),
      userId: enrollment.userId,
      content: `Lớp có bài tập mới: ${a.title}.`,
      createdAt: time(),
      read: false,
      assignmentId: a.id,
    });
}
export function stateFor(db: Database, user: StoredUser): AppState {
  if (needsPasswordChange(user))
    return {
      user: publicUser(user),
      users: [publicUser(user)],
      classes: [],
      enrollments: [],
      lessons: [],
      assignments: [],
      submissions: [],
      progress: [],
      notes: [],
      discussions: [],
      notifications: [],
      demo: !process.env.DATABASE_URL,
      storageConfigured: false,
    };
  const classes = db.classes.filter(
    (c) =>
      managesClass(c, user) ||
      db.enrollments.some(
        (e) => e.classId === c.id && e.userId === user.id && e.status !== 'REMOVED',
      ),
  );
  const classIds = new Set(classes.map((c) => c.id));
  const managed = new Set(classes.filter((c) => managesClass(c, user)).map((c) => c.id));
  const allowed = new Set(
    classes
      .filter(
        (c) =>
          managed.has(c.id) ||
          db.enrollments.some(
            (e) => e.classId === c.id && e.userId === user.id && e.status === 'APPROVED',
          ),
      )
      .map((c) => c.id),
  );
  const lessons = db.lessons.filter(
    (l) => allowed.has(l.classId) && (managed.has(l.classId) || l.published),
  );
  const lessonIds = new Set(lessons.map((l) => l.id));
  const assignments = db.assignments.filter(
    (a) =>
      allowed.has(a.classId) &&
      (managed.has(a.classId) || !a.lessonId || lessons.some((l) => l.id === a.lessonId)),
  );
  const assignmentIds = new Set(assignments.map((a) => a.id));
  const enrollments = db.enrollments.filter(
    (e) =>
      (allowed.has(e.classId) && (managed.has(e.classId) || e.status === 'APPROVED')) ||
      (e.userId === user.id && classIds.has(e.classId)),
  );
  const people = new Set([
    user.id,
    ...classes.map((c) => c.teacherId),
    ...classes.flatMap(assignedTeacherIds),
    ...enrollments
      .filter((e) => e.status === 'APPROVED' || managed.has(e.classId))
      .map((e) => e.userId),
  ]);
  const contactIds = new Set([
    user.id,
    ...db.enrollments.filter((e) => managed.has(e.classId)).map((e) => e.userId),
    ...classes.filter((c) => managed.has(c.id)).flatMap(assignedTeacherIds),
  ]);
  return {
    user: publicUser(user),
    users: db.users
      .filter((u) => people.has(u.id))
      .map((u) => {
        const info = publicUser(u, u.id === user.id);
        return u.id === user.id
          ? info
          : {
              ...info,
              email: contactIds.has(u.id) ? info.email : '',
              isAdmin: undefined,
              mustChangePassword: undefined,
            };
      }),
    classes,
    enrollments,
    lessons,
    assignments,
    submissions: db.submissions
      .filter(
        (s) =>
          assignmentIds.has(s.assignmentId) &&
          (s.studentId === user.id ||
            (s.status !== 'DRAFT' &&
              assignments.some((a) => a.id === s.assignmentId && managed.has(a.classId)))),
      )
      .map((s) =>
        submissionFor(
          s,
          s.studentId !== user.id &&
            assignments.some((a) => a.id === s.assignmentId && managed.has(a.classId)),
        ),
      ),
    progress: db.progress.filter(
      (p) =>
        lessonIds.has(p.lessonId) &&
        (p.userId === user.id ||
          lessons.some((l) => l.id === p.lessonId && managed.has(l.classId))),
    ),
    notes: db.notes.filter((n) => n.userId === user.id && lessonIds.has(n.lessonId)),
    discussions: db.discussions.filter((d) => lessonIds.has(d.lessonId)),
    notifications: db.notifications.filter((n) => n.userId === user.id),
    demo: !process.env.DATABASE_URL,
    // Every upload goes to Google Drive, so uploads are available once an administrator connected it.
    storageConfigured: !!(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      db.driveConnections.some((c) => c.status === 'ACTIVE')
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
          contentAuthor: z.string().trim().max(200).default(''),
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
        teacherIds: [],
        revision: uid(),
        status: 'ACTIVE',
        cover: '',
        createdAt: time(),
      };
      db.classes.push(c);
      return c;
    }
    case 'updateClass': {
      const v = z
        .object({
          classId: id,
          expectedRevision: z.string().max(120).optional(),
          title: title.optional(),
          description: text.optional(),
          contentAuthor: z.string().trim().max(200).optional(),
          capacity: z.number().int().min(1).max(500).optional(),
          schedule: z.string().max(200).optional(),
          enrollmentOpen: z.boolean().optional(),
          autoApprove: z.boolean().optional(),
          cover: z.string().max(2000).optional(),
        })
        .parse(input);
      const c = ownerClass(db, user, v.classId);
      if (v.expectedRevision !== undefined && v.expectedRevision !== (c.revision || ''))
        throw new HttpError(
          409,
          'Cài đặt lớp đã thay đổi ở phiên khác. Hãy sao chép nội dung và mở lại.',
        );
      if (
        v.capacity !== undefined &&
        v.capacity <
          db.enrollments.filter((e) => e.classId === c.id && e.status === 'APPROVED').length
      )
        throw new HttpError(400, 'Sĩ số không được nhỏ hơn số học viên hiện tại.');
      const { classId: _classId, expectedRevision: _expectedRevision, ...changes } = v;
      Object.assign(c, changes, { revision: uid() });
      return c;
    }
    case 'setClassTeachers': {
      const v = z
        .object({
          classId: id,
          teacherIds: z.array(id).max(100),
          expectedTeacherIds: z.array(id).max(100),
        })
        .parse(input);
      const c = ownerClass(db, user, v.classId);
      const current = assignedTeacherIds(c);
      const sameIds = (a: string[], b: string[]) =>
        a.length === b.length &&
        [...a].sort().every((value, index) => value === [...b].sort()[index]);
      if (!sameIds(current, v.expectedTeacherIds))
        throw new HttpError(409, 'Danh sách giáo viên đã thay đổi. Đóng và mở lại để cập nhật.');
      if (new Set(v.teacherIds).size !== v.teacherIds.length)
        throw new HttpError(400, 'Danh sách giáo viên có tài khoản trùng lặp.');
      for (const teacherId of v.teacherIds) {
        const teacher = db.users.find((candidate) => candidate.id === teacherId);
        if (
          !teacher ||
          teacher.role !== 'TEACHER' ||
          (!accountEnabled(teacher) && !current.includes(teacherId))
        )
          throw new HttpError(400, 'Chỉ có thể phân công tài khoản giáo viên đang hoạt động.');
        if (
          db.enrollments.some(
            (e) => e.classId === c.id && e.userId === teacherId && e.status !== 'REMOVED',
          )
        )
          throw new HttpError(
            409,
            'Người đang là học viên của lớp cần rời lớp trước khi được phân công giảng dạy.',
          );
      }
      c.teacherIds = v.teacherIds;
      c.revision = uid();
      return c;
    }
    case 'archiveClass': {
      const v = z.object({ classId: id, archived: z.boolean() }).parse(input);
      const c = ownerClass(db, user, v.classId);
      c.status = v.archived ? 'ARCHIVED' : 'ACTIVE';
      c.revision = uid();
      return c;
    }
    case 'regenerateCode': {
      const c = ownerClass(db, user, id.parse(input.classId));
      c.code = newCode(db);
      c.revision = uid();
      return c;
    }
    case 'deleteClass': {
      const v = z.object({ classId: id, code: z.string() }).parse(input);
      const c = ownerClass(db, user, v.classId);
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
        teacher: classTeacherNames(c, db.users),
        autoApprove: c.autoApprove,
      };
    }
    case 'joinClass': {
      const code = z.string().trim().toUpperCase().parse(input.code);
      const c = needed(
        db.classes.find((c) => c.code === code),
        'Không tìm thấy mã lớp.',
      );
      active(c);
      if (managesClass(c, user)) throw new HttpError(409, 'Bạn đang phụ trách lớp này.');
      if (!c.enrollmentOpen) throw new HttpError(409, 'Lớp học đã đóng đăng ký.');
      const previous = db.enrollments.find((e) => e.classId === c.id && e.userId === user.id);
      if (previous && previous.status !== 'REMOVED')
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
      if (previous) {
        Object.assign(previous, { status: e.status, joinedAt: e.joinedAt });
        return previous;
      }
      db.enrollments.push(e);
      return e;
    }
    case 'cancelEnrollment': {
      const classId = id.parse(input.classId);
      const e = needed(db.enrollments.find((e) => e.classId === classId && e.userId === user.id));
      if (e.status !== 'PENDING')
        throw new HttpError(400, 'Chỉ có thể hủy yêu cầu đang chờ duyệt.');
      db.enrollments = db.enrollments.filter((x) => x.id !== e.id);
      return null;
    }
    case 'leaveClass':
    case 'removeEnrollment': {
      const e =
        action === 'leaveClass'
          ? needed(db.enrollments.find((x) => x.classId === input.classId && x.userId === user.id))
          : needed(db.enrollments.find((x) => x.id === input.enrollmentId));
      const c =
        action === 'leaveClass'
          ? learnerClass(db, user, e.classId)
          : teacherClass(db, user, e.classId);
      active(c);
      if (e.status !== 'APPROVED') throw new HttpError(409, 'Học viên không còn trong lớp.');
      e.status = 'REMOVED';
      return null;
    }
    case 'setEnrollmentGroup': {
      const v = z.object({ enrollmentId: id, group: z.number().int().min(1).max(4) }).parse(input);
      const e = needed(db.enrollments.find((x) => x.id === v.enrollmentId));
      active(teacherClass(db, user, e.classId));
      if (e.status !== 'APPROVED') throw new HttpError(409, 'Học viên không còn trong lớp.');
      e.group = v.group;
      return e;
    }
    case 'approveEnrollment':
    case 'rejectEnrollment': {
      const e = needed(db.enrollments.find((e) => e.id === input.enrollmentId));
      const c = teacherClass(db, user, e.classId);
      active(c);
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
          videoType: z.enum(['YOUTUBE', 'UPLOAD', 'DRIVE']).default('YOUTUBE'),
          videoUrl: z.string().max(2000).default(''),
          videoFileId: id.optional(),
          driveFileId: z
            .string()
            .regex(/^[\w-]{10,120}$/)
            .optional(),
          duration: z.string().max(30).default(''),
          published: z.boolean().default(false),
          expectedRevision: z.string().max(120).optional(),
          timestamps: z
            .array(
              z.object({
                time: z.string().regex(/^\d{1,3}:[0-5]\d$/, 'Mốc thời gian không hợp lệ.'),
                title: z.string().trim().min(1).max(200),
              }),
            )
            .max(100)
            .default([]),
          documents: z.array(attachmentSchema).max(20).default([]),
        })
        .parse(input);
      const c = teacherClass(db, user, v.classId);
      active(c);
      const existingId = v.id || v.lessonId;
      const existing = existingId
        ? needed(db.lessons.find((l) => l.id === existingId && l.classId === c.id))
        : undefined;
      const wasPublished = existing?.published === true;
      if (
        existing &&
        v.expectedRevision !== undefined &&
        v.expectedRevision !== (existing.revision || '')
      )
        throw new HttpError(
          409,
          'Bài giảng đã được sửa ở phiên khác. Hãy sao chép thay đổi và mở lại.',
        );
      let videoUrl = v.videoType === 'YOUTUBE' ? v.videoUrl : '';
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
              (f.ownerId === user.id || f.id === existing?.videoFileId) &&
              f.classId === c.id &&
              f.verified &&
              f.mimeType.startsWith('video/'),
          ),
          'Video chưa được xác thực.',
        );
        videoUrl = `/api/files/${f.id}`;
      }
      let driveUpload: DriveUpload | undefined;
      if (v.videoType === 'DRIVE' && v.driveFileId) {
        driveUpload = needed(
          db.driveUploads.find(
            (u) =>
              u.driveFileId === v.driveFileId &&
              u.classId === c.id &&
              u.kind === 'video' &&
              u.status === 'COMPLETED' &&
              // A learner's private submission video can never become the lesson video.
              isClassMaterial(db, u),
          ),
          'Video Google Drive chưa được tải lên hoàn tất hoặc không thuộc lớp này.',
        );
        videoUrl = `https://drive.google.com/file/d/${driveUpload.driveFileId}/preview`;
      }
      const docs = attachments(
        db,
        user,
        c.id,
        v.documents,
        existing?.documents.map((d) => d.id),
      );
      if (v.published && !videoUrl && !v.description.trim() && !docs.length)
        throw new HttpError(
          400,
          'Vui lòng thêm video, nội dung hoặc tài liệu trước khi xuất bản bài giảng.',
        );
      const { lessonId: _lessonId, id: _id, expectedRevision: _expectedRevision, ...fields } = v;
      const l: Lesson = {
        id: existing?.id || uid(),
        ...fields,
        videoFileId: v.videoType === 'UPLOAD' ? v.videoFileId : undefined,
        driveFileId: driveUpload?.driveFileId,
        videoUrl,
        documents: docs,
        revision: uid(),
        createdAt: existing?.createdAt || time(),
      };
      if (existing) Object.assign(existing, l);
      else db.lessons.push(l);
      for (const u of db.driveUploads)
        if (u.lessonId === l.id && u !== driveUpload) delete u.lessonId;
      if (driveUpload) driveUpload.lessonId = l.id;
      if (l.published && !wasPublished)
        db.assignments.filter((a) => a.lessonId === l.id).forEach((a) => announceAssignment(db, a));
      return l;
    }
    case 'deleteLesson': {
      const l = needed(db.lessons.find((l) => l.id === input.lessonId));
      active(teacherClass(db, user, l.classId));
      db.lessons = db.lessons.filter((x) => x.id !== l.id);
      db.driveUploads.forEach((u) => {
        if (u.lessonId === l.id) delete u.lessonId;
      });
      discardDriveJobs(db, new Set(l.documents.map((d) => d.id)));
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
      active(learnerClass(db, user, l.classId));
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
      const v = z
        .object({
          lessonId: id,
          content: text,
          expectedUpdatedAt: z.string().nullable().optional(),
        })
        .parse(input);
      const lesson = accessLesson(db, user, v.lessonId);
      active(accessClass(db, user, lesson.classId));
      let n = db.notes.find((n) => n.userId === user.id && n.lessonId === v.lessonId);
      if (v.expectedUpdatedAt !== undefined && v.expectedUpdatedAt !== (n?.updatedAt || null))
        throw new HttpError(
          409,
          'Ghi chép đã thay đổi ở phiên khác. Hãy sao chép nội dung và mở lại.',
        );
      if (!n) {
        n = {
          id: uid(),
          userId: user.id,
          lessonId: v.lessonId,
          content: v.content,
          updatedAt: time(),
        };
        db.notes.push(n);
      } else
        Object.assign(n, {
          content: v.content,
          updatedAt: new Date(Math.max(Date.now(), Date.parse(n.updatedAt) + 1)).toISOString(),
        });
      return n;
    }
    case 'comment': {
      const v = z.object({ lessonId: id, content: commentContent }).parse(input);
      const lesson = accessLesson(db, user, v.lessonId);
      active(accessClass(db, user, lesson.classId));
      const d = { id: uid(), userId: user.id, ...v, createdAt: time() };
      db.discussions.push(d);
      return d;
    }
    case 'updateComment': {
      const v = z
        .object({
          discussionId: id,
          content: commentContent,
          expectedContent: z.string().max(5000),
        })
        .parse(input);
      const d = needed(
        db.discussions.find((d) => d.id === v.discussionId),
        'Thảo luận đã bị xóa hoặc không còn tồn tại.',
      );
      const lesson = accessLesson(db, user, d.lessonId);
      active(accessClass(db, user, lesson.classId));
      if (d.userId !== user.id)
        throw new HttpError(403, 'Bạn chỉ có thể sửa thảo luận do mình viết.');
      if (d.content !== v.expectedContent)
        throw new HttpError(
          409,
          'Thảo luận đã được thay đổi. Hủy chỉnh sửa và mở lại để xem nội dung mới.',
        );
      if (d.content !== v.content) Object.assign(d, { content: v.content, updatedAt: time() });
      return d;
    }
    case 'deleteComment': {
      const v = z.object({ discussionId: id, expectedContent: z.string().max(5000) }).parse(input);
      const d = needed(
        db.discussions.find((d) => d.id === v.discussionId),
        'Thảo luận đã bị xóa hoặc không còn tồn tại.',
      );
      const l = accessLesson(db, user, d.lessonId);
      const classroom = needed(db.classes.find((c) => c.id === l.classId));
      active(classroom);
      if (d.userId !== user.id && !managesClass(classroom, user))
        throw new HttpError(403, 'Chỉ người viết hoặc giáo viên phụ trách lớp được xóa thảo luận.');
      if (d.content !== v.expectedContent)
        throw new HttpError(
          409,
          'Thảo luận đã được thay đổi. Đóng xác nhận và kiểm tra nội dung mới trước khi xóa.',
        );
      db.discussions = db.discussions.filter((entry) => entry.id !== d.id);
      return null;
    }
    case 'createAssignment': {
      const v = assignmentValues(db, input);
      active(teacherClass(db, user, v.classId));
      const a: Assignment = {
        id: uid(),
        ...v,
        lessonId: v.lessonId || undefined,
        createdAt: time(),
        revision: uid(),
      };
      db.assignments.push(a);
      if (!a.lessonId || db.lessons.some((l) => l.id === a.lessonId && l.published))
        announceAssignment(db, a);
      return a;
    }
    case 'updateAssignment': {
      const a = needed(db.assignments.find((a) => a.id === input.assignmentId));
      active(teacherClass(db, user, a.classId));
      const expectedRevision = z.string().max(120).optional().parse(input.expectedRevision);
      if (expectedRevision !== undefined && expectedRevision !== (a.revision || ''))
        throw new HttpError(
          409,
          'Bài tập đã thay đổi ở phiên khác. Hãy sao chép nội dung và mở lại.',
        );
      if (input.classId !== undefined && input.classId !== a.classId)
        throw new HttpError(400, 'Không thể chuyển bài tập sang lớp khác.');
      const v = assignmentValues(db, { ...a, ...input, classId: a.classId });
      Object.assign(a, v, { revision: uid() });
      if (!v.lessonId) delete a.lessonId;
      return a;
    }
    case 'deleteAssignment': {
      const v = z.object({ assignmentId: id, confirmTitle: title }).parse(input);
      const a = needed(db.assignments.find((a) => a.id === v.assignmentId));
      active(teacherClass(db, user, a.classId));
      if (v.confirmTitle !== a.title)
        throw new HttpError(409, 'Tên bài tập không khớp. Kiểm tra lại trước khi xóa.');
      const attached = new Set(
        db.submissions
          .filter((s) => s.assignmentId === a.id)
          .flatMap((s) => s.attachments.map((f) => f.id)),
      );
      db.submissions = db.submissions.filter((s) => s.assignmentId !== a.id);
      db.notifications = db.notifications.filter((n) => n.assignmentId !== a.id);
      db.assignments = db.assignments.filter((assignment) => assignment.id !== a.id);
      discardDriveJobs(db, attached);
      return null;
    }
    case 'saveSubmission':
    case 'submitAssignment': {
      const v = z
        .object({
          assignmentId: id,
          content: text.default(''),
          link: z.string().max(2000).default(''),
          attachments: z.array(attachmentSchema).max(10).default([]),
          pledge: z.boolean().optional(),
          expectedRevision: z.string().max(120).optional(),
        })
        .parse(input);
      const { a, c } = assignment(db, user, v.assignmentId);
      learnerClass(db, user, c.id);
      active(c);
      if (action === 'submitAssignment' && !a.allowLate && Date.now() > Date.parse(a.dueAt))
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
      if (v.expectedRevision !== undefined && v.expectedRevision !== (s?.revision || ''))
        throw new HttpError(
          409,
          'Bản nháp đã thay đổi ở phiên khác. Hãy sao chép nội dung và mở lại.',
        );
      if (s && s.status !== 'DRAFT')
        throw new HttpError(409, 'Vui lòng thu hồi bài trước khi chỉnh sửa hoặc nộp lại.');
      if (action === 'submitAssignment') {
        if (!v.pledge) throw new HttpError(400, 'Vui lòng xác nhận bài làm của chính bạn.');
        if (!v.content.trim() && !files.length && !v.link.trim())
          throw new HttpError(400, 'Vui lòng nhập bài làm, đính kèm tệp hoặc liên kết minh chứng.');
        const words = v.content.trim() ? v.content.trim().split(/\s+/u).length : 0;
        // Evidence by file or link replaces the written answer, so the word range only applies to text.
        if (!files.length && !v.link.trim() && !acceptsWordCount(words, a))
          throw new HttpError(
            400,
            `Bài viết cần ${wordRequirement(a)}, hoặc đính kèm tệp bài làm.`,
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
      s.revision = uid();
      if (action === 'submitAssignment') {
        if (s.attempt >= a.maxAttempts) throw new HttpError(409, 'Bạn đã hết số lượt nộp bài.');
        s.status = 'SUBMITTED';
        s.attempt++;
        s.submittedAt = time();
        for (const teacherId of new Set([c.teacherId, ...assignedTeacherIds(c)]))
          db.notifications.push({
            id: uid(),
            userId: teacherId,
            content: `${user.name} đã nộp bài “${a.title}”.`,
            createdAt: time(),
            read: false,
            assignmentId: a.id,
          });
      }
      return submissionFor(s);
    }
    case 'withdrawSubmission': {
      const { a, c } = assignment(db, user, id.parse(input.assignmentId));
      active(learnerClass(db, user, c.id));
      const s = needed(
        db.submissions.find((s) => s.assignmentId === a.id && s.studentId === user.id),
      );
      if (s.status === 'GRADED') throw new HttpError(409, 'Bài đã chấm không thể thu hồi.');
      if (Date.now() > Date.parse(a.dueAt)) throw new HttpError(409, 'Đã hết hạn thu hồi bài làm.');
      if (!a.allowResubmit || s.attempt >= a.maxAttempts)
        throw new HttpError(409, 'Bài tập không cho phép nộp lại hoặc đã hết lượt.');
      s.status = 'DRAFT';
      clearDraftGrade(s);
      s.revision = uid();
      s.gradeRevision = uid();
      return submissionFor(s);
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
          expectedAttempt: z.number().int().positive().optional(),
          expectedSubmittedAt: z.string().datetime().nullable().optional(),
          expectedGradeRevision: z.string().max(120).optional(),
        })
        .parse(input);
      const s = needed(db.submissions.find((s) => s.id === v.submissionId));
      const a = needed(db.assignments.find((a) => a.id === s.assignmentId));
      active(teacherClass(db, user, a.classId));
      if (s.studentId === user.id) throw new HttpError(403, 'Bạn không thể tự chấm bài của mình.');
      if (
        !db.enrollments.some(
          (e) => e.classId === a.classId && e.userId === s.studentId && e.status === 'APPROVED',
        )
      )
        throw new HttpError(409, 'Học viên không còn trong lớp; không thể thay đổi điểm.');
      if (
        (v.expectedAttempt !== undefined && v.expectedAttempt !== s.attempt) ||
        (v.expectedSubmittedAt !== undefined && v.expectedSubmittedAt !== (s.submittedAt || null))
      )
        throw new HttpError(409, 'Bài nộp đã thay đổi. Vui lòng đóng và mở lại bài chấm.');
      if (
        v.expectedGradeRevision !== undefined &&
        v.expectedGradeRevision !== (s.gradeRevision || '')
      )
        throw new HttpError(
          409,
          'Điểm hoặc nhận xét đã được sửa ở phiên khác. Hãy sao chép thay đổi và mở lại.',
        );
      if (s.status === 'DRAFT') throw new HttpError(400, 'Học viên chưa nộp bài.');
      if (s.status === 'GRADED' && !v.returnGrade)
        throw new HttpError(409, 'Bài đã trả điểm cần xác nhận trả lại điểm mới khi chỉnh sửa.');
      s.rubric = v.rubric;
      s.score = Object.values(v.rubric).reduce((a, b) => a + b, 0);
      s.feedback = v.feedback;
      s.gradeRevision = uid();
      if (v.returnGrade) {
        s.status = 'GRADED';
        s.gradedAt = time();
        db.notifications.push({
          id: uid(),
          userId: s.studentId,
          content: `Bài “${a.title}” đã được chấm: ${s.score}/100.`,
          createdAt: time(),
          read: false,
          assignmentId: a.id,
        });
      }
      return s;
    }
    case 'remindStudents': {
      const v = z.object({ assignmentId: id, userId: id.optional() }).parse(input);
      const a = needed(db.assignments.find((a) => a.id === v.assignmentId));
      active(teacherClass(db, user, a.classId));
      const missing = db.enrollments.filter(
        (e) =>
          e.classId === a.classId &&
          e.status === 'APPROVED' &&
          (!v.userId || e.userId === v.userId) &&
          !db.submissions.some(
            (s) => s.assignmentId === a.id && s.studentId === e.userId && s.status !== 'DRAFT',
          ),
      );
      // At most one reminder per learner and assignment every REMIND_COOLDOWN_MS.
      const cutoff = Date.now() - REMIND_COOLDOWN_MS;
      const due = missing.filter(
        (e) =>
          !db.notifications.some(
            (n) =>
              n.assignmentId === a.id &&
              n.userId === e.userId &&
              n.content.startsWith(REMINDER_PREFIX) &&
              Date.parse(n.createdAt) > cutoff,
          ),
      );
      if (missing.length && !due.length)
        throw new HttpError(
          429,
          'Học viên đã được nhắc trong 3 giờ qua. Vui lòng thử lại sau để tránh làm phiền.',
        );
      for (const e of due)
        db.notifications.push({
          id: uid(),
          userId: e.userId,
          content: `${REMINDER_PREFIX} ${a.title}. Hạn nộp ${new Date(a.dueAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (GMT+7).`,
          createdAt: time(),
          read: false,
          assignmentId: a.id,
        });
      return { count: due.length, skipped: missing.length - due.length };
    }
    case 'markNotificationsRead': {
      const v = z.object({ ids: z.array(id).max(2000).optional() }).parse(input);
      const selected = v.ids ? new Set(v.ids) : null;
      db.notifications
        .filter((n) => n.userId === user.id && (!selected || selected.has(n.id)))
        .forEach((n) => (n.read = true));
      return null;
    }
    default:
      throw new HttpError(400, 'Thao tác không được hỗ trợ.');
  }
}

/**
 * Every caller that handles user input (the API route, scripts) must use this entry point: edits
 * of shared content need the version the editor started from, so stale tabs get a 409.
 */
export function requireEditVersion(input: Record<string, unknown>) {
  const reload = () => {
    throw new HttpError(
      409,
      'Phiên soạn thảo đã cũ. Hãy sao chép nội dung và tải lại trang trước khi lưu.',
    );
  };
  if (
    (input.action === 'saveSubmission' || input.action === 'submitAssignment') &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    input.action === 'saveNote' &&
    !(input.expectedUpdatedAt === null || typeof input.expectedUpdatedAt === 'string')
  )
    reload();
  if (
    input.action === 'saveLesson' &&
    (input.id || input.lessonId) &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    (input.action === 'updateClass' || input.action === 'updateAssignment') &&
    typeof input.expectedRevision !== 'string'
  )
    reload();
  if (
    input.action === 'gradeSubmission' &&
    (typeof input.expectedGradeRevision !== 'string' ||
      typeof input.expectedAttempt !== 'number' ||
      !(input.expectedSubmittedAt === null || typeof input.expectedSubmittedAt === 'string'))
  )
    reload();
}
export function runActionStrict(
  db: Database,
  user: StoredUser,
  input: Record<string, unknown>,
): unknown {
  requireEditVersion(input);
  return runAction(db, user, input);
}

/**
 * Tables each action reads or writes. The API route loads only these, so a click on "complete
 * lesson" no longer reads and diffs every submission and notification (see withDatabase).
 * Actions not listed (rare, broad ones such as deleteClass) load everything. A table missing from a
 * list makes the action fail loudly, and tests/action-tables.test.ts checks every list.
 */
const ACCESS: TableKey[] = ['users', 'classes', 'enrollments'];
const LESSON_ACCESS: TableKey[] = [...ACCESS, 'lessons'];
const SUBMIT: TableKey[] = [
  ...LESSON_ACCESS,
  'assignments',
  'submissions',
  'files',
  'driveUploads',
  'notifications',
];
export const ACTION_TABLES: Record<string, TableKey[]> = {
  createClass: ['users', 'classes'],
  updateClass: ACCESS,
  setClassTeachers: ACCESS,
  archiveClass: ['users', 'classes'],
  regenerateCode: ['users', 'classes'],
  previewClass: ['users', 'classes'],
  joinClass: ACCESS,
  cancelEnrollment: ACCESS,
  leaveClass: ACCESS,
  removeEnrollment: ACCESS,
  setEnrollmentGroup: ACCESS,
  approveEnrollment: ACCESS,
  rejectEnrollment: ACCESS,
  saveLesson: [...LESSON_ACCESS, 'assignments', 'files', 'driveUploads', 'notifications'],
  deleteLesson: [
    ...LESSON_ACCESS,
    'assignments',
    'submissions',
    'progress',
    'notes',
    'discussions',
    'driveUploads',
    'driveTrash',
  ],
  completeLesson: [...LESSON_ACCESS, 'progress'],
  bookmarkLesson: [...LESSON_ACCESS, 'progress'],
  saveNote: [...LESSON_ACCESS, 'notes'],
  comment: [...LESSON_ACCESS, 'discussions'],
  updateComment: [...LESSON_ACCESS, 'discussions'],
  deleteComment: [...LESSON_ACCESS, 'discussions'],
  createAssignment: [...LESSON_ACCESS, 'assignments', 'notifications'],
  updateAssignment: [...LESSON_ACCESS, 'assignments'],
  deleteAssignment: [
    ...LESSON_ACCESS,
    'assignments',
    'submissions',
    'notifications',
    'driveUploads',
    'driveTrash',
  ],
  saveSubmission: SUBMIT,
  submitAssignment: SUBMIT,
  withdrawSubmission: [...LESSON_ACCESS, 'assignments', 'submissions'],
  gradeSubmission: [...ACCESS, 'assignments', 'submissions', 'notifications'],
  remindStudents: [...ACCESS, 'assignments', 'submissions', 'notifications'],
  markNotificationsRead: ['users', 'notifications'],
};
export const tablesFor = (action: unknown): readonly TableKey[] | undefined =>
  typeof action === 'string' ? ACTION_TABLES[action] : undefined;
