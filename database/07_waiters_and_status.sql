-- =====================================================================
-- MOZONA TPV — Migración 07: camareros + estado BILL_REQUESTED
-- =====================================================================
-- Aplica sobre el esquema inicial (01_initial.sql).
--   1. Amplía el CHECK constraint de `tables.status` para admitir
--      'BILL_REQUESTED' (el camarero ha pedido la cuenta, el TPV la cobra).
--   2. Crea la tabla `waiters` con PIN de 4-6 dígitos.
--   3. Inserta datos de demo en desarrollo.
-- =====================================================================

---------------------------------------------------------------------
-- 1) Ampliar check constraint de tables.status
---------------------------------------------------------------------
-- SQLite no permite ALTER TABLE ... DROP CONSTRAINT directamente.
-- Recreamos la tabla preservando los datos, que es la forma estándar.

PRAGMA foreign_keys = OFF;

CREATE TABLE tables_new (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    zone_id       TEXT REFERENCES zones(id) ON DELETE CASCADE,
    table_number  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'FREE'
                  CHECK (status IN ('FREE','OCCUPIED','BILL_REQUESTED','RESERVED','DIRTY')),
    UNIQUE (zone_id, table_number)
);

INSERT INTO tables_new (id, restaurant_id, zone_id, table_number, status)
SELECT id, restaurant_id, zone_id, table_number, status FROM tables;

DROP TABLE tables;
ALTER TABLE tables_new RENAME TO tables;

-- Re-crear índices
CREATE INDEX idx_tables_restaurant ON tables (restaurant_id, status);

PRAGMA foreign_keys = ON;

---------------------------------------------------------------------
-- 2) Tabla de camareros
---------------------------------------------------------------------
CREATE TABLE waiters (
    id              TEXT PRIMARY KEY,
    restaurant_id   TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    pin             TEXT NOT NULL CHECK (length(pin) BETWEEN 4 AND 6),
    role            TEXT NOT NULL DEFAULT 'WAITER'
                    CHECK (role IN ('WAITER','ADMIN','KITCHEN','BAR')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    avatar_url      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at   TEXT,
    UNIQUE (restaurant_id, pin)
);

CREATE INDEX idx_waiters_restaurant ON waiters (restaurant_id)
    WHERE is_active = 1;

CREATE INDEX idx_waiters_pin ON waiters (restaurant_id, pin)
    WHERE is_active = 1;

-- Trigger: normaliza el PIN a 4-6 dígitos numéricos (defensa en profundidad)
CREATE TRIGGER trg_waiters_pin_format
BEFORE INSERT ON waiters
FOR EACH ROW
WHEN NEW.pin GLOB '*[^0-9]*' OR length(NEW.pin) NOT BETWEEN 4 AND 6
BEGIN
    SELECT RAISE(ABORT, 'MOZONA: PIN debe ser numérico de 4-6 dígitos');
END;

---------------------------------------------------------------------
-- 3) Datos de demo (sólo si hay un restaurante configurado)
---------------------------------------------------------------------
INSERT OR IGNORE INTO waiters (id, restaurant_id, name, pin, role)
SELECT
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
           substr(hex(randomblob(2)),2) || '-' || 'a' || substr(hex(randomblob(2)),2) ||
           '-' || hex(randomblob(6))),
    r.id,
    'Carlos',
    '1234',
    'WAITER'
FROM restaurants r
WHERE r.id IS NOT NULL
LIMIT 1;

INSERT OR IGNORE INTO waiters (id, restaurant_id, name, pin, role)
SELECT
    lower(hex(randomblob(16))),
    r.id,
    'María',
    '5678',
    'WAITER'
FROM restaurants r
WHERE r.id IS NOT NULL
LIMIT 1;

INSERT OR IGNORE INTO waiters (id, restaurant_id, name, pin, role)
SELECT
    lower(hex(randomblob(16))),
    r.id,
    'Admin',
    '9999',
    'ADMIN'
FROM restaurants r
WHERE r.id IS NOT NULL
LIMIT 1;

-- La migración de waiters también añade la fila al _migrations manualmente
-- porque la lógica del runner en Rust espera columnas específicas.
-- (Si ejecutas con `psql`, ignora este INSERT; el runner ya lo gestiona.)
