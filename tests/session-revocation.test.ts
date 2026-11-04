import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { revokeSession, findSessionUser } from '../src/lib/server/repository';
import { readSession, sessionMatches, signSession } from '../src/lib/server/auth';

test('logout revokes copied cookies and other devices, while replay cannot revoke a newer login', async () => {
  const cwd = process.cwd();
  const database = process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'lms-logout-'));
  try {
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = 'test-logout-secret-with-at-least-32-characters';
    process.chdir(dir);
    const first = await readSession(await signSession('student-1', 0));
    assert(first);
    assert(sessionMatches(await findSessionUser(first.id), first));
    await revokeSession(first);
    assert(!sessionMatches(await findSessionUser(first.id), first));
    const second = await readSession(await signSession(first.id, 1));
    assert(second);
    await revokeSession(first);
    assert(sessionMatches(await findSessionUser(second.id), second));
  } finally {
    process.chdir(cwd);
    if (database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = database;
    await rm(dir, { recursive: true, force: true });
  }
});
