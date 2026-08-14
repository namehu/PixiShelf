-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop the problematic B-Tree composite index that causes row size issues
DROP INDEX IF EXISTS "Artwork_title_description_idx";

-- Create a GIN trigram index for efficient fuzzy search on title and description
-- This index concatenates title and description fields for combined search capability
CREATE INDEX "artwork_title_description_trgm_idx" ON "Artwork"
USING GIN ((title || ' ' || COALESCE(description, '')) gin_trgm_ops);

-- Individual trigram indexes are not needed since we use combined search
-- CREATE INDEX "artwork_title_trgm_idx" ON "Artwork"
-- USING GIN (title gin_trgm_ops);

-- CREATE INDEX "artwork_description_trgm_idx" ON "Artwork"
-- USING GIN (description gin_trgm_ops);
