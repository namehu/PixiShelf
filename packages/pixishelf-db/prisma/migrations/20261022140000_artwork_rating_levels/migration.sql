BEGIN;

-- Retain the original like identity and timestamps: existing likes become level 2.
ALTER TABLE "ArtworkLike"
  ADD COLUMN "level" SMALLINT NOT NULL DEFAULT 2,
  ADD CONSTRAINT "ArtworkLike_level_check" CHECK ("level" BETWEEN 1 AND 4);

-- A rating is the only source of truth. My Likes and likeCount mean level >= 2.
CREATE OR REPLACE FUNCTION update_artwork_like_count()
RETURNS TRIGGER AS $$
DECLARE
  old_artwork_id INTEGER;
  new_artwork_id INTEGER;
  old_contribution INTEGER := 0;
  new_contribution INTEGER := 0;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_artwork_id := OLD."artworkId";
    old_contribution := CASE WHEN OLD."level" >= 2 THEN 1 ELSE 0 END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_artwork_id := NEW."artworkId";
    new_contribution := CASE WHEN NEW."level" >= 2 THEN 1 ELSE 0 END;
  END IF;

  -- ON UPDATE CASCADE changes the parent's identity together with its existing
  -- count. Ordinary rating reassignment still has an old parent to decrement.
  IF TG_OP = 'UPDATE' AND old_artwork_id <> new_artwork_id
     AND NOT EXISTS (SELECT 1 FROM "Artwork" WHERE id = old_artwork_id) THEN
    old_artwork_id := new_artwork_id;
  END IF;

  UPDATE "Artwork" artwork
  SET "likeCount" = artwork."likeCount" + delta.amount
  FROM (
    SELECT changes.artwork_id, SUM(changes.contribution)::INTEGER AS amount
    FROM (VALUES (old_artwork_id, -old_contribution), (new_artwork_id, new_contribution))
      AS changes(artwork_id, contribution)
    WHERE changes.artwork_id IS NOT NULL
    GROUP BY changes.artwork_id
    HAVING SUM(changes.contribution) <> 0
  ) delta
  WHERE artwork.id = delta.artwork_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER artwork_like_count_trigger ON "ArtworkLike";
CREATE TRIGGER artwork_like_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "ArtworkLike"
  FOR EACH ROW EXECUTE FUNCTION update_artwork_like_count();

-- Reconcile the derived count, including any historical drift. Raw SQL leaves
-- ArtworkLike IDs and both timestamps untouched, and skips already-correct works.
UPDATE "Artwork" artwork
SET "likeCount" = counts.total
FROM (
  SELECT source.id, COUNT(rating.id)::INTEGER AS total
  FROM "Artwork" source
  LEFT JOIN "ArtworkLike" rating ON rating."artworkId" = source.id AND rating."level" >= 2
  GROUP BY source.id
) counts
WHERE artwork.id = counts.id AND artwork."likeCount" IS DISTINCT FROM counts.total;

COMMIT;
