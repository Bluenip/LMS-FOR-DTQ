-- Google Drive integration: one shared connection and resumable-upload jobs.
ALTER TABLE "Lesson" ADD COLUMN "driveFileId" TEXT;

CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "folderId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveUpload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "lessonId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "bytesUploaded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "encryptedSessionUri" TEXT,
    "driveFileId" TEXT,
    "webViewLink" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "DriveUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveUpload_driveFileId_key" ON "DriveUpload"("driveFileId");
CREATE INDEX "DriveUpload_classId_status_idx" ON "DriveUpload"("classId", "status");
CREATE INDEX "DriveUpload_ownerId_status_idx" ON "DriveUpload"("ownerId", "status");
CREATE INDEX "DriveUpload_lessonId_idx" ON "DriveUpload"("lessonId");

ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUpload" ADD CONSTRAINT "DriveUpload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUpload" ADD CONSTRAINT "DriveUpload_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUpload" ADD CONSTRAINT "DriveUpload_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
