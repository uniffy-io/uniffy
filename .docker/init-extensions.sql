-- Initialize PostgreSQL extensions for UNIFFY
-- Enable uuid-ossp for UUID generation functions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
COMMENT ON EXTENSION "uuid-ossp" IS 'UUID generation functions';
