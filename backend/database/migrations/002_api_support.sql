-- API support objects: human-readable code sequences and shelter status derivation.
CREATE SEQUENCE IF NOT EXISTS sos_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS mission_code_seq START 1;

-- 'closed' is operator-controlled and sticky; otherwise status follows (occupancy + reserved) / capacity.
CREATE OR REPLACE FUNCTION shelter_derived_status(current_status shelter_status, total integer, occupied integer)
RETURNS shelter_status LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN current_status = 'closed' THEN 'closed'::shelter_status
    WHEN occupied >= total THEN 'full'::shelter_status
    WHEN occupied * 10 >= total * 9 THEN 'near_capacity'::shelter_status
    ELSE 'open'::shelter_status
  END
$$;

CREATE INDEX IF NOT EXISTS reservations_active_expiry_idx ON shelter_reservations (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sos_created_idx ON sos_requests (created_at);
