-- Initialize PostgreSQL extensions for UNIFFY
-- This script runs automatically when the database is first created

-- Enable pg_trgm for fuzzy text search and trigram similarity
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for UUID generation functions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Uncomment if using pgvector for embeddings/AI features
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Uncomment if using full-text search
-- CREATE EXTENSION IF NOT EXISTS unaccent;

-- Uncomment if using PostGIS for location data
-- CREATE EXTENSION IF NOT EXISTS postgis;

COMMENT ON EXTENSION pg_trgm IS 'Trigram similarity for fuzzy text search';
COMMENT ON EXTENSION "uuid-ossp" IS 'UUID generation functions';
