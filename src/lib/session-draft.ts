'use client';

/**
 * Session storage is optional: private browsing or a full quota must not break editing.
 * Writes are debounced so typing does not JSON-serialise the whole form on every keystroke;
 * pending values are still returned by reads and flushed when the page is hidden.
 */
const DELAY = 400;
const pending = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();

function flush(key: string) {
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
  try {
    sessionStorage.setItem(key, JSON.stringify(entry.value));
  } catch {}
}
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => [...pending.keys()].forEach(flush));

export function readSessionDraft<T>(key: string): T | null {
  const queued = pending.get(key);
  if (queued) return queued.value as T;
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
export function writeSessionDraft(key: string, value: unknown) {
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  pending.set(key, { value, timer: setTimeout(() => flush(key), DELAY) });
}
export function removeSessionDraft(key: string) {
  const queued = pending.get(key);
  if (queued) clearTimeout(queued.timer);
  pending.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
