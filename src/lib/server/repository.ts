import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Database } from '@/lib/types';
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
async function readPostgres(tx: unknown): Promise<Database> {
  const db = {} as Database;
  await Promise.all(
    Object.entries(tables).map(async ([key, model]) => {
      (db as unknown as Record<string, unknown>)[key] = (
        await (tx as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[
          model
        ].findMany()
      ).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)));
    }),
  );
  return db;
}
async function writePostgres(tx: unknown, db: Database) {
  const api = tx as Record<
    string,
    { deleteMany: (v: unknown) => Promise<unknown>; upsert: (v: unknown) => Promise<unknown> }
  >;
  for (const [key, model] of Object.entries(tables).reverse()) {
    const rows = db[key as keyof Database];
    await api[model].deleteMany({ where: { id: { notIn: rows.map((r) => r.id) } } });
  }
  for (const [key, model] of Object.entries(tables)) {
    for (const row of db[key as keyof Database]) {
      const data = JSON.parse(JSON.stringify(row));
      const optional: Record<string, string[]> = {
        user: ['avatar'],
        authToken: ['consumedAt', 'pendingPasswordHash', 'pendingName'],
        lesson: ['videoFileId'],
        assignment: ['lessonId'],
        submission: ['submittedAt', 'score', 'gradedAt'],
      };
      for (const field of optional[model] || []) if (!(field in data)) data[field] = null;
      if (model === 'submission' && !('rubric' in data)) data.rubric = Prisma.DbNull;
      await api[model].upsert({ where: { id: row.id }, create: data, update: data });
    }
  }
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
        const result = await fn(db);
        if (write) await writePostgres(tx, db);
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
    await mkdir('.data', { recursive: true });
    let db: Database;
    try {
      db = JSON.parse(await readFile('.data/demo.json', 'utf8'));
    } catch (error) {
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
