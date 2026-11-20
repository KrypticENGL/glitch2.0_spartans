-- Web Push subscriptions and administrator alerts.
-- Subscription endpoint and keys are stored AES-256-GCM encrypted (application-side, PUSH_ENCRYPTION_KEY);
-- endpoint_hash (SHA-256) gives duplicate detection without storing the endpoint in clear text.

CREATE TYPE alert_severity AS ENUM ('advisory', 'warning', 'severe', 'critical');
CREATE TYPE alert_status AS ENUM ('draft', 'sending', 'sent', 'failed');
CREATE TYPE alert_classification AS ENUM ('demo', 'verified');
CREATE TYPE push_delivery_status AS ENUM ('accepted', 'failed', 'invalid');

CREATE TABLE push_subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash             text NOT NULL,
  endpoint_enc              text NOT NULL,
  p256dh_enc                text NOT NULL,
  auth_enc                  text NOT NULL,
  manage_token_hash         text NOT NULL,
  selected_areas            text[] NOT NULL CHECK (cardinality(selected_areas) BETWEEN 1 AND 20),
  notification_preferences  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Demo subscriptions never receive production alerts and vice versa.
  audience                  alert_classification NOT NULL DEFAULT 'demo',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  last_success_at           timestamptz,
  invalidated_at            timestamptz,
  invalidated_reason        text
);
CREATE UNIQUE INDEX push_subscriptions_active_endpoint ON push_subscriptions (endpoint_hash) WHERE invalidated_at IS NULL;
CREATE INDEX push_subscriptions_areas ON push_subscriptions USING gin (selected_areas) WHERE invalidated_at IS NULL;
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  body            text NOT NULL CHECK (length(body) BETWEEN 3 AND 600),
  severity        alert_severity NOT NULL,
  target_area     text NOT NULL,
  language        text NOT NULL CHECK (language IN ('en', 'hi')),
  classification  alert_classification NOT NULL DEFAULT 'demo',
  deliver_in_app  boolean NOT NULL DEFAULT true,
  deliver_push    boolean NOT NULL DEFAULT true,
  status          alert_status NOT NULL DEFAULT 'draft',
  expires_at      timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CHECK (deliver_in_app OR deliver_push),
  CHECK (classification <> 'demo' OR title LIKE '[DEMO]%')
);
CREATE INDEX alerts_published ON alerts (sent_at DESC) WHERE status IN ('sending', 'sent');

-- One dispatch per alert: the unique alert_id is the duplicate-send guard.
CREATE TABLE alert_dispatches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id         uuid NOT NULL UNIQUE REFERENCES alerts(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL UNIQUE,
  requested_by     uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  eligible_count   integer NOT NULL DEFAULT 0,
  accepted_count   integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0,
  invalid_count    integer NOT NULL DEFAULT 0,
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE TABLE alert_deliveries (
  id               bigserial PRIMARY KEY,
  dispatch_id      uuid NOT NULL REFERENCES alert_dispatches(id) ON DELETE CASCADE,
  subscription_id  uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status           push_delivery_status NOT NULL,
  http_status      integer,
  attempts         integer NOT NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, subscription_id)
);
