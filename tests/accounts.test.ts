import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../src/lib/server/seed-data';
import { accountEnabled, publicUser, readSession, signSession } from '../src/lib/server/auth';

const original = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
const initial = seedData();
const fixture = () => structuredClone(initial);

test('signed session versions are preserved and tampering is rejected', async () => {
  process.env.SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
  const signed = await signSession('learner', 7);
  assert.deepEqual(await readSession(signed), { id: 'learner', version: 7 });
  assert.equal(await readSession(signed + 'x'), null);
});

test('legacy accounts remain readable while production sample accounts require explicit opt-in', () => {
  const user = fixture().users[0];
  delete user.emailVerified;
  delete user.sessionVersion;
  delete user.isDemo;
  delete process.env.DATABASE_URL;
  assert.equal(accountEnabled(user), true);
  process.env.DATABASE_URL = 'postgres://unused';
  delete process.env.ALLOW_DEMO_ACCOUNTS;
  assert.equal(accountEnabled(user), false);
  process.env.ALLOW_DEMO_ACCOUNTS = 'true';
  assert.equal(accountEnabled(user), true);
  assert.deepEqual(Object.keys(publicUser(user)).sort(), ['email', 'id', 'name', 'role']);
});
