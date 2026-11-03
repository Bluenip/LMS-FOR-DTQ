CREATE TABLE "RequestLimit" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" BIGINT NOT NULL,
  CONSTRAINT "RequestLimit_pkey" PRIMARY KEY ("key")
);
