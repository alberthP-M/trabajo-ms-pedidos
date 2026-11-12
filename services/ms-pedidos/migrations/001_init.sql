CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'confirmado', 'rechazado')),
  internal_status TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'BOB',
  payment_token TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  name TEXT NOT NULL DEFAULT '',
  unit_price_cents INTEGER CHECK (unit_price_cents > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS order_transitions (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  client_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, key)
);

CREATE TABLE IF NOT EXISTS sagas (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  reservation_id TEXT,
  payment_id TEXT,
  step TEXT NOT NULL,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB
);
