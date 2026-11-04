-- Indexes for lookups by lesson / user / student.
CREATE INDEX "Progress_lessonId_idx" ON "Progress"("lessonId");
CREATE INDEX "Note_lessonId_idx" ON "Note"("lessonId");
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");

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
