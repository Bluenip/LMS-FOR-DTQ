import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditLog, Database, StoredUser } from '@/lib/types';
import { seedData } from './seed-data';
/** Demo-mode storage folder; overridable so tests never touch a developer's data. */
export const dataDir = () => process.env.LMS_DATA_DIR || '.data';
let prisma: PrismaClient | undefined;
let queue = Promise.resolve();
const tables = {
  users: 'user',
  classes: 'classroom',
  enrollments: 'enrollment',
  lessons: 'lesson',
  assignments: 'assignment',
  submissions: 'submission',
  progress: 'progress',
  notes: 'note',
  discussions: 'discussion',
  notifications: 'notification',
  files: 'storedFile',
  authTokens: 'authToken',
  driveConnections: 'driveConnection',
  driveUploads: 'driveUpload',
  driveTrash: 'driveTrash',
} as const;
async function client() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}
/** Timestamps are real DATE columns in PostgreSQL but the app works with ISO-8601 strings. */
const plain = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
function cleanRow<T>(row: unknown): T {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>)
      .filter(([, value]) => value !== null)
      .map(([field, value]) => [field, plain(value)]),
  ) as T;
}
function emptyDatabase(): Database {
  return {
    users: [],
    classes: [],
    enrollments: [],
    lessons: [],
    assignments: [],
    submissions: [],
    progress: [],
    notes: [],
    discussions: [],
    notifications: [],
    files: [],
    authTokens: [],
    driveConnections: [],
    driveUploads: [],
    driveTrash: [],
  };
}
/** Session checks need one user, not a snapshot of every class and submission. */
export async function findSessionUser(userId: string): Promise<StoredUser | undefined> {
  if (!process.env.DATABASE_URL) return withDatabase((db) => db.users.find((u) => u.id === userId));
  const row = await (await client()).user.findUnique({ where: { id: userId } });
  return row ? cleanRow<StoredUser>(row) : undefined;
}

export async function findLoginUser(email: string): Promise<StoredUser | undefined> {
  if (!process.env.DATABASE_URL)
    return withDatabase((db) =>
      db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()),
    );
  const row = await (
    await client()
  ).user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  return row ? cleanRow<StoredUser>(row) : undefined;
}

/** Load only the target class and teacher accounts for the assignment dialog. */
export async function withTeacherOptions<T>(
  userId: string | null,
  classId: string,
  fn: (db: Database) => T,
): Promise<T> {
  if (!process.env.DATABASE_URL) return withDatabase(fn);
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      const [user, classroom] = await Promise.all([
        userId ? tx.user.findUnique({ where: { id: userId } }) : null,
        tx.classroom.findUnique({ where: { id: classId } }),
      ]);
      const db = emptyDatabase();
      db.users = user ? [cleanRow(user)] : [];
      db.classes = classroom ? [cleanRow(classroom)] : [];
      // Validate the caller before exposing or loading the teacher directory.
      fn(db);
      db.users = (await tx.user.findMany({ where: { role: 'TEACHER' } })).map((row) =>
        cleanRow<StoredUser>(row),
      );
      if (user && !db.users.some((candidate) => candidate.id === user.id))
        db.users.push(cleanRow(user));
      return fn(db);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Revoke all copies of this session version, including cookies on other devices. */
export async function revokeSession(session: { id: string; version: number }) {
  if (process.env.DATABASE_URL) {
    return (await client()).$transaction(
      async (tx) => {
        // Coordinate with both global snapshot writers and account-scoped writers.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(42719823)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719825, hashtext(${`user:${session.id}`}))`;
        const changed = await tx.user.updateMany({
          where: { id: session.id, sessionVersion: session.version },
          data: { sessionVersion: { increment: 1 } },
        });
        if (changed.count) await bumpVersions(tx, [`user:${session.id}`]);
      },
      { maxWait: 10000, timeout: 30000 },
    );
  }
  await withDatabase((db) => {
    const user = db.users.find((u) => u.id === session.id);
    if (user && (user.sessionVersion ?? 0) === session.version)
      user.sessionVersion = session.version + 1;
  }, true);
}

/** A bounded, atomic counter shared by every application process. */
export async function consumeRequestLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      // Serializes only these tiny counter transactions, independently of LMS writes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719824)`;
      await tx.$executeRaw`DELETE FROM "RequestLimit" WHERE "resetAt" <= ${BigInt(now)}`;
      const rows = await tx.$queryRaw<{ count: number }[]>`
      INSERT INTO "RequestLimit" ("key", "count", "resetAt")
      SELECT ${key}, 1, ${BigInt(now + windowMs)}
      WHERE EXISTS (SELECT 1 FROM "RequestLimit" WHERE "key" = ${key})
        OR (SELECT count(*) FROM "RequestLimit") < 10000
      ON CONFLICT ("key") DO UPDATE SET "count" = "RequestLimit"."count" + 1
      WHERE "RequestLimit"."count" < ${limit}
      RETURNING "count"`;
      return rows.length > 0;
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

export async function resetRequestLimit(key: string) {
  await (
    await client()
  ).$executeRaw`DELETE FROM "RequestLimit" WHERE "key" = ${key}`;
}

export async function releaseRequestLimit(key: string) {
  await (
    await client()
  ).$executeRaw`UPDATE "RequestLimit" SET "count" = GREATEST("count" - 1, 0) WHERE "key" = ${key}`;
}

/** Build the state from only the caller's classes; writes continue to use the locked snapshot. */
export async function withScopedState<T>(
  userId: string | null,
  fn: (db: Database) => T,
): Promise<T> {
  if (!userId) return fn(emptyDatabase());
  if (!process.env.DATABASE_URL) return withDatabase(fn);
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      const userRow = await tx.user.findUnique({ where: { id: userId } });
      if (!userRow) return fn(emptyDatabase());
      const user = cleanRow<StoredUser>(userRow);
      const own = await tx.enrollment.findMany({ where: { userId, status: { not: 'REMOVED' } } });
      const classrooms = await tx.classroom.findMany({
        where: {
          OR: [
            { teacherId: userId },
            { teacherIds: { has: userId } },
            { id: { in: own.map((e) => e.classId) } },
          ],
        },
      });
      const managed = classrooms
        .filter(
          (c) =>
            user.role === 'TEACHER' && (c.teacherId === userId || c.teacherIds.includes(userId)),
        )
        .map((c) => c.id);
      const learning = own.filter((e) => e.status === 'APPROVED').map((e) => e.classId);
      const classIds = classrooms.map((c) => c.id);
      const enrollments = await tx.enrollment.findMany({
        where: {
          OR: [
            { classId: { in: managed } },
            { classId: { in: learning }, status: 'APPROVED' },
            { classId: { in: classIds }, userId },
          ],
        },
      });
      const [lessons, assignments, notifications] = await Promise.all([
        tx.lesson.findMany({
          where: {
            OR: [{ classId: { in: managed } }, { classId: { in: learning }, published: true }],
          },
        }),
        tx.assignment.findMany({ where: { classId: { in: [...managed, ...learning] } } }),
        tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      ]);
      const lessonIds = lessons.map((l) => l.id);
      const managedLessons = lessons.filter((l) => managed.includes(l.classId)).map((l) => l.id);
      const managedAssignments = assignments
        .filter((a) => managed.includes(a.classId))
        .map((a) => a.id);
      const [submissions, progress, notes, discussions] = await Promise.all([
        tx.submission.findMany({
          where: {
            OR: [
              { assignmentId: { in: assignments.map((a) => a.id) }, studentId: userId },
              { assignmentId: { in: managedAssignments }, status: { not: 'DRAFT' } },
            ],
          },
        }),
        tx.progress.findMany({
          where: {
            OR: [{ lessonId: { in: lessonIds }, userId }, { lessonId: { in: managedLessons } }],
          },
        }),
        tx.note.findMany({ where: { lessonId: { in: lessonIds }, userId } }),
        tx.discussion.findMany({ where: { lessonId: { in: lessonIds } } }),
      ]);
      const users = await tx.user.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                userId,
                ...classrooms.map((c) => c.teacherId),
                ...classrooms.flatMap((c) => c.teacherIds),
                ...enrollments.map((e) => e.userId),
                ...discussions.map((d) => d.userId),
              ]),
            ],
          },
        },
      });
      const clean = (rows: unknown[]) => rows.map((row) => cleanRow(row));
      return fn({
        users: clean(users),
        classes: clean(classrooms),
        enrollments: clean(enrollments),
        lessons: clean(lessons),
        assignments: assignments.map((a) => ({ ...cleanRow(a), maxWords: a.maxWords })),
        submissions: clean(submissions),
        progress: clean(progress),
        notes: clean(notes),
        discussions: clean(discussions),
        notifications: clean(notifications),
        files: [],
        authTokens: [],
        // Only the connection status is needed to tell clients whether uploads are available.
        driveConnections: (
          await tx.driveConnection.findMany({ select: { id: true, status: true } })
        ).map((c) => ({ ...c, encryptedRefreshToken: '' })) as Database['driveConnections'],
        driveUploads: [],
        driveTrash: [],
      } as Database);
    },
    {
      maxWait: 10000,
      timeout: 30000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}
export type TableKey = keyof typeof tables;
type Rows = { id: string }[];
async function readPostgres(tx: unknown): Promise<Database> {
  const db = {} as Database;
  await Promise.all(
    (Object.entries(tables) as [TableKey, string][]).map(async ([key, model]) => {
      (db as unknown as Record<string, unknown>)[key] = (
        await (tx as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[
          model
        ].findMany()
      ).map((row) => cleanTableRow(key, row));
    }),
  );
  return db;
}
function cleanTableRow(key: string, row: Record<string, unknown>) {
  // Timestamp columns reach the application as ISO-8601 strings, as before the TIMESTAMPTZ change.
  return Object.fromEntries(
    Object.entries(row)
      .filter(([field, value]) => value !== null || (key === 'assignments' && field === 'maxWords'))
      .map(([field, value]) => [field, plain(value)]),
  );
}
/** Persist only rows that changed. Returns whether anything was written. */
async function writePostgres(tx: unknown, db: Database, previous: Database) {
  const api = tx as Record<
    string,
    {
      deleteMany: (v: unknown) => Promise<unknown>;
      updateMany: (v: unknown) => Promise<unknown>;
      create: (v: unknown) => Promise<unknown>;
    }
  >;
  let changed = false;
  for (const [key, model] of Object.entries(tables).reverse()) {
    const rows = (db as unknown as Record<string, Rows>)[key];
    const currentIds = new Set(rows.map((row) => row.id));
    const removed = (previous as unknown as Record<string, Rows>)[key]
      .filter((row) => !currentIds.has(row.id))
      .map((row) => row.id);
    if (removed.length) {
      changed = true;
      await api[model].deleteMany({ where: { id: { in: removed } } });
    }
  }
  for (const [key, model] of Object.entries(tables)) {
    const original = new Map(
      (previous as unknown as Record<string, Rows>)[key].map((row) => [
        row.id,
        JSON.stringify(row),
      ]),
    );
    for (const row of (db as unknown as Record<string, Rows>)[key]) {
      const before = original.get(row.id);
      if (before === JSON.stringify(row)) continue;
      changed = true;
      const data = JSON.parse(JSON.stringify(row));
      const optional: Record<string, string[]> = {
        user: ['avatar'],
        authToken: ['consumedAt', 'pendingPasswordHash', 'pendingName'],
        lesson: ['videoFileId', 'driveFileId'],
        assignment: ['lessonId', 'maxWords', 'announcedAt'],
        notification: ['assignmentId'],
        discussion: ['updatedAt'],
        submission: ['submittedAt', 'score', 'gradedAt'],
        driveUpload: [
          'lessonId',
          'encryptedSessionUri',
          'driveFileId',
          'webViewLink',
          'errorMessage',
        ],
        driveConnection: ['folderId'],
      };
      for (const field of optional[model] || []) if (!(field in data)) data[field] = null;
      if (model === 'submission' && !('rubric' in data)) data.rubric = Prisma.DbNull;
      // Existing rows are updated in place and never resurrected if another
      // transaction (for example a cascading class deletion) removed them.
      if (before === undefined) await api[model].create({ data });
      else await api[model].updateMany({ where: { id: row.id }, data });
    }
  }
  return changed;
}
async function bumpVersions(tx: Prisma.TransactionClient, scopes: string[]) {
  for (const scope of scopes)
    await tx.$executeRaw`INSERT INTO "ChangeVersion" ("scope", "version") VALUES (${scope}, 1)
      ON CONFLICT ("scope") DO UPDATE SET "version" = "ChangeVersion"."version" + 1`;
}

/** Call with the global exclusive lock so membership and discussions cannot change. */
async function bumpUserNameVersions(tx: Prisma.TransactionClient, userId: string) {
  const [classes, enrollments, discussions] = await Promise.all([
    tx.classroom.findMany({
      where: { OR: [{ teacherId: userId }, { teacherIds: { has: userId } }] },
      select: { id: true },
    }),
    tx.enrollment.findMany({ where: { userId }, select: { classId: true } }),
    tx.discussion.findMany({
      where: { userId },
      select: { lesson: { select: { classId: true } } },
    }),
  ]);
  const scopes = new Set([
    `user:${userId}`,
    ...classes.map((c) => `class:${c.id}`),
    ...enrollments.map((e) => `class:${e.classId}`),
    ...discussions.map((d) => `class:${d.lesson.classId}`),
  ]);
  await bumpVersions(tx, [...scopes].sort());
}

/** Administrative operations need account and class metadata, not learning content. */
export async function withAdminDatabase<T>(
  actorId: string | null,
  options: {
    write: boolean;
    exclusive: boolean;
    renameOnly?: boolean;
    targetId?: string;
    create?: boolean;
    classId?: string;
    candidateId?: string;
    email?: string;
  },
  fn: (db: Database) => T | Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL) return withDatabase(fn, options.write);
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      if (options.write) {
        if (options.exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719823)`;
        else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(42719823)`;
          const keys = [
            ...new Set([
              ...(actorId ? [`user:${actorId}`] : []),
              ...(options.targetId ? [`user:${options.targetId}`] : []),
              ...(options.create ? ['admin:create'] : []),
            ]),
          ].sort();
          for (const key of keys)
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719825, hashtext(${key}))`;
        }
      }
      const userIds = [actorId, options.targetId, options.candidateId].filter(
        (id): id is string => !!id,
      );
      const [users, classes, enrollments, authTokens] = await Promise.all([
        tx.user.findMany(
          options.write
            ? {
                where: {
                  OR: [
                    { id: { in: userIds } },
                    ...(options.email
                      ? [{ email: { equals: options.email, mode: 'insensitive' as const } }]
                      : []),
                  ],
                },
              }
            : undefined,
        ),
        tx.classroom.findMany(
          options.write
            ? {
                where: {
                  OR: [
                    ...(options.targetId
                      ? [{ teacherId: options.targetId }, { teacherIds: { has: options.targetId } }]
                      : []),
                    ...(options.classId ? [{ id: options.classId }] : []),
                  ],
                },
              }
            : undefined,
        ),
        tx.enrollment.findMany(
          options.write
            ? {
                where: {
                  OR: [
                    ...(options.targetId ? [{ userId: options.targetId }] : []),
                    ...(options.classId ? [{ classId: options.classId }] : []),
                  ],
                },
              }
            : undefined,
        ),
        options.write && options.targetId
          ? tx.authToken.findMany({ where: { userId: options.targetId } })
          : [],
      ]);
      const db = emptyDatabase();
      db.users = users.map((row) => cleanRow(row));
      db.classes = classes.map((row) => cleanRow(row));
      db.enrollments = enrollments.map((row) => cleanRow(row));
      db.authTokens = authTokens.map((row) => cleanRow(row));
      const previous = options.write ? structuredClone(db) : undefined;
      const result = await fn(db);
      if (previous && (await writePostgres(tx, db, previous))) {
        const before = options.targetId && previous.users.find((u) => u.id === options.targetId);
        const after = options.targetId && db.users.find((u) => u.id === options.targetId);
        if (options.renameOnly && before && after && before.name !== after.name)
          await bumpUserNameVersions(tx, after.id);
        else if (options.exclusive && !options.renameOnly) await bumpVersions(tx, ['global']);
        else if (options.targetId) await bumpVersions(tx, [`user:${options.targetId}`]);
      }
      return result;
    },
    {
      maxWait: 10000,
      timeout: 30000,
      isolationLevel: options.write ? undefined : Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}

/** Commit a profile prepared outside the transaction, rejecting stale account data. */
export async function commitProfileUpdate(
  expected: StoredUser,
  updated: StoredUser,
  passwordChanged: boolean,
) {
  const pg = await client();
  await pg.$transaction(
    async (tx) => {
      // A rename can appear in current classes and former members' discussions.
      // Freeze membership and discussion writes while finding the affected classes.
      const renamed = !passwordChanged || expected.name !== updated.name;
      if (renamed) await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719823)`;
      else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(42719823)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719825, hashtext(${`user:${expected.id}`}))`;
      const row = await tx.user.findUnique({ where: { id: expected.id } });
      const current = row ? cleanRow<StoredUser>(row) : undefined;
      // A concurrent rename can safely be applied to the latest account. Never
      // retry a password change or overwrite a change to any other field.
      const onlyNameChanged =
        current &&
        !passwordChanged &&
        JSON.stringify({ ...current, name: expected.name }) === JSON.stringify(expected);
      if (!current || (!onlyNameChanged && JSON.stringify(current) !== JSON.stringify(expected))) {
        const { HttpError } = await import('./auth');
        throw new HttpError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại trang và thử lại.');
      }
      await tx.user.update({
        where: { id: expected.id },
        data: {
          name: updated.name,
          ...(passwordChanged
            ? {
                passwordHash: updated.passwordHash,
                mustChangePassword: updated.mustChangePassword ?? false,
                sessionVersion: updated.sessionVersion ?? 0,
              }
            : {}),
        },
      });
      if (passwordChanged) await tx.authToken.deleteMany({ where: { userId: expected.id } });
      if (current.name !== updated.name) await bumpUserNameVersions(tx, expected.id);
      else await bumpVersions(tx, [`user:${expected.id}`]);
    },
    { maxWait: 10000, timeout: 30000 },
  );
}
export async function withDatabase<T>(
  fn: (db: Database) => T | Promise<T>,
  write = false,
): Promise<T> {
  if (process.env.DATABASE_URL) {
    const pg = await client();
    return pg.$transaction(
      async (tx) => {
        if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719823)`;
        const db = await readPostgres(tx);
        const previous = write ? structuredClone(db) : undefined;
        const result = await fn(db);
        if (write && previous && (await writePostgres(tx, db, previous)))
          await bumpVersions(tx, ['global']);
        return result;
      },
      {
        maxWait: 10000,
        timeout: 30000,
        isolationLevel: write ? undefined : Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }
  let release!: () => void;
  const previous = queue;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await mkdir(dataDir(), { recursive: true });
    let db: Database;
    try {
      db = JSON.parse(await readFile(`${dataDir()}/demo.json`, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error(
          'Tệp .data/demo.json không hợp lệ. Hãy khôi phục bản sao lưu hoặc xóa tệp để tạo lại dữ liệu demo.',
          { cause: error },
        );
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      db = seedData();
      await writeFile(`${dataDir()}/demo.json`, JSON.stringify(db, null, 2), { mode: 0o600 });
    }
    db.authTokens ??= [];
    db.driveConnections ??= [];
    db.driveUploads ??= [];
    db.driveTrash ??= [];
    db.auditLogs ??= [];
    for (const user of db.users) {
      user.emailVerified ??= true;
      user.sessionVersion ??= 0;
      user.isAdmin ??= false;
      user.disabled ??= false;
    }
    const result = await fn(db);
    if (write) {
      const temp = `${dataDir()}/demo-${randomUUID()}.json`;
      await writeFile(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
      await rename(temp, `${dataDir()}/demo.json`);
    }
    return result;
  } finally {
    release();
  }
}
export async function seedPostgres() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await withDatabase((db) => {
    if (db.users.length) throw new Error('Database is not empty; seed cancelled.');
    Object.assign(db, seedData());
  }, true);
}
export async function checkDatabaseConnection() {
  if (process.env.DATABASE_URL) await (await client()).$queryRaw`SELECT 1`;
}

export type DataScope = {
  classIds: string[];
  userIds?: string[];
  notifications?: { action: string; ids?: string[]; assignmentId?: string };
};
export type ScopeResolver = (tx: Prisma.TransactionClient) => Promise<DataScope>;
async function readScoped(
  tx: Prisma.TransactionClient,
  actorId: string,
  classIds: string[],
  extraUserIds: string[],
  notificationScope?: DataScope['notifications'],
): Promise<Database> {
  const rows = <T>(key: string, list: T[]) =>
    list.map((row) => cleanTableRow(key, row as Record<string, unknown>));
  const classes = classIds.length
    ? await tx.classroom.findMany({ where: { id: { in: classIds } } })
    : [];
  const ids = classes.map((c) => c.id);
  const [enrollments, lessons, assignments, files, driveUploads] = await Promise.all([
    tx.enrollment.findMany({ where: { classId: { in: ids } } }),
    tx.lesson.findMany({ where: { classId: { in: ids } } }),
    tx.assignment.findMany({ where: { classId: { in: ids } } }),
    tx.storedFile.findMany({ where: { OR: [{ classId: { in: ids } }, { ownerId: actorId }] } }),
    tx.driveUpload.findMany({ where: { classId: { in: ids } } }),
  ]);
  const lessonIds = lessons.map((l) => l.id);
  const assignmentIds = assignments.map((a) => a.id);
  const [submissions, progress, notes, discussions, notifications] = await Promise.all([
    tx.submission.findMany({ where: { assignmentId: { in: assignmentIds } } }),
    tx.progress.findMany({ where: { lessonId: { in: lessonIds } } }),
    tx.note.findMany({ where: { lessonId: { in: lessonIds } } }),
    tx.discussion.findMany({ where: { lessonId: { in: lessonIds } } }),
    notificationScope?.action === 'markNotificationsRead'
      ? tx.notification.findMany({
          where: {
            userId: actorId,
            read: false,
            ...(notificationScope.ids ? { id: { in: notificationScope.ids } } : {}),
          },
        })
      : notificationScope?.action === 'remindStudents'
        ? tx.notification.findMany({
            where: {
              assignmentId: {
                in: assignmentIds.filter((id) => id === notificationScope.assignmentId),
              },
              content: { startsWith: 'Nhắc nộp bài:' },
              createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
            },
          })
        : notificationScope?.action === 'deleteClass' ||
            notificationScope?.action === 'deleteAssignment'
          ? tx.notification.findMany({
              where: {
                assignmentId: {
                  in:
                    notificationScope.action === 'deleteClass'
                      ? assignmentIds
                      : assignmentIds.filter((id) => id === notificationScope.assignmentId),
                },
              },
            })
          : Promise.resolve([]),
  ]);
  const userIds = new Set([
    actorId,
    ...extraUserIds,
    ...classes.flatMap((c) => [c.teacherId, ...c.teacherIds]),
    ...enrollments.map((e) => e.userId),
    ...discussions.map((d) => d.userId),
  ]);
  const users = await tx.user.findMany({ where: { id: { in: [...userIds] } } });
  return {
    users: rows('users', users),
    classes: rows('classes', classes),
    enrollments: rows('enrollments', enrollments),
    lessons: rows('lessons', lessons),
    assignments: rows('assignments', assignments),
    submissions: rows('submissions', submissions),
    progress: rows('progress', progress),
    notes: rows('notes', notes),
    discussions: rows('discussions', discussions),
    notifications: rows('notifications', notifications),
    files: rows('files', files),
    authTokens: [],
    driveConnections: [],
    driveUploads: rows('driveUploads', driveUploads),
    driveTrash: [],
  } as unknown as Database;
}

/**
 * Run `fn` against only the classes the request touches, plus the actor's own
 * notifications and files. Writers hold a shared global lock (so account and
 * administrative snapshot writers stay exclusive) and exclusive locks on each
 * class and on the actor, so writers in unrelated classes run in parallel.
 * Without PostgreSQL this falls back to the JSON snapshot.
 */
export async function withClassScope<T>(
  actorId: string | null,
  resolve: ScopeResolver,
  fn: (db: Database) => T | Promise<T>,
  write = false,
): Promise<T> {
  if (!process.env.DATABASE_URL) return withDatabase(fn, write);
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      if (!actorId) return fn(emptyDatabase());
      const scope = await resolve(tx);
      const classIds = [...new Set(scope.classIds.filter(Boolean))].sort();
      const lockKeys = [...classIds.map((id) => `class:${id}`), `user:${actorId}`].sort();
      if (write) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(42719823)`;
        for (const key of lockKeys)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719825, hashtext(${key}))`;
      }
      const db = await readScoped(tx, actorId, classIds, scope.userIds || [], scope.notifications);
      const previous = write ? structuredClone(db) : undefined;
      const result = await fn(db);
      if (
        write &&
        previous &&
        (await writePostgres(tx, db, previous)) &&
        (Object.keys(tables) as (keyof Database)[]).some(
          (key) => key !== 'files' && JSON.stringify(db[key]) !== JSON.stringify(previous[key]),
        )
      ) {
        const touched = new Set([
          ...lockKeys,
          ...previous.classes.map((c) => `class:${c.id}`),
          ...db.classes.map((c) => `class:${c.id}`),
        ]);
        await bumpVersions(tx, [...touched].sort());
      }
      return result;
    },
    {
      maxWait: 10000,
      timeout: 30000,
      isolationLevel: write
        ? Prisma.TransactionIsolationLevel.ReadCommitted
        : Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}

/** Find the class that owns a row, for scope resolution. Unknown ids resolve to no class. */
export async function classOf(
  tx: Prisma.TransactionClient,
  kind: 'lesson' | 'assignment' | 'enrollment' | 'submission' | 'discussion' | 'file' | 'code',
  value: unknown,
): Promise<string[]> {
  if (typeof value !== 'string' || !value) return [];
  switch (kind) {
    case 'lesson':
      return (await tx.lesson.findMany({ where: { id: value }, select: { classId: true } })).map(
        (r) => r.classId,
      );
    case 'assignment':
      return (
        await tx.assignment.findMany({ where: { id: value }, select: { classId: true } })
      ).map((r) => r.classId);
    case 'enrollment':
      return (
        await tx.enrollment.findMany({ where: { id: value }, select: { classId: true } })
      ).map((r) => r.classId);
    case 'file':
      return (
        await tx.storedFile.findMany({ where: { id: value }, select: { classId: true } })
      ).map((r) => r.classId);
    case 'code':
      return (
        await tx.classroom.findMany({
          where: { code: value.trim().toUpperCase() },
          select: { id: true },
        })
      ).map((r) => r.id);
    case 'submission': {
      const row = await tx.submission.findUnique({
        where: { id: value },
        select: { assignmentId: true },
      });
      return row ? classOf(tx, 'assignment', row.assignmentId) : [];
    }
    case 'discussion': {
      const row = await tx.discussion.findUnique({
        where: { id: value },
        select: { lessonId: true },
      });
      return row ? classOf(tx, 'lesson', row.lessonId) : [];
    }
  }
}

const processEpoch = randomUUID();
/**
 * A cheap fingerprint of everything that can change a user's state: their own
 * row, the change counters of every class they relate to and of global/account
 * writes. Equal fingerprints mean the state has not changed, so polling can
 * answer 304 without loading the state. Returns null without PostgreSQL.
 */
export async function stateFingerprint(userId: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const pg = await client();
  const [user, owned, enrolled] = await Promise.all([
    pg.user.findUnique({ where: { id: userId } }),
    pg.classroom.findMany({
      where: { OR: [{ teacherId: userId }, { teacherIds: { has: userId } }] },
      select: { id: true },
    }),
    pg.enrollment.findMany({ where: { userId }, select: { classId: true, status: true } }),
  ]);
  if (!user) return null;
  const classIds = [...new Set([...owned.map((c) => c.id), ...enrolled.map((e) => e.classId)])];
  const scopes = ['global', `user:${userId}`, ...classIds.map((id) => `class:${id}`)];
  const versions = await pg.$queryRaw<{ scope: string; version: bigint }[]>`
    SELECT "scope", "version" FROM "ChangeVersion" WHERE "scope" = ANY(${scopes})`;
  return JSON.stringify({
    epoch: processEpoch,
    user,
    enrolled: enrolled.sort((a, b) => a.classId.localeCompare(b.classId)),
    classIds: classIds.sort(),
    versions: versions
      .map((v) => `${v.scope}=${v.version}`)
      .sort()
      .join(','),
  });
}

// ---------------------------------------------------------------------------
// Audit trail: append-only, kept out of the per-request snapshot so it can grow freely.
// ---------------------------------------------------------------------------
export async function recordAudit(actorId: string, action: string, targetId?: string, detail = '') {
  const entry: AuditLog = {
    id: randomUUID(),
    actorId,
    action,
    ...(targetId ? { targetId } : {}),
    detail: detail.slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  try {
    if (process.env.DATABASE_URL)
      await (await client()).auditLog.create({ data: { ...entry, targetId: targetId ?? null } });
    else
      await withDatabase((db) => {
        db.auditLogs = [...(db.auditLogs ?? []), entry].slice(-2000);
      }, true);
  } catch (error) {
    // Never fail the action that was already performed because the log could not be written.
    console.error('Audit log write failed', error instanceof Error ? error.message : '');
  }
}
export async function listAudit(limit = 200): Promise<AuditLog[]> {
  if (!process.env.DATABASE_URL)
    return withDatabase((db) => [...(db.auditLogs ?? [])].reverse().slice(0, limit));
  const rows = await (
    await client()
  ).auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((row) => cleanRow<AuditLog>(row));
}
