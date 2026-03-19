ALTER TABLE agents ADD COLUMN endpoint_verified_at integer;
ALTER TABLE agents ADD COLUMN endpoint_failures integer NOT NULL DEFAULT 0;
