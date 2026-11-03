-- Timestamps were stored as ISO-8601 text. Real timestamps allow date filtering, sorting and
-- indexing in the database. Existing values are all UTC ISO strings (Date#toISOString), so the
-- conversion is exact.
ALTER TABLE "AuthToken" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "AuthToken" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt"::timestamptz;
ALTER TABLE "AuthToken" ALTER COLUMN "consumedAt" TYPE TIMESTAMPTZ(3) USING NULLIF("consumedAt", '')::timestamptz;
ALTER TABLE "Classroom" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "Enrollment" ALTER COLUMN "joinedAt" TYPE TIMESTAMPTZ(3) USING "joinedAt"::timestamptz;
ALTER TABLE "Lesson" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "Assignment" ALTER COLUMN "dueAt" TYPE TIMESTAMPTZ(3) USING "dueAt"::timestamptz;
ALTER TABLE "Assignment" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "Assignment" ALTER COLUMN "announcedAt" TYPE TIMESTAMPTZ(3) USING NULLIF("announcedAt", '')::timestamptz;
ALTER TABLE "Submission" ALTER COLUMN "submittedAt" TYPE TIMESTAMPTZ(3) USING NULLIF("submittedAt", '')::timestamptz;
ALTER TABLE "Submission" ALTER COLUMN "gradedAt" TYPE TIMESTAMPTZ(3) USING NULLIF("gradedAt", '')::timestamptz;
ALTER TABLE "Note" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt"::timestamptz;
ALTER TABLE "Discussion" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "Discussion" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING NULLIF("updatedAt", '')::timestamptz;
ALTER TABLE "Notification" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "StoredFile" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "DriveConnection" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "DriveConnection" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt"::timestamptz;
ALTER TABLE "DriveUpload" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "DriveUpload" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt"::timestamptz;
ALTER TABLE "DriveTrash" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
ALTER TABLE "AuditLog" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt"::timestamptz;
