-- Existing content and grades remain unchanged; empty revision identifies the old version.
ALTER TABLE "Lesson" ADD COLUMN "revision" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Submission" ADD COLUMN "revision" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Submission" ADD COLUMN "gradeRevision" TEXT NOT NULL DEFAULT '';
