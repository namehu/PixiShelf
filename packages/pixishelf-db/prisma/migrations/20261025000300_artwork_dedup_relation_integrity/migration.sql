ALTER TABLE "ArtworkDedupRelation" ADD CONSTRAINT "ArtworkDedupRelation_runId_containedArtworkId_fkey"
 FOREIGN KEY ("runId","containedArtworkId") REFERENCES "ArtworkDedupItem"("runId","artworkId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtworkDedupRelation" ADD CONSTRAINT "ArtworkDedupRelation_runId_containerArtworkId_fkey"
 FOREIGN KEY ("runId","containerArtworkId") REFERENCES "ArtworkDedupItem"("runId","artworkId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtworkDedupOperationGroup" ADD CONSTRAINT "ArtworkDedupOperationGroup_contains_counts_nonnull"
 CHECK ("relationKind"<>'CONTAINS' OR ("containedFileCount" IS NOT NULL AND "containerFileCount" IS NOT NULL));
