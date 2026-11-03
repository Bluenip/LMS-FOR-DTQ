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
        tx.notification.findMany({ where: { userId } }),
      ]);
      const lessonIds = lessons.map((l) => l.id);
      const managedLessons = lessons.filter((l) => managed.includes(l.classId)).map((l) => l.id);
      const managedAssignments = assignments
        .filter((a) => managed.includes(a.classId))
        .map((a) => a.id);
      const [submissions, progress, notes, discussions, users] = await Promise.all([
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
        tx.user.findMany({
          where: {
            id: {
              in: [
                ...new Set([
                  userId,
                  ...classrooms.map((c) => c.teacherId),
                  ...classrooms.flatMap((c) => c.teacherIds),
                  ...enrollments.map((e) => e.userId),
                ]),
              ],
            },
          },
        }),
      ]);
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
const ALL_TABLES = Object.keys(tables) as TableKey[];
const NOT_LOADED = (key: string) =>
  new Proxy([] as never[], {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      throw new Error(
        `Table "${key}" was not loaded for this operation. Add it to the operation's table list.`,
      );
    },
  });
/**
 * Tables an operation did not ask for are replaced by a stand-in that throws on any access, so a
 * missing declaration fails loudly (and rolls the transaction back) instead of silently acting on
 * an empty table.
 */
function withoutUnused(db: Database, needs: readonly TableKey[] | undefined) {
  const hidden: Partial<Record<TableKey, unknown>> = {};
  if (needs)
    for (const key of ALL_TABLES)
      if (!needs.includes(key)) {
        hidden[key] = (db as unknown as Record<string, unknown>)[key];
        (db as unknown as Record<string, unknown>)[key] = NOT_LOADED(key);
      }
  return () => {
    for (const [key, rows] of Object.entries(hidden))
      (db as unknown as Record<string, unknown>)[key] = rows;
  };
}
type Rows = { id: string }[];
async function readPostgres(tx: unknown, needs?: readonly TableKey[]): Promise<Database> {
  const db = {} as Database;
  const wanted = needs ?? ALL_TABLES;
  await Promise.all(
    (Object.entries(tables) as [TableKey, string][]).map(async ([key, model]) => {
      if (!wanted.includes(key)) {
        (db as unknown as Record<string, unknown>)[key] = NOT_LOADED(key);
        return;
      }
      (db as unknown as Record<string, unknown>)[key] = (
        await (tx as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[
          model
        ].findMany()
      ).map((row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(
              ([field, value]) => value !== null || (key === 'assignments' && field === 'maxWords'),
            )
            .map(([field, value]) => [field, plain(value)]),
        ),
      );
    }),
  );
  return db;
}
async function writePostgres(tx: unknown, db: Database, previous: Record<string, Rows>) {
  const api = tx as Record<
    string,
    { deleteMany: (v: unknown) => Promise<unknown>; upsert: (v: unknown) => Promise<unknown> }
  >;
  // Only tables that were loaded take part (the optional audit trail is outside the snapshot).
  const table = (key: string) => (db as unknown as Record<string, Rows>)[key];
  const loaded = (Object.entries(tables) as [TableKey, string][]).filter(
    ([key]) => key in previous,
  );
  for (const [key, model] of [...loaded].reverse()) {
    const currentIds = new Set(table(key).map((row) => row.id));
    const removed = previous[key].filter((row) => !currentIds.has(row.id)).map((row) => row.id);
    if (removed.length) await api[model].deleteMany({ where: { id: { in: removed } } });
  }
  for (const [key, model] of loaded) {
    const original = new Map(previous[key].map((row) => [row.id, JSON.stringify(row)]));
    for (const row of table(key)) {
      if (original.get(row.id) === JSON.stringify(row)) continue;
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
      await api[model].upsert({ where: { id: row.id }, create: data, update: data });
    }
  }
}
/**
 * Runs `fn` against a snapshot of the data. With `needs`, only those tables are loaded (and, for
 * writes, diffed and saved); the rest cannot be touched. Without it every table is loaded.
 * Reading and diffing everything made each write take ~450 ms with ~35k rows, and writes are
 * serialised, so large tables must not be read by operations that never use them.
 */
export async function withDatabase<T>(
  fn: (db: Database) => T | Promise<T>,
  write = false,
  needs?: readonly TableKey[],
): Promise<T> {
  if (process.env.DATABASE_URL) {
    const pg = await client();
    return pg.$transaction(
      async (tx) => {
        if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719823)`;
        const db = await readPostgres(tx, needs);
        const previous = write
          ? Object.fromEntries(
              (needs ?? ALL_TABLES).map((key) => [
                key,
                structuredClone((db as unknown as Record<string, Rows>)[key]),
              ]),
            )
          : undefined;
        const result = await fn(db);
        if (write && previous) await writePostgres(tx, db, previous);
        return result;
      },
      { maxWait: 10000, timeout: 30000 },
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
    // The JSON file is always read whole, but the same guards apply so that tests running in this
    // mode catch an operation using a table it did not declare.
    const restore = withoutUnused(db, needs);
    let result: T;
    try {
      result = await fn(db);
    } finally {
      restore();
    }
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

/** Case-insensitive lookup of one account; avoids loading the whole database to log in. */
export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  if (!process.env.DATABASE_URL)
    return withDatabase((db) =>
      db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()),
    );
  const row = await (
    await client()
  ).user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  return row ? cleanRow<StoredUser>(row) : undefined;
}

/**
 * Atomically increments a fixed-window counter shared by every app instance.
 * Returns null in demo (JSON) mode, where callers fall back to their in-memory limiter.
 */
export async function bumpCounter(key: string, windowMs: number, now = Date.now()) {
  if (!process.env.DATABASE_URL) return null;
  const pg = await client();
  const reset = BigInt(now + windowMs);
  const rows = await pg.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitEntry" ("key", "count", "resetAt") VALUES (${key}, 1, ${reset}::bigint)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitEntry"."resetAt" <= ${BigInt(now)}::bigint THEN 1 ELSE "RateLimitEntry"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitEntry"."resetAt" <= ${BigInt(now)}::bigint THEN ${reset}::bigint ELSE "RateLimitEntry"."resetAt" END
    RETURNING "count"`;
  // Housekeeping: expired windows are useless; trim them now and then.
  if (Math.random() < 0.01)
    await pg.$executeRaw`DELETE FROM "RateLimitEntry" WHERE "resetAt" <= ${BigInt(now)}::bigint`;
  return Number(rows[0].count);
}
export async function clearCounter(key: string) {
  if (!process.env.DATABASE_URL) return;
  await (
    await client()
  ).$executeRaw`DELETE FROM "RateLimitEntry" WHERE "key" = ${key}`;
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
