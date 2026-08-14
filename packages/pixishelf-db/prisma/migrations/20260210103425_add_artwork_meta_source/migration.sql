/*
  Warnings:

  - A unique constraint covering the columns `[metaSource]` on the table `Artwork` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "metaSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Artwork_metaSource_key" ON "Artwork"("metaSource");

-- CreateIndex
CREATE INDEX "Artwork_metaSource_idx" ON "Artwork"("metaSource");
