-- Announce-once flag for assignments (prevents duplicate "new assignment" notifications).
ALTER TABLE "Assignment" ADD COLUMN "announcedAt" TEXT;
-- Assignments already visible to learners were announced when they became visible.
UPDATE "Assignment" SET "announcedAt" = "createdAt"
WHERE "lessonId" IS NULL OR "lessonId" IN (SELECT "id" FROM "Lesson" WHERE "published");

-- Indexes for lookups by lesson / user / student.
CREATE INDEX "Progress_lessonId_idx" ON "Progress"("lessonId");
CREATE INDEX "Note_lessonId_idx" ON "Note"("lessonId");
CREATE INDEX "Enrollment_userId_idx" ON "Enrollment"("userId");
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");

-- Shared rate limiting.
CREATE TABLE "RateLimitEntry" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" BIGINT NOT NULL,
    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("key")
);

-- Google Drive files awaiting deletion.
CREATE TABLE "DriveTrash" (
    "id" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "DriveTrash_pkey" PRIMARY KEY ("id")
);

-- Administrative audit trail.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
