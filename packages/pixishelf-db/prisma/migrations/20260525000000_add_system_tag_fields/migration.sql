-- Add system tag metadata for derived tags such as media:image, media:video and media:webp.
ALTER TABLE "Tag" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tag" ADD COLUMN "systemKey" TEXT;

CREATE UNIQUE INDEX "Tag_systemKey_key" ON "Tag"("systemKey");
