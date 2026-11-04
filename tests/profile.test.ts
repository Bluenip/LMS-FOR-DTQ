import test from 'node:test';
import assert from 'node:assert/strict';
import { getProfile, updateProfile } from '../src/lib/server/profile';
import { hashPassword, sessionMatches, verifyPassword } from '../src/lib/server/auth';
import { randomUUID } from 'node:crypto';
import type { AuthToken, Database } from '../src/lib/types';
import { seedData } from '../src/lib/server/seed-data';
function createAuthToken(db: Database, userId: string, purpose: AuthToken['purpose']) {
  const now = Date.now();
  db.authTokens.push({
    id: randomUUID(),
    userId,
    tokenHash: randomUUID().replace(/-/g, ''),
    purpose,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
  });
}
const initial = seedData();
const fixture = () => structuredClone(initial);
const status = (code: number) => (error: unknown) =>
  !!error && typeof error === 'object' && 'status' in error && error.status === code;
test('profile requires an enabled authenticated account', () => {
  const db = fixture();
  assert.throws(() => getProfile(db, null), status(401));
  assert.throws(() => updateProfile(db, null, { name: 'Someone' }), status(401));
  db.users[1].disabled = true;
  assert.throws(() => updateProfile(db, db.users[1].id, { name: 'Someone' }), status(401));
});
test('all supported roles and administrators can rename themselves without changing account identity or permissions', () => {
  for (const kind of ['teacher', 'student', 'admin']) {
    const db = fixture();
    const user = kind === 'student' ? db.users[1] : db.users[0];
    if (kind === 'admin') user.isAdmin = true;
    const original = structuredClone(user);
    const result = updateProfile(db, user.id, { name: '  Tên mới  ' });
    assert.equal(result.user.name, 'Tên mới');
    assert.equal(result.passwordChanged, false);
    assert.deepEqual({ ...user, name: original.name }, original);
    assert.equal(result.user.email, original.email);
    assert.equal(result.user.role, original.role);
    assert.equal(result.user.isAdmin === true, original.isAdmin === true);
    assert.equal('passwordHash' in result.user, false);
    assert.equal('sessionVersion' in result.user, false);
  }
});
test('eight-character new passwords require the current password and matching confirmation', () => {
  const db = fixture();
  const user = db.users[1];
  const original = structuredClone(user);
  for (const payload of [
    { newPassword: 'HocDao27', confirmPassword: 'HocDao27' },
    { currentPassword: 'wrong-password', newPassword: 'HocDao27', confirmPassword: 'HocDao27' },
    { currentPassword: 'Demo@2026', newPassword: 'Short77', confirmPassword: 'Short77' },
    { currentPassword: 'Demo@2026', newPassword: 'HocDao27', confirmPassword: 'NotMatch' },
    { currentPassword: 'Demo@2026', newPassword: 'HocDao27' },
  ])
    assert.throws(() => updateProfile(db, user.id, { name: 'Should not change', ...payload }));
  assert.deepEqual(user, original);
});
test('password changes keep account privileges, revoke other sessions and invalidate pending tokens', () => {
  const db = fixture();
  const user = db.users[0];
  user.isAdmin = true;
  const version = user.sessionVersion ?? 0;
  createAuthToken(db, user.id, 'RESET_PASSWORD');
  const result = updateProfile(db, user.id, {
    currentPassword: 'Demo@2026',
    newPassword: 'HocDao27',
    confirmPassword: 'HocDao27',
  });
  assert.equal(result.passwordChanged, true);
  assert.equal(verifyPassword('HocDao27', user.passwordHash), true);
  assert.equal(verifyPassword('Demo@2026', user.passwordHash), false);
  assert.equal(sessionMatches(user, { id: user.id, version }), false);
  assert.equal(sessionMatches(user, { id: user.id, version: result.sessionVersion }), true);
  assert.equal(
    db.authTokens.some((t) => t.userId === user.id),
    false,
  );
  assert.equal(user.isAdmin, true);
  assert.equal(user.role, 'TEACHER');
  assert.equal(result.user.email, user.email);
});
test('a new password must differ from the current one', () => {
  const db = fixture();
  const user = db.users[1];
  assert.throws(
    () =>
      updateProfile(db, user.id, {
        currentPassword: 'Demo@2026',
        newPassword: 'Demo@2026',
        confirmPassword: 'Demo@2026',
      }),
    /khác mật khẩu/,
  );
});
test('profile updates reject privilege injection, another account id, email changes and incomplete password payloads', () => {
  const db = fixture();
  const user = db.users[1];
  const before = structuredClone(user);
  for (const payload of [
    { name: 'Someone', isAdmin: true },
    { name: 'Someone', role: 'TEACHER' },
    { name: 'Someone', email: 'other@example.com' },
    { name: 'Someone', userId: 'teacher-1' },
    { currentPassword: 'Demo@2026' },
    { name: 'Someone', confirmPassword: 'HocDao27' },
    {},
  ])
    assert.throws(() => updateProfile(db, user.id, payload));
  assert.deepEqual(user, before);
});
test('profile GET excludes authentication secrets', () => {
  const db = fixture();
  const result = getProfile(db, 'student-1');
  for (const key of ['passwordHash', 'sessionVersion', 'isDemo', 'disabled', 'emailVerified'])
    assert.equal(key in result.user, false);
  assert.equal(result.user.id, 'student-1');
});
