CREATE INDEX "Enrollment_userId_idx" ON "Enrollment"("userId");
CREATE INDEX "Classroom_teacherIds_idx" ON "Classroom" USING GIN ("teacherIds");
