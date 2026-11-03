'use client';

/** Session storage is optional: private browsing or a full quota must not break editing. */
export function readSessionDraft<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
export function writeSessionDraft(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export function removeSessionDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
