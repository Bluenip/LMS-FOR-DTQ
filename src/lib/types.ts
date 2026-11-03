export type Role = 'STUDENT' | 'TEACHER';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
  isAdmin?: boolean;
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
  status: 'APPROVED' | 'PENDING';
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
  videoType: 'YOUTUBE' | 'UPLOAD';
  videoUrl: string;
  videoFileId?: string;
  duration: string;
  published: boolean;
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
}
