/*
  Warnings:

  - A unique constraint covering the columns `[source,externalId]` on the table `Series` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SeriesType" AS ENUM ('LOCAL', 'PIXIV');

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'LOCAL';

-- CreateIndex
CREATE UNIQUE INDEX "Series_source_externalId_key" ON "Series"("source", "externalId");
