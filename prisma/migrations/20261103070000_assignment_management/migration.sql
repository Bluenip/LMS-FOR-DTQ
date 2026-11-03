ALTER TABLE "Assignment" ALTER COLUMN "maxWords" DROP NOT NULL;

ALTER TABLE "Classroom" ADD COLUMN "contentAuthor" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Notification" ADD COLUMN "assignmentId" TEXT;

CREATE INDEX "Notification_assignmentId_idx" ON "Notification"("assignmentId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
