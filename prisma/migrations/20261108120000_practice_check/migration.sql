-- CreateTable
CREATE TABLE "PracticeCheck" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "checkedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "revision" TEXT,

    CONSTRAINT "PracticeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeCheck_lessonId_studentId_key" ON "PracticeCheck"("lessonId", "studentId");

-- CreateIndex
CREATE INDEX "PracticeCheck_classId_idx" ON "PracticeCheck"("classId");

-- CreateIndex
CREATE INDEX "PracticeCheck_studentId_idx" ON "PracticeCheck"("studentId");

-- AddForeignKey
ALTER TABLE "PracticeCheck" ADD CONSTRAINT "PracticeCheck_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCheck" ADD CONSTRAINT "PracticeCheck_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
