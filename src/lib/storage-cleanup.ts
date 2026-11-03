import type { Database } from './types';

type StoredObject = { Key?: string; LastModified?: Date };
function managedKey(key: string) {
  return /^(verified\/)?classes\/[^/]+\/[^/]+\/[0-9a-f-]{36}(?:-[0-9a-f]{32})?\.(pdf|docx|jpe?g|png|mp4|webm)$/i.test(
    key,
  );
}
function referencedFileIds(db: Database) {
  return new Set(
    [
      ...db.lessons.flatMap((lesson) => [
        lesson.videoFileId,
        ...lesson.documents.map((item) => item.id),
      ]),
      ...db.submissions.flatMap((submission) => submission.attachments.map((item) => item.id)),
    ].filter((id): id is string => !!id),
  );
}
/** Includes failed reservations for which no object was ever written. */
export function staleUnreferencedFileIds(db: Database, cutoff: number) {
  const referenced = referencedFileIds(db);
  return db.files
    .filter((file) => {
      const created = Date.parse(file.createdAt);
      return (
        managedKey(file.key) &&
        !referenced.has(file.id) &&
        Number.isFinite(created) &&
        created <= cutoff
      );
    })
    .map((file) => file.id);
}
/** Restrict cleanup to old, unreferenced objects created under the LMS namespace. */
export function orphanedStorageKeys(db: Database, objects: StoredObject[], cutoff: number) {
  const stale = new Set(staleUnreferencedFileIds(db, cutoff));
  const protectedKeys = new Set(
    db.files.filter((file) => !stale.has(file.id)).map((file) => file.key),
  );
  return objects.flatMap((object) => {
    const key = object.Key || '';
    if (!managedKey(key)) return [];
    if (!object.LastModified || object.LastModified.getTime() > cutoff || protectedKeys.has(key))
      return [];
    return [key];
  });
}
