-- =====================================================================
-- MOZONA TPV — Esquema local (SQLite)
-- =====================================================================
-- Adaptación del esquema Postgres/Supabase a SQLite. Cambios principales:
--   • UUIDs como TEXT (generados en Rust)
--   • TIMESTAMPTZ como TEXT ISO 8601 UTC
--   • NUMERIC como DECIMAL (afinidad numérica en SQLite)
--   • RAISE EXCEPTION → RAISE(ABORT, '...')
--   • Las RPC VeriFactu (FOR UPDATE) se implementan en Rust con
--     BEGIN IMMEDIATE, ya que SQLite no tiene locking pesimista por fila
--   • Se conserva la inmutabilidad de invoices vía trigger
-- =====================================================================

-- Tabla de control de migraciones
CREATE TABLE IF NOT EXISTS _migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TEXT NOT NULL
);

---------------------------------------------------------------------
-- Inquilino raíz
---------------------------------------------------------------------
CREATE TABLE restaurants (
    id                TEXT PRIMARY KEY,
    slug              TEXT UNIQUE NOT NULL,
    business_name     TEXT NOT NULL,
    cif_nif           TEXT NOT NULL,
    address           TEXT NOT NULL,
    phone             TEXT,
    primary_color     TEXT DEFAULT '#4f46e5',
    logo_url          TEXT,
    cover_url         TEXT,
    ticket_footer_msg TEXT DEFAULT '¡Gracias por su visita!',
    created_at        TEXT NOT NULL
);

---------------------------------------------------------------------
-- Plano de sala
---------------------------------------------------------------------
CREATE TABLE zones (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    UNIQUE (restaurant_id, name)
);

CREATE TABLE tables (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    zone_id       TEXT REFERENCES zones(id) ON DELETE CASCADE,
    table_number  TEXT NOT NULL,
    status        TEXT DEFAULT 'FREE'
                  CHECK (status IN ('FREE','OCCUPIED','RESERVED','DIRTY')),
    UNIQUE (zone_id, table_number)
);

---------------------------------------------------------------------
-- Carta
---------------------------------------------------------------------
CREATE TABLE categories (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0,
    UNIQUE (restaurant_id, name)
);

CREATE TABLE products (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    price         DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    tax_rate      DECIMAL(4,2)  DEFAULT 10.00 CHECK (tax_rate >= 0),
    is_available  INTEGER DEFAULT 1 CHECK (is_available IN (0,1))
);

CREATE TABLE modifier_groups (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL
);

CREATE TABLE modifier_options (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    extra_price DECIMAL(10,2) DEFAULT 0.00 CHECK (extra_price >= 0)
);

---------------------------------------------------------------------
-- Pedidos
---------------------------------------------------------------------
CREATE TABLE orders (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id      TEXT REFERENCES tables(id),
    status        TEXT DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','SENT','PAID','CANCELLED','VOID')),
    created_at    TEXT NOT NULL
);

CREATE TABLE order_items (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  TEXT REFERENCES products(id),
    quantity    INTEGER DEFAULT 1 CHECK (quantity > 0),
    unit_price  DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    notes       TEXT,
    created_at  TEXT NOT NULL
);

---------------------------------------------------------------------
-- Facturas (VeriFactu) — INMUTABLES por trigger
---------------------------------------------------------------------
CREATE TABLE invoices (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    order_id        TEXT REFERENCES orders(id),
    series          TEXT NOT NULL,
    number          INTEGER NOT NULL CHECK (number > 0),
    subtotal        DECIMAL(10,2) NOT NULL,
    tax_amount      DECIMAL(10,2) NOT NULL,
    total_amount    DECIMAL(10,2) NOT NULL,
    payment_method  TEXT NOT NULL
                    CHECK (payment_method IN ('CASH','CARD','BIZUM','TRANSFER','OTHER')),
    previous_hash   TEXT NOT NULL,
    current_hash    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    -- Estado de sincronización con la nube
    sync_status     TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (sync_status IN ('PENDING','SYNCING','SYNCED','CONFLICT','LOCAL_ONLY')),
    synced_at       TEXT,
    sync_error      TEXT,
    UNIQUE (restaurant_id, series, number)
);

---------------------------------------------------------------------
-- Cola de sincronización (outbox pattern)
---------------------------------------------------------------------
CREATE TABLE sync_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL,           -- 'INVOICE_PUSH', 'ORDER_PUSH', 'MENU_PULL', ...
    payload         TEXT NOT NULL,           -- JSON
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SYNCING','DONE','FAILED')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TEXT NOT NULL,
    next_retry_at   TEXT NOT NULL
);

CREATE INDEX idx_outbox_pending ON sync_outbox (status, next_retry_at);

---------------------------------------------------------------------
-- TRIGGERS: inmutabilidad de facturas (VeriFactu)
---------------------------------------------------------------------
-- En SQLite, RAISE(ABORT, msg) cancela la operación y hace rollback.
CREATE TRIGGER trg_invoices_no_update
BEFORE UPDATE ON invoices
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'MOZONA: invoices son inmutables (UPDATE prohibido)');
END;

CREATE TRIGGER trg_invoices_no_delete
BEFORE DELETE ON invoices
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'MOZONA: invoices son inmutables (DELETE prohibido)');
END;

-- TRUNCATE no existe en SQLite, pero DROP TABLE se puede mitigar con
-- un trigger específico si el usuario lo intenta (en SQLite no se puede
-- interceptar DROP TABLE, así que documentamos la regla).

---------------------------------------------------------------------
-- Índices de rendimiento
---------------------------------------------------------------------
CREATE INDEX idx_products_restaurant    ON products   (restaurant_id);
CREATE INDEX idx_categories_restaurant  ON categories (restaurant_id, sort_order);
CREATE INDEX idx_orders_open_restaurant ON orders     (restaurant_id, status);
CREATE INDEX idx_invoices_chain         ON invoices   (restaurant_id, series, number DESC);
CREATE INDEX idx_tables_restaurant      ON tables     (restaurant_id, status);
CREATE INDEX idx_invoices_sync          ON invoices   (sync_status) WHERE sync_status != 'SYNCED';
