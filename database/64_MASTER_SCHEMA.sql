-- =====================================================================
-- MOZONA TPV — SQL MAESTRO #64 DEFINITIVO
-- =====================================================================
-- Script único para reconstruir, limpiar y estandarizar TODO el esquema.
--
-- TABLAS INCLUIDAS (9 principales + 5 auxiliares):
--   1. tenants                -- empresa principal
--   2. tenant_settings        -- config ticket, tema, layout
--   3. tenant_users           -- usuarios vinculados al tenant
--   4. users                  -- perfiles globales
--   5. products               -- carta
--   6. categories             -- categorías de la carta
--   7. dining_tables          -- mesas del restaurante
--   8. open_orders            -- comandas abiertas en mesa
--   9. orders                 -- ventas cerradas (cabecera)
--   10. order_items           -- líneas de venta
--   11. waiters               -- camareros con PIN
--   12. leads_onboarding      -- leads del wizard
--   13. email_outbox          -- cola de emails transaccionales
--   14. payments              -- pagos (efectivo, tarjeta...)
--   15. cash_closures         -- cierres de caja
--
-- CARACTERÍSTICAS:
--   ✓ ON DELETE CASCADE en todas las FKs
--   ✓ RLS permisiva (authenticated, anon, service_role)
--   ✓ Triggers: updated_at, categorías auto, contadores
--   ✓ Índices para rendimiento
--   ✓ NOTIFY pgrst al final (refresca cache PostgREST)
--
-- EJECUTAR EN: https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/sql/new
-- =====================================================================

-- =====================================================================
-- 0. FUNCIONES HELPER (set_updated_at) — crear ANTES de triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 0.5 LIMPIEZA SEGURA — DROP policies/constr/old functions
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
    -- Drop TODAS las policies de las tablas afectadas
    FOR r IN (SELECT policyname, tablename FROM pg_policies
              WHERE tablename IN (
                'tenants','tenant_settings','tenant_users','users',
                'products','categories','dining_tables','open_orders',
                'orders','order_items','waiters','leads_onboarding',
                'email_outbox','payments','cash_closures'
              )) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;

    -- Drop constrains FK antiguas que NO tengan CASCADE
    FOR r IN (
        SELECT tc.constraint_name, tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND rc.delete_rule <> 'CASCADE'
          AND tc.table_name IN (
            'tenants','tenant_settings','tenant_users',
            'products','categories','dining_tables','open_orders',
            'orders','order_items','waiters','leads_onboarding',
            'email_outbox','payments','cash_closures'
          )
    ) LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                       r.table_name, r.constraint_name);
    END LOOP;
END $$;

-- =====================================================================
-- 1. TABLA: tenants (cliente/empresa)
-- =====================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID,
    business_name       TEXT NOT NULL DEFAULT '',
    cif_nif             TEXT,
    address             TEXT,
    phone               TEXT,
    contact_email       TEXT,
    plan                TEXT DEFAULT 'free',
    plan_selected       TEXT,
    activation_status   TEXT DEFAULT 'pending',
    trial_ends_at       TIMESTAMPTZ,
    subscription_status TEXT DEFAULT 'inactive',
    grace_period_ends_at TIMESTAMPTZ,
    -- Datos fiscales / ticket
    default_series      TEXT DEFAULT 'T-F',
    ticket_header_msg   TEXT,
    ticket_footer_msg   TEXT,
    ticket_show_tax     BOOLEAN DEFAULT true,
    ticket_paper_width  INTEGER DEFAULT 58,
    tax_rate_default    NUMERIC DEFAULT 10,
    -- Metadata
    metadata            JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Columnas adicionales si faltan (compatibilidad)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_name TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cif_nif TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_series TEXT DEFAULT 'T-F';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ticket_header_msg TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ticket_footer_msg TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ticket_show_tax BOOLEAN DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ticket_paper_width INTEGER DEFAULT 58;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_rate_default NUMERIC DEFAULT 10;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activation_status TEXT DEFAULT 'pending';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;
-- ★ v4.3.0: business_type selector (retail | hospitality)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'hospitality'
    CHECK (business_type IN ('hospitality', 'retail'));
-- ★ v4.3.0: features_config JSONB (preferencias adaptativas)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features_config JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_contact_email ON tenants(contact_email);
CREATE INDEX IF NOT EXISTS idx_tenants_activation ON tenants(activation_status);

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_authenticated_all ON tenants
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tenants_anon_all ON tenants
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY tenants_service_role ON tenants
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 2. TABLA: tenant_settings (config ticket, tema, layout)
-- =====================================================================
CREATE TABLE IF NOT EXISTS tenant_settings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Ticket
    header_text          TEXT,
    footer_text          TEXT,
    show_vat_breakdown   BOOLEAN DEFAULT true,
    ticket_paper_width   INTEGER DEFAULT 58,
    ticket_layout_json   JSONB,
    default_series       TEXT DEFAULT 'T-F',
    print_logo_on_ticket BOOLEAN DEFAULT false,
    logo_url             TEXT,
    -- Tema
    theme_mode           TEXT DEFAULT 'light',
    theme_accent         TEXT DEFAULT 'blue',
    theme_contrast       TEXT DEFAULT 'normal',
    -- UI
    button_size          TEXT DEFAULT 'md',
    grid_density         TEXT DEFAULT 'normal',
    panel_layout         TEXT DEFAULT 'horizontal',
    show_product_images  BOOLEAN DEFAULT true,
    -- Metadata
    updated_at           TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id)
);

-- Columnas faltantes
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='header_text') THEN
        ALTER TABLE tenant_settings ADD COLUMN header_text TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='footer_text') THEN
        ALTER TABLE tenant_settings ADD COLUMN footer_text TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='show_vat_breakdown') THEN
        ALTER TABLE tenant_settings ADD COLUMN show_vat_breakdown BOOLEAN DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='ticket_paper_width') THEN
        ALTER TABLE tenant_settings ADD COLUMN ticket_paper_width INTEGER DEFAULT 58;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='ticket_layout_json') THEN
        ALTER TABLE tenant_settings ADD COLUMN ticket_layout_json JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='theme_mode') THEN
        ALTER TABLE tenant_settings ADD COLUMN theme_mode TEXT DEFAULT 'light';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='theme_accent') THEN
        ALTER TABLE tenant_settings ADD COLUMN theme_accent TEXT DEFAULT 'blue';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='theme_contrast') THEN
        ALTER TABLE tenant_settings ADD COLUMN theme_contrast TEXT DEFAULT 'normal';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='button_size') THEN
        ALTER TABLE tenant_settings ADD COLUMN button_size TEXT DEFAULT 'md';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='grid_density') THEN
        ALTER TABLE tenant_settings ADD COLUMN grid_density TEXT DEFAULT 'normal';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='panel_layout') THEN
        ALTER TABLE tenant_settings ADD COLUMN panel_layout TEXT DEFAULT 'horizontal';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='show_product_images') THEN
        ALTER TABLE tenant_settings ADD COLUMN show_product_images BOOLEAN DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='updated_at') THEN
        ALTER TABLE tenant_settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings(tenant_id);

DROP TRIGGER IF EXISTS trg_tenant_settings_updated_at ON tenant_settings;
CREATE TRIGGER trg_tenant_settings_updated_at
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_settings_authenticated_all ON tenant_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tenant_settings_anon_all ON tenant_settings
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY tenant_settings_service_role ON tenant_settings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 3. TABLA: users (perfiles globales Supabase auth)
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
    email       TEXT UNIQUE,
    full_name   TEXT,
    avatar_url  TEXT,
    role        TEXT DEFAULT 'owner',
    is_active   BOOLEAN DEFAULT true,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_authenticated_all ON users
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY users_anon_select ON users
    FOR SELECT TO anon USING (true);
CREATE POLICY users_service_role ON users
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 4. TABLA: categories
-- =====================================================================
CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    image_url   TEXT,
    is_active   BOOLEAN DEFAULT true,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='categories' AND column_name='is_active') THEN
        ALTER TABLE categories ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_sort ON categories(tenant_id, sort_order);

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_authenticated_all ON categories
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY categories_anon_all ON categories
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY categories_service_role ON categories
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 5. TABLA: products
-- =====================================================================
CREATE TABLE IF NOT EXISTS products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    price         NUMERIC NOT NULL DEFAULT 0,
    cost          NUMERIC DEFAULT 0,
    tax_rate      NUMERIC DEFAULT 10,
    category      TEXT,
    image_url     TEXT,
    is_available  BOOLEAN DEFAULT true,
    is_active     BOOLEAN DEFAULT true,
    stock         INTEGER DEFAULT 0,
    metadata      JSONB DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='category') THEN
        ALTER TABLE products ADD COLUMN category TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='tax_rate') THEN
        ALTER TABLE products ADD COLUMN tax_rate NUMERIC DEFAULT 10;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='stock') THEN
        ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='cost') THEN
        ALTER TABLE products ADD COLUMN cost NUMERIC DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='is_available') THEN
        ALTER TABLE products ADD COLUMN is_available BOOLEAN DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='is_active') THEN
        ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='products' AND column_name='description') THEN
        ALTER TABLE products ADD COLUMN description TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id, is_active);

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_authenticated_all ON products
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY products_anon_all ON products
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY products_service_role ON products
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 6. TABLA: dining_tables (mesas)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dining_tables (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    table_number     TEXT NOT NULL,
    seats            INTEGER DEFAULT 4,
    section          TEXT DEFAULT 'main',
    status           TEXT DEFAULT 'free',
    current_order_id UUID,
    metadata         JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, table_number)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='section') THEN
        ALTER TABLE dining_tables ADD COLUMN section TEXT DEFAULT 'main';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='status') THEN
        ALTER TABLE dining_tables ADD COLUMN status TEXT DEFAULT 'free';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='current_order_id') THEN
        ALTER TABLE dining_tables ADD COLUMN current_order_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='seats') THEN
        ALTER TABLE dining_tables ADD COLUMN seats INTEGER DEFAULT 4;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dining_tables_tenant ON dining_tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_tenant_status ON dining_tables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dining_tables_current_order ON dining_tables(current_order_id);

DROP TRIGGER IF EXISTS trg_dining_tables_updated_at ON dining_tables;
CREATE TRIGGER trg_dining_tables_updated_at
    BEFORE UPDATE ON dining_tables
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY dining_tables_authenticated_all ON dining_tables
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY dining_tables_anon_all ON dining_tables
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY dining_tables_service_role ON dining_tables
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 7. TABLA: waiters (camareros con PIN)
-- =====================================================================
CREATE TABLE IF NOT EXISTS waiters (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    username   TEXT NOT NULL,
    full_name  TEXT,
    pin        TEXT,
    role       TEXT DEFAULT 'waiter',
    is_active  BOOLEAN DEFAULT true,
    metadata   JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, username)
);

CREATE INDEX IF NOT EXISTS idx_waiters_tenant ON waiters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_waiters_tenant_pin ON waiters(tenant_id, pin);

DROP TRIGGER IF EXISTS trg_waiters_updated_at ON waiters;
CREATE TRIGGER trg_waiters_updated_at
    BEFORE UPDATE ON waiters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE waiters ENABLE ROW LEVEL SECURITY;

CREATE POLICY waiters_authenticated_all ON waiters
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY waiters_anon_all ON waiters
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY waiters_service_role ON waiters
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 8. TABLA: orders (ventas cerradas)
-- =====================================================================
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number  INTEGER,
    series          TEXT DEFAULT 'T-F',
    waiter_name     TEXT,
    subtotal        NUMERIC DEFAULT 0,
    tax_total       NUMERIC DEFAULT 0,
    total           NUMERIC NOT NULL DEFAULT 0,
    payment_method  TEXT DEFAULT 'cash',
    payment_ref     TEXT,
    status          TEXT DEFAULT 'closed',
    items_count     INTEGER DEFAULT 0,
    notes           TEXT,
    cancelled_at    TIMESTAMPTZ,
    cancelled_reason TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='invoice_number') THEN
        ALTER TABLE orders ADD COLUMN invoice_number INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='series') THEN
        ALTER TABLE orders ADD COLUMN series TEXT DEFAULT 'T-F';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='payment_ref') THEN
        ALTER TABLE orders ADD COLUMN payment_ref TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='cancelled_at') THEN
        ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='cancelled_reason') THEN
        ALTER TABLE orders ADD COLUMN cancelled_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='items_count') THEN
        ALTER TABLE orders ADD COLUMN items_count INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='status') THEN
        ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'closed';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_invoice ON orders(tenant_id, series, invoice_number);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_authenticated_all ON orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY orders_anon_all ON orders
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY orders_service_role ON orders
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 9. TABLA: order_items (líneas de venta)
-- =====================================================================
CREATE TABLE IF NOT EXISTS order_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    quantity    NUMERIC NOT NULL DEFAULT 1,
    unit_price  NUMERIC NOT NULL DEFAULT 0,
    subtotal    NUMERIC,
    tax_rate    NUMERIC DEFAULT 10,
    notes       TEXT,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='tenant_id') THEN
        ALTER TABLE order_items ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='order_id') THEN
        ALTER TABLE order_items ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='product_id') THEN
        ALTER TABLE order_items ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='quantity') THEN
        ALTER TABLE order_items ADD COLUMN quantity NUMERIC DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='unit_price') THEN
        ALTER TABLE order_items ADD COLUMN unit_price NUMERIC DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='subtotal') THEN
        ALTER TABLE order_items ADD COLUMN subtotal NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='tax_rate') THEN
        ALTER TABLE order_items ADD COLUMN tax_rate NUMERIC DEFAULT 10;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='notes') THEN
        ALTER TABLE order_items ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='name') THEN
        ALTER TABLE order_items ADD COLUMN name TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_authenticated_all ON order_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_items_anon_all ON order_items
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY order_items_service_role ON order_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 10. TABLA: open_orders (comandas abiertas en mesa)
-- =====================================================================
CREATE TABLE IF NOT EXISTS open_orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    table_id      TEXT,
    table_number  TEXT NOT NULL,
    order_id      UUID REFERENCES orders(id) ON DELETE CASCADE,
    items         JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes         TEXT,
    waiter_name   TEXT,
    status        TEXT DEFAULT 'open',
    metadata      JSONB DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, table_number)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='table_id') THEN
        ALTER TABLE open_orders ADD COLUMN table_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='order_id') THEN
        ALTER TABLE open_orders ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='waiter_name') THEN
        ALTER TABLE open_orders ADD COLUMN waiter_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='status') THEN
        ALTER TABLE open_orders ADD COLUMN status TEXT DEFAULT 'open';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_open_orders_tenant ON open_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_open_orders_tenant_table ON open_orders(tenant_id, table_number);
CREATE INDEX IF NOT EXISTS idx_open_orders_status ON open_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_open_orders_order ON open_orders(order_id);

DROP TRIGGER IF EXISTS trg_open_orders_updated_at ON open_orders;
CREATE TRIGGER trg_open_orders_updated_at
    BEFORE UPDATE ON open_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE open_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY open_orders_authenticated_all ON open_orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY open_orders_anon_all ON open_orders
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY open_orders_service_role ON open_orders
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 11. TABLA: payments (pagos múltiples)
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_method  TEXT NOT NULL DEFAULT 'cash',
    amount          NUMERIC NOT NULL DEFAULT 0,
    payment_ref     TEXT,
    paid_at         TIMESTAMPTZ DEFAULT now(),
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_authenticated_all ON payments
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY payments_anon_all ON payments
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY payments_service_role ON payments
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 12. TABLA: leads_onboarding (leads del wizard)
-- =====================================================================
CREATE TABLE IF NOT EXISTS leads_onboarding (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT,
    full_name   TEXT,
    phone       TEXT,
    business_name TEXT,
    source      TEXT DEFAULT 'web',
    metadata    JSONB DEFAULT '{}'::jsonb,
    status      TEXT DEFAULT 'new',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads_onboarding(email);

ALTER TABLE leads_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_authenticated_all ON leads_onboarding
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY leads_anon_insert ON leads_onboarding
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY leads_anon_select ON leads_onboarding
    FOR SELECT TO anon USING (true);
CREATE POLICY leads_service_role ON leads_onboarding
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 13. TABLA: email_outbox (cola de emails transaccionales)
-- =====================================================================
CREATE TABLE IF NOT EXISTS email_outbox (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    to_email    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    body        TEXT,
    html_body   TEXT,
    template    TEXT,
    status      TEXT DEFAULT 'pending',
    sent_at     TIMESTAMPTZ,
    error_msg   TEXT,
    attempts    INTEGER DEFAULT 0,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_tenant ON email_outbox(tenant_id);

DROP TRIGGER IF EXISTS trg_email_outbox_updated_at ON email_outbox;
CREATE TRIGGER trg_email_outbox_updated_at
    BEFORE UPDATE ON email_outbox
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_service_role ON email_outbox
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY email_outbox_authenticated_all ON email_outbox
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 14. TABLA: cash_closures (cierres de caja)
-- =====================================================================
CREATE TABLE IF NOT EXISTS cash_closures (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    closed_by   TEXT,
    opening_amount NUMERIC DEFAULT 0,
    closing_amount NUMERIC DEFAULT 0,
    expected_amount NUMERIC DEFAULT 0,
    diff_amount NUMERIC DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    notes       TEXT,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_closures_tenant ON cash_closures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cash_closures_tenant_created ON cash_closures(tenant_id, created_at DESC);

ALTER TABLE cash_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_closures_authenticated_all ON cash_closures
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY cash_closures_anon_all ON cash_closures
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY cash_closures_service_role ON cash_closures
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 15. TABLA: tenant_users (relación M2M users ↔ tenants)
-- =====================================================================
CREATE TABLE IF NOT EXISTS tenant_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT DEFAULT 'member',
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_users_authenticated_all ON tenant_users
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tenant_users_anon_all ON tenant_users
    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY tenant_users_service_role ON tenant_users
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 16. FK CASCADE RESTANTE — orders.current_order_id y otras
-- =====================================================================
DO $$
BEGIN
    -- dining_tables.current_order_id → orders(id) ON DELETE SET NULL
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='dining_tables' AND column_name='current_order_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dining_tables_current_order_fk'
          AND table_name = 'dining_tables'
    ) THEN
        BEGIN
            ALTER TABLE dining_tables
                ADD CONSTRAINT dining_tables_current_order_fk
                FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'dining_tables.current_order_id FK: %', SQLERRM;
        END;
    END IF;
END $$;

-- =====================================================================
-- 17. TRIGGERS: set_updated_at + categorías auto
CREATE OR REPLACE FUNCTION fn_create_default_categories()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO categories (tenant_id, name, sort_order) VALUES
        (NEW.id, 'Entrantes', 10),
        (NEW.id, 'Carnes',    20),
        (NEW.id, 'Pescados',  30),
        (NEW.id, 'Pizzas',    40),
        (NEW.id, 'Pastas',    50),
        (NEW.id, 'Bebidas',   60),
        (NEW.id, 'Postres',   70),
        (NEW.id, 'Extras',    80)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tenant_create_categories ON tenants;
CREATE TRIGGER trg_tenant_create_categories
    AFTER INSERT ON tenants
    FOR EACH ROW EXECUTE FUNCTION fn_create_default_categories();

-- =====================================================================
-- 18. PRODUCTS DEFAULT CATEGORY (columna category fallback)
-- =====================================================================
ALTER TABLE products ALTER COLUMN category SET DEFAULT 'Otros';

-- =====================================================================
-- 19. RECARGA DE CACHÉ POSTGREST (CRÍTICO — al final)
-- =====================================================================
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20. VERIFICACIÓN FINAL
-- =====================================================================
SELECT 'tables' AS check, COUNT(*) AS cnt FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN (
        'tenants','tenant_settings','users','categories',
        'products','dining_tables','waiters','orders',
        'order_items','open_orders','payments',
        'leads_onboarding','email_outbox','cash_closures',
        'tenant_users'
    )
UNION ALL
SELECT 'FK_cascade_total', COUNT(*) FROM information_schema.referential_constraints
    WHERE delete_rule='CASCADE'
UNION ALL
SELECT 'policies_total', COUNT(*) FROM pg_policies
UNION ALL
SELECT 'triggers_total', COUNT(*) FROM information_schema.triggers
    WHERE trigger_schema='public';
