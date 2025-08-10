/*
  Warnings:

  - A unique constraint covering the columns `[username,userId]` on the table `Artist` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "userId" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Artist_username_userId_key" ON "Artist"("username", "userId");
