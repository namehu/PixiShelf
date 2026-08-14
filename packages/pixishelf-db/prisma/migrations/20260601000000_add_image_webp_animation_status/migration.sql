ALTER TABLE "Image" ADD COLUMN "webpAnimationStatus" SMALLINT;

CREATE INDEX "Image_webpAnimationStatus_idx" ON "Image"("webpAnimationStatus");
