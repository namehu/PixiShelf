-- CreateEnum
CREATE TYPE "ArtworkSource" AS ENUM ('LOCAL_CREATED', 'PIXIV_IMPORTED');

-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "source" "ArtworkSource" NOT NULL DEFAULT 'PIXIV_IMPORTED';
