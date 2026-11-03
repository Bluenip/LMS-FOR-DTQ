import type { Database } from './types';

type StoredObject = { Key?: string; LastModified?: Date };
/** Restrict cleanup to old, unreferenced objects created under the LMS namespace. */
export function orphanedStorageKeys(db: Database, objects: StoredObject[], cutoff: number) {
  const referenced = new Set(
    [
      ...db.lessons.flatMap((lesson) => [
        lesson.videoFileId,
        ...lesson.documents.map((item) => item.id),
      ]),
      ...db.submissions.flatMap((submission) => submission.attachments.map((item) => item.id)),
    ].filter((id): id is string => !!id),
  );
  const protectedKeys = new Set(
    db.files
      .filter((file) => {
        const created = Date.parse(file.createdAt);
        return referenced.has(file.id) || !Number.isFinite(created) || created > cutoff;
      })
      .map((file) => file.key),
  );
  return objects.flatMap((object) => {
    const key = object.Key || '';
    if (
      !/^(verified\/)?classes\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.(pdf|docx|jpe?g|png|mp4|webm)$/i.test(
        key,
      )
    )
      return [];
    if (!object.LastModified || object.LastModified.getTime() > cutoff || protectedKeys.has(key))
      return [];
    return [key];
  });
}
