import type { Database } from './types';

type StoredObject = { Key?: string; LastModified?: Date };
export function managedKeyParts(key: string) {
  const match =
    /^(?:verified\/)?classes\/([^/]+)\/[^/]+\/([0-9a-f-]{36})(?:-[0-9a-f]{32})?\.(?:pdf|docx|jpe?g|png|mp4|webm)$/i.exec(
      key,
    );
  return match ? { classId: match[1], fileId: match[2] } : undefined;
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
        managedKeyParts(file.key) &&
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
  const protectedIds = new Set(
    db.files.filter((file) => !stale.has(file.id)).map((file) => file.id),
  );
  return objects.flatMap((object) => {
    const key = object.Key || '';
    const parts = managedKeyParts(key);
    if (!parts) return [];
    if (
      !object.LastModified ||
      object.LastModified.getTime() > cutoff ||
      protectedKeys.has(key) ||
      protectedIds.has(parts.fileId)
    )
      return [];
    return [key];
  });
}

/** Run under the class write lock, after listing objects and before deleting rows. */
export function planClassStorageCleanup(
  db: Database,
  classId: string,
  keys: string[],
  observedKeys: Set<string>,
  oldKeys: Set<string>,
  existingFileIds: string[],
  cutoff: number,
) {
  const stale = new Set(staleUnreferencedFileIds(db, cutoff));
  const removedIds = db.files
    .filter((file) => {
      const parts = managedKeyParts(file.key);
      return (
        stale.has(file.id) &&
        parts?.classId === classId &&
        parts.fileId === file.id &&
        (oldKeys.has(file.key) || (!file.verified && !observedKeys.has(file.key)))
      );
    })
    .map((file) => file.id);
  const removed = new Set(removedIds);
  // A pending completion can write any version key for a surviving reservation.
  const protectedIds = new Set(existingFileIds.filter((id) => !removed.has(id)));
  return {
    removedIds,
    keys: keys.filter((key) => {
      const parts = managedKeyParts(key);
      return parts?.classId === classId && !protectedIds.has(parts.fileId);
    }),
  };
}
