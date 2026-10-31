CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branch_products (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'BOB',
  stock_total INTEGER NOT NULL CHECK (stock_total >= 0),
  stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id),
  CHECK (stock_reserved <= stock_total)
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL CHECK (status IN ('activa', 'consolidada', 'liberada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservation_items (
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (reservation_id, product_id)
);

INSERT INTO branches (id, name, address) VALUES
  ('sucursal-centro', 'Sucursal Centro', 'Av. Principal 100'),
  ('sucursal-sur', 'Sucursal Sur', 'Calle Sur 20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, description) VALUES
  ('producto-hamburguesa', 'Hamburguesa clásica', 'Carne, queso y vegetales'),
  ('producto-pizza', 'Pizza familiar', 'Pizza de ocho porciones'),
  ('producto-refresco', 'Refresco', 'Bebida gaseosa')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branch_products (branch_id, product_id, price_cents, currency, stock_total)
SELECT b.id, p.id,
       CASE p.id WHEN 'producto-hamburguesa' THEN 3500 WHEN 'producto-pizza' THEN 6000 ELSE 1000 END,
       'BOB', 20
FROM branches b CROSS JOIN products p
ON CONFLICT (branch_id, product_id) DO NOTHING;
