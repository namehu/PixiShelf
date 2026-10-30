SELECT now() AS captured_at,count(*) AS artworks,
 count(*) FILTER(WHERE s."artworkId" IS NULL) AS source_rows_missing,
 count(*) FILTER(WHERE f."sourceRevision"=0 AND f."mediaEpoch"=0) AS default_revision_fingerprints,
 count(*) FILTER(WHERE i."snapshotRevision"=0 AND i."mediaEpoch"=0) AS default_revision_run_items,
 min(f."completedAt") AS fingerprint_completed_min,max(f."completedAt") AS fingerprint_completed_max
FROM "ArtworkDedupItem" i
LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=i."artworkId"
JOIN "ArtworkContentFingerprint" f ON f."artworkId"=i."artworkId"
WHERE i."runId"='face2cc2-35b7-4d68-9859-394ea453acbe';