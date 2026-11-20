import { redirect } from 'next/navigation';
import { needsPasswordChange, sessionUserId } from './auth';
import { findSessionUser } from './repository';

/** Where a signed-in user lands; matches the redirect after login. */
export async function signedInHomePath(): Promise<string | null> {
  const id = await sessionUserId();
  if (!id) return null;
  const user = await findSessionUser(id);
  if (!user) return null;
  if (needsPasswordChange(user)) return '/profile';
  if (user.isAdmin) return '/admin';
  return user.role === 'TEACHER' ? '/teacher/classes' : '/classes';
}

/** Public entry pages send an already signed-in visitor to their home instead. */
export async function redirectIfSignedIn() {
  const path = await signedInHomePath();
  if (path) redirect(path);
}
