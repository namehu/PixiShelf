-- Read-only verification after the Series external identity migration.

SELECT
  "providerKey",
  status,
  count(*) AS ref_count
FROM "series_external_refs"
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
FROM "series_external_refs"
GROUP BY "providerKey", "externalId"
HAVING count(*) > 1;

SELECT "seriesId", "providerKey", count(*) AS duplicate_count
FROM "series_external_refs"
GROUP BY "seriesId", "providerKey"
HAVING count(*) > 1;

SELECT "sourceRefId", count(*) AS duplicate_count
FROM "SeriesArtwork"
WHERE "sourceRefId" IS NOT NULL
GROUP BY "sourceRefId"
HAVING count(*) > 1;

SELECT count(*) AS local_series_not_manual_count
FROM "SeriesArtwork" membership
JOIN "Series" series ON series.id = membership."seriesId"
WHERE upper(btrim(series.source)) = 'LOCAL'
  AND membership.provenance <> 'MANUAL';
