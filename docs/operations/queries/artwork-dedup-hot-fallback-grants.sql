-- Run as the database owner, connected to pixishelf (not postgres).
-- Diagnostic SELECT only. No data changes, DDL, write privileges or default grants.
-- Existing SELECT grants for Artwork, Image and system_jobs/events remain unchanged.
GRANT SELECT (
  id, "artistId", mode, "algorithmVersion", "executionVersion", status, stage,
  "jobId", "startedAt", "finishedAt", "updatedAt", "rootBindings",
  "artworkCount", "processedArtworks", "completeArtworks", "changedArtworks",
  "failedArtworks", "skippedArtworks", "statMedia", "hashedMedia", "cacheHitMedia",
  "readBytes", "groupCount", "performanceSummary", "visualCheckpoint"
) ON TABLE public."ArtworkDedupRun" TO pixishelf_diagnostics;
GRANT SELECT (
  "runId", "artworkId", "frozenMediaRevision", status, "snapshotRevision",
  "mediaEpoch", "memberCount", "afterImageId", "contentSha256", "membersSignature", "updatedAt"
) ON TABLE public."ArtworkDedupItem" TO pixishelf_diagnostics;
GRANT SELECT (
  "artworkId", "algorithmVersion", "sourceRevision", "mediaEpoch",
  "membersSignature", "fileCount", "contentSha256", "completedAt"
) ON TABLE public."ArtworkContentFingerprint" TO pixishelf_diagnostics;
GRANT SELECT (
  "artworkId", revision, "mediaEpoch", "writeToken", "updatedAt"
) ON TABLE public."ArtworkContentSource" TO pixishelf_diagnostics;
GRANT SELECT (
  "imageId", revision, "directoryStateId", "writeToken", "updatedAt"
) ON TABLE public."MediaContentSource" TO pixishelf_diagnostics;
GRANT SELECT (
  "imageId", "algorithmVersion", "sourceRevision", "artworkMediaEpoch",
  "sourcePath", "rootIdentity", "hashedAt"
) ON TABLE public."MediaContentFingerprint" TO pixishelf_diagnostics;
GRANT SELECT (
  id, "logicalRoot", "rootIdentity", "relativeDirectory", generation, "updatedAt"
) ON TABLE public."MediaContentDirectoryState" TO pixishelf_diagnostics;
