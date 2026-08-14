-- CreateEnum
CREATE TYPE "TranslateType" AS ENUM ('NONE', 'PIXIV', 'AI', 'MANUAL');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "backgroundImg" TEXT;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "translateType" "TranslateType" NOT NULL DEFAULT 'NONE';
