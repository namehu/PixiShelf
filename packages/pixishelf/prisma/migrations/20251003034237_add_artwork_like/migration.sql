-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ArtworkLike" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtworkLike_artworkId_idx" ON "ArtworkLike"("artworkId");

-- CreateIndex
CREATE INDEX "ArtworkLike_userId_idx" ON "ArtworkLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkLike_userId_artworkId_key" ON "ArtworkLike"("userId", "artworkId");

-- CreateIndex
CREATE INDEX "Artwork_likeCount_idx" ON "Artwork"("likeCount");

-- AddForeignKey
ALTER TABLE "ArtworkLike" ADD CONSTRAINT "ArtworkLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkLike" ADD CONSTRAINT "ArtworkLike_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
