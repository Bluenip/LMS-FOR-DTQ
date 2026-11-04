import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_PASSWORD } from '../src/lib/account-policy';
import {
  adminState,
  createManagedUser,
  requireAdmin,
  resetManagedPassword,
  updateManagedUser,
} from '../src/lib/server/admin';
import {
  accountEnabled,
  hashPassword,
  publicUser,
  sessionMatches,
  verifyPassword,
} from '../src/lib/server/auth';
import { seedData } from '../src/lib/server/seed-data';
import type { AuthToken, Database, StoredUser } from '../src/lib/types';
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
function fixture() {
  const db = structuredClone(initial);
  const admin: StoredUser = {
    id: 'admin-test',
    name: 'Quản trị viên',
    email: 'admin@example.com',
    role: 'TEACHER',
    passwordHash: hashPassword('Admin-2026'),
    emailVerified: true,
    isAdmin: true,
    isDemo: false,
    sessionVersion: 0,
  };
  db.users.push(admin);
  return { db, admin };
}
const input = { name: 'Giáo viên mới', email: 'teacher-new@example.com' };
const status = (code: number) => (error: unknown) =>
  !!error && typeof error === 'object' && 'status' in error && error.status === code;
test('admin endpoints require a current enabled administrator rather than merely a teacher role', () => {
  const { db, admin } = fixture();
  assert.throws(() => adminState(db, null), status(401));
  assert.throws(() => adminState(db, 'teacher-1'), status(403));
  assert.throws(() => createManagedUser(db, 'student-1', input), status(403));
  assert.equal(requireAdmin(db, admin.id).id, admin.id);
  admin.isAdmin = false;
  assert.throws(() => createManagedUser(db, admin.id, input), status(403));
  admin.isAdmin = true;
  admin.disabled = true;
  assert.throws(() => adminState(db, admin.id), status(401));
});
test('admin state projects safe account fields and counts actual records', () => {
  const { db, admin } = fixture();
  const snapshot = adminState(db, admin.id);
  assert.equal(snapshot.users.length, db.users.length);
  assert.equal(snapshot.summary.classes, db.classes.length);
  assert.equal(snapshot.summary.teachers, db.users.filter((u) => u.role === 'TEACHER').length);
  assert.equal(snapshot.summary.students, db.users.filter((u) => u.role === 'STUDENT').length);
  const teacher = snapshot.users.find((u) => u.id === 'teacher-1')!;
  assert.equal(teacher.classCount, 2);
  assert.equal(teacher.isDemo, true);
  for (const user of snapshot.users)
    for (const key of ['passwordHash', 'sessionVersion', 'authTokens', 'pendingPasswordHash'])
      assert.equal(key in user, false);
  assert.equal(publicUser(admin).isAdmin, true);
});
test('creating managed accounts uses unique temporary passwords and requires a change', () => {
  const { db, admin } = fixture();
  const issued = new Set<string>();
  for (const role of ['TEACHER', 'STUDENT'] as const) {
    const email = `${role.toLowerCase()}-new@example.com`;
    const result = createManagedUser(db, admin.id, {
      ...input,
      email: `  ${email.toUpperCase()} `,
      role,
    });
    assert.equal(result.user.role, role);
    assert.equal(result.user.email, email);
    assert.equal(result.user.emailVerified, true);
    assert.equal(result.user.isAdmin, false);
    assert.equal(result.user.disabled, false);
    assert.equal(result.user.isDemo, false);
    const stored = db.users.find((u) => u.id === result.user.id)!;
    assert.equal(verifyPassword(result.temporaryPassword, stored.passwordHash), true);
    assert.equal(verifyPassword(DEFAULT_ACCOUNT_PASSWORD, stored.passwordHash), false);
    assert.equal(stored.mustChangePassword, true);
    issued.add(result.temporaryPassword);
    assert.equal('passwordHash' in result.user, false);
    assert.equal('password' in result, false);
    assert.equal(accountEnabled(stored), true);
    assert.throws(
      () => createManagedUser(db, admin.id, { ...input, email: email.toUpperCase() }),
      status(409),
    );
  }
  assert.equal(issued.size, 2);
  assert.equal(
    createManagedUser(db, admin.id, { ...input, email: 'default-role@example.com' }).user.role,
    'TEACHER',
  );
});
test('creation rejects privilege injection, unsupported roles and caller-selected passwords', () => {
  const { db, admin } = fixture();
  const count = db.users.length;
  for (const extra of [
    { isAdmin: true },
    { role: 'ADMIN' },
    { role: 'UNKNOWN' },
    { disabled: false },
    { emailVerified: true },
    { password: 'HocDao26' },
    { confirmPassword: DEFAULT_ACCOUNT_PASSWORD },
  ])
    assert.throws(() => createManagedUser(db, admin.id, { ...input, ...extra }));
  assert.equal(db.users.length, count);
});
test('locking a teacher preserves classes and submissions while revoking sessions and pending tokens', () => {
  const { db, admin } = fixture();
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const classes = structuredClone(db.classes),
    submissions = structuredClone(db.submissions);
  createAuthToken(db, teacher.id, 'RESET_PASSWORD');
  const previousVersion = teacher.sessionVersion ?? 0;
  updateManagedUser(db, admin.id, teacher.id, { disabled: true });
  assert.equal(accountEnabled(teacher), false);
  assert.equal(sessionMatches(teacher, { id: teacher.id, version: previousVersion }), false);
  assert.deepEqual(db.classes, classes);
  assert.deepEqual(db.submissions, submissions);
  assert.equal(
    db.authTokens.some((t) => t.userId === teacher.id),
    false,
  );
  updateManagedUser(db, admin.id, teacher.id, { disabled: false });
  assert.equal(accountEnabled(teacher), true);
  assert.equal(sessionMatches(teacher, { id: teacher.id, version: previousVersion }), false);
  assert.equal(teacher.sessionVersion, previousVersion + 2);
});
test('renaming preserves identity, login email, password and session version', () => {
  const { db, admin } = fixture();
  const { user } = createManagedUser(db, admin.id, input);
  const stored = db.users.find((u) => u.id === user.id)!;
  const original = structuredClone(stored);
  const result = updateManagedUser(db, admin.id, user.id, { name: '  Giáo viên tên mới  ' });
  assert.equal(result.user.name, 'Giáo viên tên mới');
  assert.deepEqual({ ...stored, name: original.name }, original);
});
test('administrator resets generate a new temporary password and revoke old sessions and tokens', () => {
  const { db, admin } = fixture();
  const { user } = createManagedUser(db, admin.id, input);
  const stored = db.users.find((u) => u.id === user.id)!;
  stored.passwordHash = hashPassword('Personal26');
  createAuthToken(db, user.id, 'RESET_PASSWORD');
  const oldVersion = stored.sessionVersion ?? 0;
  assert.throws(() => resetManagedPassword(db, admin.id, user.id, { password: 'HocDao27' }));
  assert.throws(() =>
    resetManagedPassword(db, admin.id, user.id, { confirmPassword: DEFAULT_ACCOUNT_PASSWORD }),
  );
  const result = resetManagedPassword(db, admin.id, user.id, {});
  assert.equal(verifyPassword(result.temporaryPassword, stored.passwordHash), true);
  assert.equal(stored.mustChangePassword, true);
  assert.equal(verifyPassword('Personal26', stored.passwordHash), false);
  assert.equal(sessionMatches(stored, { id: stored.id, version: oldVersion }), false);
  assert.equal(
    db.authTokens.some((t) => t.userId === user.id),
    false,
  );
  assert.deepEqual(Object.keys(result).sort(), ['message', 'temporaryPassword']);
});
test('admin accounts cannot be locked, activated or reset through account management', () => {
  const { db, admin } = fixture();
  const other = { ...admin, id: randomUUID(), email: 'another-admin@example.com' };
  db.users.push(other);
  for (const target of [admin, other]) {
    for (const payload of [{ disabled: true }, { disabled: false }, { emailVerified: true }])
      assert.throws(() => updateManagedUser(db, admin.id, target.id, payload), status(403));
    assert.throws(() => resetManagedPassword(db, admin.id, target.id, {}), status(403));
    assert.equal(target.disabled === true, false);
  }
});
test('student accounts can be renamed, reset and locked without losing enrollment history', () => {
  const { db, admin } = fixture();
  const { user } = createManagedUser(db, admin.id, {
    ...input,
    email: 'student-new@example.com',
    role: 'STUDENT',
  });
  const student = db.users.find((u) => u.id === user.id)!;
  db.enrollments.push({
    id: randomUUID(),
    classId: 'dtq-2026',
    userId: student.id,
    status: 'APPROVED',
    group: 1,
    joinedAt: new Date().toISOString(),
  });
  const enrollment = structuredClone(db.enrollments);
  updateManagedUser(db, admin.id, student.id, { name: 'Học viên mới' });
  assert.equal(student.name, 'Học viên mới');
  student.passwordHash = hashPassword('Personal26');
  const version = student.sessionVersion ?? 0;
  const reset = resetManagedPassword(db, admin.id, student.id, {});
  assert.equal(verifyPassword(reset.temporaryPassword, student.passwordHash), true);
  assert.equal(student.mustChangePassword, true);
  assert.equal(sessionMatches(student, { id: student.id, version }), false);
  updateManagedUser(db, admin.id, student.id, { disabled: true });
  assert.equal(accountEnabled(student), false);
  updateManagedUser(db, admin.id, student.id, { disabled: false });
  assert.equal(accountEnabled(student), true);
  assert.deepEqual(db.enrollments, enrollment);
});
test('updates reject unknown sensitive fields before changing data', () => {
  const { db, admin } = fixture();
  const teacher = db.users.find((u) => u.id === 'teacher-1')!;
  const before = structuredClone(teacher);
  for (const payload of [
    { email: 'new@example.com' },
    { role: 'STUDENT' },
    { isAdmin: true },
    { passwordHash: 'forged' },
    { emailVerified: false },
    {},
  ])
    assert.throws(() => updateManagedUser(db, admin.id, teacher.id, payload));
  assert.deepEqual(teacher, before);
  assert.throws(() => resetManagedPassword(db, admin.id, teacher.id, { isAdmin: true }));
  assert.throws(
    () => updateManagedUser(db, admin.id, 'missing-user', { name: 'Someone' }),
    status(404),
  );
});
test('activating legacy pending accounts revokes old sessions and tokens without changing role or password', () => {
  const { db, admin } = fixture();
  const student = db.users.find((u) => u.id === 'student-1')!;
  student.emailVerified = false;
  const hash = student.passwordHash,
    version = student.sessionVersion ?? 0;
  createAuthToken(db, student.id, 'VERIFY_EMAIL');
  createAuthToken(db, student.id, 'RESET_PASSWORD');
  assert.throws(() => updateManagedUser(db, admin.id, student.id, { emailVerified: false }));
  const result = updateManagedUser(db, admin.id, student.id, { emailVerified: true });
  assert.equal(result.user.emailVerified, true);
  assert.equal(student.role, 'STUDENT');
  assert.equal(student.passwordHash, hash);
  assert.equal(accountEnabled(student), true);
  assert.equal(student.sessionVersion, version + 1);
  assert.equal(
    db.authTokens.some((t) => t.userId === student.id),
    false,
  );
  assert.equal(sessionMatches(student, { id: student.id, version }), false);
});
