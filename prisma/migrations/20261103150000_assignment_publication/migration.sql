-- Additive: old application images remain compatible with these columns.
ALTER TABLE "Assignment" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true,
                         ADD COLUMN "announcedAt" TEXT;
-- Existing visible assignments have already been announced. Do not repeat on republish.
UPDATE "Assignment" a SET "announcedAt" = a."createdAt"
WHERE a."lessonId" IS NULL OR EXISTS (
  SELECT 1 FROM "Lesson" l WHERE l.id = a."lessonId" AND l.published = true
) OR EXISTS (
  SELECT 1 FROM "Notification" n WHERE n."assignmentId" = a.id AND n.content LIKE 'Lớp có bài tập mới:%'
);
