-- Preserve the teacher currently displayed for every existing class.
ALTER TABLE "Classroom" ADD COLUMN "teacherIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Classroom" SET "teacherIds" = ARRAY["teacherId"];
