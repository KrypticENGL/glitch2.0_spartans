-- SURAKSHA core schema. Geometry is EPSG:4326 (lon/lat); distances use geography casts (metres).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Shared enums ------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('citizen', 'admin', 'responder');
CREATE TYPE shelter_status AS ENUM ('open', 'near_capacity', 'full', 'closed');
CREATE TYPE source_class AS ENUM ('osm', 'synthetic', 'simulated', 'official', 'citizen', 'admin');
CREATE TYPE road_status AS ENUM ('open', 'restricted', 'blocked', 'unknown');
CREATE TYPE hazard_type AS ENUM ('waterlogging', 'flooding', 'road_damage', 'fallen_tree', 'bridge_issue', 'power_line', 'landslide', 'other');
CREATE TYPE hazard_severity AS ENUM ('low', 'moderate', 'severe');
CREATE TYPE hazard_source AS ENUM ('citizen', 'admin', 'official', 'simulated');
CREATE TYPE hazard_verification AS ENUM ('unverified', 'verified', 'rejected', 'resolved');
CREATE TYPE incident_type AS ENUM ('stranded', 'medical', 'structure_collapse', 'missing_person', 'supplies', 'other');
CREATE TYPE priority_level AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE incident_status AS ENUM ('new', 'assigned', 'en_route', 'on_site', 'resolved', 'cancelled');
CREATE TYPE team_availability AS ENUM ('available', 'on_mission', 'off_duty');
CREATE TYPE mission_status AS ENUM ('assigned', 'accepted', 'en_route', 'on_site', 'completed', 'cancelled');
CREATE TYPE reservation_status AS ENUM ('active', 'checked_in', 'cancelled', 'expired');
CREATE TYPE route_record_status AS ENUM ('valid', 'invalidated', 'expired');

-- Users -------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email         text UNIQUE,
  phone         text UNIQUE,
  password_hash text,
  role          user_role NOT NULL DEFAULT 'citizen',
  rescue_team_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Shelters ----------------------------------------------------------------
CREATE TABLE shelters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text,
  location           geometry(Point, 4326) NOT NULL,
  address            text,
  area               text,
  total_capacity     integer NOT NULL CHECK (total_capacity >= 0),
  current_occupancy  integer NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
  reserved_count     integer NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  operational_status shelter_status NOT NULL DEFAULT 'open',
  facilities         text[] NOT NULL DEFAULT '{}',
  accessible         boolean NOT NULL DEFAULT false,
  accessibility_notes text,
  contact_phone      text,
  source             source_class NOT NULL DEFAULT 'simulated',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occupancy_within_capacity CHECK (current_occupancy + reserved_count <= total_capacity)
);
CREATE INDEX shelters_location_gix ON shelters USING gist (location);

-- Road network ------------------------------------------------------------
CREATE TABLE road_nodes (
  id          bigint PRIMARY KEY,
  location    geometry(Point, 4326) NOT NULL,
  external_id text UNIQUE  -- e.g. "osm:node/123"
);
CREATE INDEX road_nodes_location_gix ON road_nodes USING gist (location);

CREATE TABLE road_edges (
  id                  bigint PRIMARY KEY,
  source_node_id      bigint NOT NULL REFERENCES road_nodes(id),
  target_node_id      bigint NOT NULL REFERENCES road_nodes(id),
  geom                geometry(LineString, 4326) NOT NULL,
  length_meters       double precision NOT NULL CHECK (length_meters > 0),
  travel_time_seconds double precision NOT NULL CHECK (travel_time_seconds > 0),  -- driving baseline
  road_type           text NOT NULL,
  name                text,
  status              road_status NOT NULL DEFAULT 'open',
  oneway              boolean NOT NULL DEFAULT false,  -- true: traversable only source -> target
  flood_risk          smallint NOT NULL DEFAULT 0 CHECK (flood_risk BETWEEN 0 AND 100),
  access_risk         smallint NOT NULL DEFAULT 0 CHECK (access_risk BETWEEN 0 AND 100),
  travel_modes        text[] NOT NULL DEFAULT '{walking,driving}',
  wheelchair_ok       boolean NOT NULL DEFAULT true,
  source              source_class NOT NULL DEFAULT 'osm',
  external_id         text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (source_node_id <> target_node_id)
);
CREATE INDEX road_edges_geom_gix ON road_edges USING gist (geom);
CREATE INDEX road_edges_source_idx ON road_edges (source_node_id);
CREATE INDEX road_edges_target_idx ON road_edges (target_node_id);
CREATE INDEX road_edges_status_idx ON road_edges (status) WHERE status <> 'open';

-- Single-row graph version; bumped in the same transaction as any routing-relevant change.
CREATE TABLE graph_state (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  version    bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason     text
);
INSERT INTO graph_state (id, version, reason) VALUES (true, 1, 'initial');

-- Hazards -----------------------------------------------------------------
CREATE TABLE hazard_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location            geometry(Point, 4326) NOT NULL,
  road_edge_id        bigint REFERENCES road_edges(id),
  hazard_type         hazard_type NOT NULL,
  severity            hazard_severity NOT NULL,
  description         text NOT NULL CHECK (length(description) <= 1000),
  source              hazard_source NOT NULL,
  verification_status hazard_verification NOT NULL DEFAULT 'unverified',
  applied_road_status road_status,  -- road status set when verified (null = no road effect)
  reported_by         uuid REFERENCES users(id),
  reported_at         timestamptz NOT NULL DEFAULT now(),
  verified_at         timestamptz,
  verified_by         uuid REFERENCES users(id),
  CHECK ((verification_status = 'unverified') OR verified_at IS NOT NULL)
);
CREATE INDEX hazard_reports_location_gix ON hazard_reports USING gist (location);
CREATE INDEX hazard_reports_edge_idx ON hazard_reports (road_edge_id);
CREATE INDEX hazard_reports_status_idx ON hazard_reports (verification_status);

-- Rescue teams --------------------------------------------------------------
CREATE TABLE rescue_teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  kind             text NOT NULL,
  members          integer NOT NULL CHECK (members > 0),
  availability     team_availability NOT NULL DEFAULT 'available',
  capabilities     text[] NOT NULL DEFAULT '{}',
  current_location geometry(Point, 4326) NOT NULL,
  lead_name        text,
  lead_phone       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rescue_teams_location_gix ON rescue_teams USING gist (current_location);
ALTER TABLE users ADD CONSTRAINT users_team_fk FOREIGN KEY (rescue_team_id) REFERENCES rescue_teams(id);
CREATE INDEX users_team_idx ON users (rescue_team_id);

-- SOS requests / incidents --------------------------------------------------
CREATE TABLE sos_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  requester_id      uuid REFERENCES users(id),
  contact_phone     text,
  location          geometry(Point, 4326) NOT NULL,
  area              text,
  emergency_type    incident_type NOT NULL,
  people_count      integer NOT NULL CHECK (people_count BETWEEN 1 AND 500),
  medical_needed    boolean NOT NULL DEFAULT false,
  trapped           boolean NOT NULL DEFAULT false,
  life_threatening  boolean NOT NULL DEFAULT false,
  children_count    integer NOT NULL DEFAULT 0 CHECK (children_count >= 0),
  elderly_count     integer NOT NULL DEFAULT 0 CHECK (elderly_count >= 0),
  disabled_count    integer NOT NULL DEFAULT 0 CHECK (disabled_count >= 0),
  notes             text CHECK (length(notes) <= 1000),
  suggested_priority priority_level NOT NULL,
  priority_score    integer NOT NULL,
  priority_breakdown jsonb NOT NULL,
  priority          priority_level NOT NULL,  -- effective (suggested or operator override)
  priority_overridden boolean NOT NULL DEFAULT false,
  status            incident_status NOT NULL DEFAULT 'new',
  idempotency_key   text UNIQUE,              -- prevents duplicate SOS submissions
  source            source_class NOT NULL DEFAULT 'citizen',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (children_count + elderly_count + disabled_count <= people_count * 3)
);
CREATE INDEX sos_location_gix ON sos_requests USING gist (location);
CREATE INDEX sos_status_priority_idx ON sos_requests (status, priority);
CREATE INDEX sos_requester_idx ON sos_requests (requester_id);

-- Missions ----------------------------------------------------------------
CREATE TABLE rescue_missions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  sos_request_id uuid NOT NULL REFERENCES sos_requests(id),
  rescue_team_id uuid NOT NULL REFERENCES rescue_teams(id),
  assigned_by    uuid REFERENCES users(id),
  status         mission_status NOT NULL DEFAULT 'assigned',
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  notes          text,
  CHECK ((status IN ('completed', 'cancelled')) = (completed_at IS NOT NULL))
);
-- At most one active mission per SOS request.
CREATE UNIQUE INDEX missions_one_active_per_sos ON rescue_missions (sos_request_id) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX missions_team_idx ON rescue_missions (rescue_team_id);
CREATE INDEX missions_assigned_by_idx ON rescue_missions (assigned_by);

-- Evacuation route records ---------------------------------------------------
CREATE TABLE route_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by           uuid REFERENCES users(id),
  origin                 geometry(Point, 4326) NOT NULL,
  destination_shelter_id uuid NOT NULL REFERENCES shelters(id),
  geometry               geometry(LineString, 4326) NOT NULL,
  edge_ids               bigint[] NOT NULL,
  risk_score             double precision NOT NULL CHECK (risk_score >= 0),
  risk_breakdown         jsonb NOT NULL,
  people_count           integer NOT NULL CHECK (people_count > 0),
  travel_mode            text NOT NULL,
  graph_version          bigint NOT NULL,
  status                 route_record_status NOT NULL DEFAULT 'valid',
  calculated_at          timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  invalidated_at         timestamptz,
  invalidation_reason    text
);
CREATE INDEX route_records_shelter_idx ON route_records (destination_shelter_id);
CREATE INDEX route_records_user_idx ON route_records (requested_by);
CREATE INDEX route_records_edges_gin ON route_records USING gin (edge_ids);
CREATE INDEX route_records_valid_idx ON route_records (status) WHERE status = 'valid';

-- Shelter capacity reservations ------------------------------------------------
CREATE TABLE shelter_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shelter_id   uuid NOT NULL REFERENCES shelters(id),
  requester_id uuid REFERENCES users(id),
  route_record_id uuid REFERENCES route_records(id),
  people_count integer NOT NULL CHECK (people_count BETWEEN 1 AND 100),
  status       reservation_status NOT NULL DEFAULT 'active',
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_shelter_idx ON shelter_reservations (shelter_id, status);
CREATE INDEX reservations_requester_idx ON shelter_reservations (requester_id);
CREATE INDEX reservations_route_idx ON shelter_reservations (route_record_id);

-- Audit log ------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,          -- e.g. road.status.update, hazard.verify
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id);
