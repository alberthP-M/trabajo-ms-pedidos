CREATE TABLE IF NOT EXISTS payment_transactions (
  order_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'aprobado', 'rechazado', 'reversion_pendiente', 'revertido')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL,
  correlation_id TEXT NOT NULL,
  reason TEXT,
  result_event JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES payment_transactions(order_id),
  operation TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inbox (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
