import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Runs against a REAL PostgreSQL, only when TEST_DATABASE_URL points at a local database whose
 * migrations are applied (the tables are truncated first):
 *   docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=lms postgres:17-alpine
 *   DATABASE_URL=postgresql://postgres:test@localhost:55432/lms npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/lms npm test
 */
const url = process.env.TEST_DATABASE_URL;
const local = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url ?? '').hostname);
  } catch {
    return false;
  }
})();
const skip = !url ? 'TEST_DATABASE_URL not set' : !local ? 'refusing a non-local database' : false;
if (url && local) process.env.DATABASE_URL = url;

test(
  'PostgreSQL: shared counters, account lookup, audit trail and the new tables',
  { skip },
  async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$executeRawUnsafe(
      'TRUNCATE "User", "Classroom", "RateLimitEntry", "DriveTrash", "AuditLog", "DriveConnection" CASCADE',
    );
    await prisma.$disconnect();

    const repository = await import('../src/lib/server/repository');
    const { runAction, stateFor } = await import('../src/lib/server/actions');
    const { SharedRateLimit } = await import('../src/lib/server/rate-limit');
    await repository.seedPostgres();

    // --- account lookup: one indexed query, case-insensitive
    const found = await repository.findUserByEmail('TEACHER@detuquy.VN');
    assert.equal(found?.id, 'teacher-1');
    assert.equal(await repository.findUserByEmail('nobody@example.com'), undefined);

    // --- atomic shared counter (fixed window)
    const now = Date.now();
    assert.equal(await repository.bumpCounter('k', 1000, now), 1);
    assert.equal(await repository.bumpCounter('k', 1000, now + 10), 2);
    assert.equal(await repository.bumpCounter('k', 1000, now + 2000), 1, 'a new window restarts');
    await repository.clearCounter('k');
    assert.equal(await repository.bumpCounter('k', 1000, now), 1);

    // --- two app instances (separate limiter objects) share one budget
    const a = new SharedRateLimit('pg-test', 3, 60000, 'chặn');
    const b = new SharedRateLimit('pg-test', 3, 60000, 'chặn');
    await a.consume('ip:email');
    await b.consume('ip:email');
    await a.consume('ip:email');
    await assert.rejects(b.consume('ip:email'), { status: 429 });
    await a.reset('ip:email');
    await b.consume('ip:email');

    // --- concurrent increments never lose a count
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => repository.bumpCounter('race', 60000)),
    );
    assert.deepEqual(
      [...counts].sort((x, y) => (x as number) - (y as number)),
      Array.from({ length: 20 }, (_, i) => i + 1),
    );

    // --- audit trail lives outside the snapshot
    await repository.recordAudit('teacher-1', 'drive.connect', undefined, 'account=x@example.com');
    await repository.recordAudit('teacher-1', 'user.create', 'student-1', 'role=STUDENT');
    const audit = await repository.listAudit(10);
    assert.deepEqual(
      audit.map((e) => e.action),
      ['user.create', 'drive.connect'],
    );

    // --- new columns/tables round-trip through the snapshot writer
    await repository.withDatabase((db) => {
      const teacher = db.users.find((u) => u.id === 'teacher-1')!;
      const classroom = runAction(db, teacher, {
        action: 'createClass',
        title: 'Lớp PG',
        autoApprove: true,
      }) as {
        id: string;
        code: string;
      };
      runAction(
        db,
        db.users.find((u) => u.id === 'student-1')!,
        { action: 'joinClass', code: classroom.code },
      );
      runAction(db, teacher, {
        action: 'createAssignment',
        classId: classroom.id,
        title: 'Bài PG',
        instructions: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      });
      db.driveConnections.push({
        id: 'shared',
        connectedById: 'teacher-1',
        email: 'drive@example.com',
        encryptedRefreshToken: 'v1.x.y.z',
        scope: 'https://www.googleapis.com/auth/drive.file',
        status: 'ACTIVE',
        folderId: 'folder-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      db.driveTrash.push({ id: 'trash-0123456789', createdAt: new Date().toISOString() });
    }, true);
    const saved = await repository.withDatabase((db) => ({
      announced: !!db.assignments.find((x) => x.title === 'Bài PG')?.announcedAt,
      trash: db.driveTrash.map((t) => t.id),
      folder: db.driveConnections[0]?.folderId,
    }));
    // Timestamps are real timestamptz columns but still reach the app as ISO-8601 strings.
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const stamps = await repository.withDatabase((db) => [
      ...db.classes.map((c) => c.createdAt),
      ...db.assignments.map((x) => x.dueAt),
      ...db.driveConnections.map((c) => c.updatedAt),
    ]);
    assert.ok(
      stamps.length >= 3 && stamps.every((v) => typeof v === 'string' && iso.test(v)),
      String(stamps),
    );
    const scopedClass = await repository.withScopedState('student-1', (db) => db.classes[0]);
    assert.match(scopedClass.createdAt, iso);
    assert.match((await repository.listAudit(1))[0].createdAt, iso);
    assert.equal(saved.announced, true, 'announcedAt persisted');
    assert.deepEqual(saved.trash, ['trash-0123456789']);
    assert.equal(saved.folder, 'folder-1');

    // --- the scoped state used by /api/state knows whether Drive is connected
    process.env.GOOGLE_CLIENT_ID = 'x';
    process.env.GOOGLE_CLIENT_SECRET = 'y';
    const state = await repository.withScopedState('student-1', (db) =>
      stateFor(
        db,
        db.users.find((u) => u.id === 'student-1')!,
      ),
    );
    assert.equal(state.storageConfigured, true);
    await repository.withDatabase((db) => {
      db.driveConnections[0].status = 'DISCONNECTED';
      db.driveTrash = [];
    }, true);
    const after = await repository.withScopedState('student-1', (db) =>
      stateFor(
        db,
        db.users.find((u) => u.id === 'student-1')!,
      ),
    );
    assert.equal(after.storageConfigured, false);
    assert.equal(
      await repository.withDatabase((db) => db.driveTrash.length),
      0,
      'row deletion persisted',
    );
  },
);
