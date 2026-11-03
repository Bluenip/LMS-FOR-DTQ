ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isDemo" = true WHERE
  ("id" = 'teacher-1' AND "email" = 'teacher@detuquy.vn') OR
  ("id" = 'student-1' AND "email" = 'student@detuquy.vn') OR
  ("id" = 'student-2' AND "email" = 'chau@detuquy.vn') OR
  ("id" = 'student-3' AND "email" = 'nam@detuquy.vn') OR
  ("id" = 'student-4' AND "email" = 'mai@detuquy.vn');
CREATE TABLE "AuthToken" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL,
 "purpose" TEXT NOT NULL,
 "createdAt" TEXT NOT NULL,
 "expiresAt" TEXT NOT NULL,
 "consumedAt" TEXT,
 "pendingPasswordHash" TEXT,
 "pendingName" TEXT,
 CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
