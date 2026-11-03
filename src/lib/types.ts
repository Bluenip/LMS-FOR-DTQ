export type Role = 'STUDENT' | 'TEACHER';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
}
export interface AdminUser extends User {
  isAdmin: boolean;
  emailVerified: boolean;
  disabled: boolean;
  isDemo: boolean;
  classCount: number;
  enrollmentCount: number;
}
export interface AdminState {
  users: AdminUser[];
  managedClasses: { id: string; title: string; teacherId: string }[];
  summary: {
    teachers: number;
    students: number;
    active: number;
    pendingVerification: number;
    disabled: number;
    classes: number;
  };
}
export interface Classroom {
  id: string;
  title: string;
  description: string;
  contentAuthor?: string;
  code: string;
  teacherId: string;
  teacherIds?: string[];
  revision?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  capacity: number;
  enrollmentOpen: boolean;
  autoApprove: boolean;
  schedule: string;
  cover: string;
  createdAt: string;
}
export interface Enrollment {
  id: string;
  classId: string;
  userId: string;
  status: 'APPROVED' | 'PENDING' | 'REMOVED';
  group: number;
  joinedAt: string;
}
export interface Lesson {
  id: string;
  classId: string;
  title: string;
  chapter: string;
  order: number;
  description: string;
  videoType: 'YOUTUBE' | 'UPLOAD' | 'DRIVE';
  videoUrl: string;
  videoFileId?: string;
  /** Google Drive file id, only when videoType is DRIVE. */
  driveFileId?: string;
  duration: string;
  published: boolean;
  revision?: string;
  timestamps: { time: string; title: string }[];
  documents: Attachment[];
  createdAt: string;
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
}
export interface Assignment {
  id: string;
  classId: string;
  lessonId?: string;
  title: string;
  instructions: string;
  dueAt: string;
  allowLate: boolean;
  allowResubmit: boolean;
  maxAttempts: number;
  minWords: number;
  maxWords: number | null;
  createdAt: string;
  revision?: string;
  /** Set once learners were notified; prevents repeat announcements on re-publish. */
  announcedAt?: string;
}
export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  content: string;
  link: string;
  attachments: Attachment[];
  status: 'DRAFT' | 'SUBMITTED' | 'GRADED';
  attempt: number;
  submittedAt?: string;
  score?: number;
  rubric?: { understanding: number; application: number; presentation: number };
  feedback: string;
  gradedAt?: string;
  revision?: string;
  gradeRevision?: string;
}
export interface Progress {
  id: string;
  userId: string;
  lessonId: string;
  completed: boolean;
  bookmarked: boolean;
}
export interface Note {
  id: string;
  userId: string;
  lessonId: string;
  content: string;
  updatedAt: string;
}
export interface Discussion {
  id: string;
  userId: string;
  lessonId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
}
export interface Notification {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  read: boolean;
  assignmentId?: string;
}
export interface AppState {
  user: User;
  users: User[];
  classes: Classroom[];
  enrollments: Enrollment[];
  lessons: Lesson[];
  assignments: Assignment[];
  submissions: Submission[];
  progress: Progress[];
  notes: Note[];
  discussions: Discussion[];
  notifications: Notification[];
  demo: boolean;
  storageConfigured: boolean;
}
export interface StoredUser extends User {
  passwordHash: string;
  emailVerified?: boolean;
  sessionVersion?: number;
  isDemo?: boolean;
  disabled?: boolean;
}
export interface AuthToken {
  id: string;
  userId: string;
  tokenHash: string;
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD';
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  pendingPasswordHash?: string;
  pendingName?: string;
}
export interface StoredFile {
  id: string;
  ownerId: string;
  classId: string;
  key: string;
  name: string;
  size: number;
  mimeType: string;
  verified: boolean;
  createdAt: string;
}
export type DriveUploadStatus = 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export interface DriveConnection {
  id: string;
  connectedById: string;
  email: string;
  /** AES-256-GCM envelope; never leaves the server. */
  encryptedRefreshToken: string;
  scope: string;
  status: 'ACTIVE' | 'REVOKED' | 'DISCONNECTED';
  folderId?: string;
  createdAt: string;
  updatedAt: string;
}
/** A Drive file queued for deletion (its DriveUpload row may already be gone). */
export interface DriveTrash {
  id: string;
  createdAt: string;
}
export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  targetId?: string;
  detail: string;
  createdAt: string;
}
export interface DriveUpload {
  id: string;
  ownerId: string;
  classId: string;
  lessonId?: string;
  kind: 'video' | 'document';
  name: string;
  mimeType: string;
  size: number;
  title: string;
  description: string;
  status: DriveUploadStatus;
  bytesUploaded: number;
  /** Encrypted resumable-session URI (a bearer credential); never serialised to clients. */
  encryptedSessionUri?: string;
  driveFileId?: string;
  webViewLink?: string;
  shared: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
/** Client-safe view of a DriveUpload. */
export interface DriveFile {
  id: string;
  classId: string;
  lessonId?: string;
  kind: 'video' | 'document';
  name: string;
  mimeType: string;
  size: number;
  title: string;
  description: string;
  status: DriveUploadStatus;
  bytesUploaded: number;
  driveFileId?: string;
  previewUrl?: string;
  webViewLink?: string;
  shared: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  status?: DriveConnection['status'];
  email?: string;
  canConnect: boolean;
}
export interface Database {
  users: StoredUser[];
  classes: Classroom[];
  enrollments: Enrollment[];
  lessons: Lesson[];
  assignments: Assignment[];
  submissions: Submission[];
  progress: Progress[];
  notes: Note[];
  discussions: Discussion[];
  notifications: Notification[];
  files: StoredFile[];
  authTokens: AuthToken[];
  driveConnections: DriveConnection[];
  driveUploads: DriveUpload[];
  driveTrash: DriveTrash[];
  /** Demo (JSON) mode only; PostgreSQL keeps the audit trail outside the snapshot. */
  auditLogs?: AuditLog[];
}
