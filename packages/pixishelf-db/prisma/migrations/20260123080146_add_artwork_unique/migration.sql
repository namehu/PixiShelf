/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `Artwork` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Artwork_externalId_key" ON "Artwork"("externalId");
