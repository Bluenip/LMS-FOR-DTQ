import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Database, StoredUser } from '@/lib/types';
import { seedData } from './seed-data';
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
} as const;
async function client() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}
function cleanRow<T>(row: unknown): T {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).filter(([, value]) => value !== null),
  ) as T;
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

/** Revoke all copies of this session version, including cookies on other devices. */
export async function revokeSession(session: { id: string; version: number }) {
  if (process.env.DATABASE_URL) {
    return (await client()).$transaction(
      async (tx) => {
        // Use the same lock as snapshot writers so an in-flight user update cannot
        // write an older session version back after revocation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(42719823)`;
        await tx.user.updateMany({
          where: { id: session.id, sessionVersion: session.version },
          data: { sessionVersion: { increment: 1 } },
        });
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
  if (!userId)
    return fn({
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
    });
  if (!process.env.DATABASE_URL) return withDatabase(fn);
  const pg = await client();
  return pg.$transaction(
    async (tx) => {
      const userRow = await tx.user.findUnique({ where: { id: userId } });
      if (!userRow)
        return fn({
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
        });
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
      } as Database);
    },
    {
      maxWait: 10000,
      timeout: 30000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}
async function readPostgres(tx: unknown): Promise<Database> {
  const db = {} as Database;
  await Promise.all(
    Object.entries(tables).map(async ([key, model]) => {
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
  return Object.fromEntries(
    Object.entries(row).filter(
      ([field, value]) => value !== null || (key === 'assignments' && field === 'maxWords'),
    ),
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
    const rows = db[key as keyof Database];
    const currentIds = new Set(rows.map((row) => row.id));
    const removed = previous[key as keyof Database]
      .filter((row) => !currentIds.has(row.id))
      .map((row) => row.id);
    if (removed.length) {
      changed = true;
      await api[model].deleteMany({ where: { id: { in: removed } } });
    }
  }
  for (const [key, model] of Object.entries(tables)) {
    const original = new Map(
      previous[key as keyof Database].map((row) => [row.id, JSON.stringify(row)]),
    );
    for (const row of db[key as keyof Database]) {
      const before = original.get(row.id);
      if (before === JSON.stringify(row)) continue;
      changed = true;
      const data = JSON.parse(JSON.stringify(row));
      const optional: Record<string, string[]> = {
        user: ['avatar'],
        authToken: ['consumedAt', 'pendingPasswordHash', 'pendingName'],
        lesson: ['videoFileId'],
        assignment: ['lessonId', 'maxWords'],
        notification: ['assignmentId'],
        discussion: ['updatedAt'],
        submission: ['submittedAt', 'score', 'gradedAt'],
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
    await mkdir('.data', { recursive: true });
    let db: Database;
    try {
      db = JSON.parse(await readFile('.data/demo.json', 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error(
          'Tệp .data/demo.json không hợp lệ. Hãy khôi phục bản sao lưu hoặc xóa tệp để tạo lại dữ liệu demo.',
          { cause: error },
        );
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      db = seedData();
      await writeFile('.data/demo.json', JSON.stringify(db, null, 2), { mode: 0o600 });
    }
    db.authTokens ??= [];
    for (const user of db.users) {
      user.emailVerified ??= true;
      user.sessionVersion ??= 0;
      user.isAdmin ??= false;
      user.disabled ??= false;
    }
    const result = await fn(db);
    if (write) {
      const temp = `.data/demo-${randomUUID()}.json`;
      await writeFile(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
      await rename(temp, '.data/demo.json');
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

export type DataScope = { classIds: string[]; userIds?: string[] };
export type ScopeResolver = (tx: Prisma.TransactionClient) => Promise<DataScope>;
const emptyDatabase = (): Database => ({
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
});
async function readScoped(
  tx: Prisma.TransactionClient,
  actorId: string,
  classIds: string[],
  extraUserIds: string[],
): Promise<Database> {
  const rows = <T>(key: string, list: T[]) =>
    list.map((row) => cleanTableRow(key, row as Record<string, unknown>));
  const classes = classIds.length
    ? await tx.classroom.findMany({ where: { id: { in: classIds } } })
    : [];
  const ids = classes.map((c) => c.id);
  const [enrollments, lessons, assignments, files] = await Promise.all([
    tx.enrollment.findMany({ where: { classId: { in: ids } } }),
    tx.lesson.findMany({ where: { classId: { in: ids } } }),
    tx.assignment.findMany({ where: { classId: { in: ids } } }),
    tx.storedFile.findMany({ where: { OR: [{ classId: { in: ids } }, { ownerId: actorId }] } }),
  ]);
  const lessonIds = lessons.map((l) => l.id);
  const assignmentIds = assignments.map((a) => a.id);
  const [submissions, progress, notes, discussions, notifications] = await Promise.all([
    tx.submission.findMany({ where: { assignmentId: { in: assignmentIds } } }),
    tx.progress.findMany({ where: { lessonId: { in: lessonIds } } }),
    tx.note.findMany({ where: { lessonId: { in: lessonIds } } }),
    tx.discussion.findMany({ where: { lessonId: { in: lessonIds } } }),
    tx.notification.findMany({
      where: { OR: [{ userId: actorId }, { assignmentId: { in: assignmentIds } }] },
    }),
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
      const db = await readScoped(tx, actorId, classIds, scope.userIds || []);
      const previous = write ? structuredClone(db) : undefined;
      const result = await fn(db);
      if (write && previous && (await writePostgres(tx, db, previous))) {
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
