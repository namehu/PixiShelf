-- Read-only verification after 20260930121000_retire_series_legacy_fields.
-- This file intentionally uses only SeriesExternalRef and SeriesArtwork.

SELECT "providerKey", status, count(*) AS ref_count
FROM series_external_refs
GROUP BY "providerKey", status
ORDER BY "providerKey", status;

SELECT provenance, count(*) AS membership_count
FROM "SeriesArtwork"
GROUP BY provenance
ORDER BY provenance;

SELECT count(*) AS invalid_source_membership_count
FROM "SeriesArtwork"
WHERE (provenance = 'SOURCE' AND "sourceRefId" IS NULL)
   OR (provenance <> 'SOURCE' AND "sourceRefId" IS NOT NULL);

SELECT "providerKey", "externalId", count(*) AS duplicate_count
FROM series_external_refs
GROUP BY "providerKey", "externalId"
HAVING count(*) > 1;

SELECT "seriesId", "providerKey", count(*) AS duplicate_count
FROM series_external_refs
GROUP BY "seriesId", "providerKey"
HAVING count(*) > 1;

SELECT "sourceRefId", count(*) AS duplicate_count
FROM "SeriesArtwork"
WHERE "sourceRefId" IS NOT NULL
GROUP BY "sourceRefId"
HAVING count(*) > 1;

SELECT count(*) AS source_membership_provider_mismatch_count
FROM "SeriesArtwork" membership
JOIN artwork_external_refs source_ref ON source_ref.id = membership."sourceRefId"
JOIN series_external_refs series_ref ON series_ref."seriesId" = membership."seriesId"
WHERE membership.provenance = 'SOURCE'
  AND source_ref."providerKey" <> series_ref."providerKey";
