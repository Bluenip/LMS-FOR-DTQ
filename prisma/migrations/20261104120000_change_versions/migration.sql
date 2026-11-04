-- CreateTable
CREATE TABLE "ChangeVersion" (
    "scope" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ChangeVersion_pkey" PRIMARY KEY ("scope")
);
