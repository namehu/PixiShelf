-- Create extension if needed (unaccent, pg_trgm for search in the future)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;