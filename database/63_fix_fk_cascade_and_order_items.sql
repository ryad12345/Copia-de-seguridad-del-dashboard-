-- =====================================================================
-- MOZONA TPV — SQL #63 (FIX FK CASCADE + order_items SCHEMA)
-- =====================================================================
-- Resuelve los problemas:
-- ERROR 3: Imposibilidad de borrar ventas por FK sin CASCADE
-- ERROR 4: order_items PGRST204 — columnas faltantes
--
-- Ejecutar en: https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/sql/new
-- =====================================================================

-- =====================================================================
-- 1. ASEGURAR COLUMNAS EN order_items (por si PGRST cache es stale)
-- =====================================================================
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();

-- Solo añadir columnas si NO existen (evita error)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='tenant_id') THEN
        ALTER TABLE order_items ADD COLUMN tenant_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='order_id') THEN
        ALTER TABLE order_items ADD COLUMN order_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='product_id') THEN
        ALTER TABLE order_items ADD COLUMN product_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='name') THEN
        ALTER TABLE order_items ADD COLUMN name TEXT;
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
                   WHERE table_name='order_items' AND column_name='tax_rate') THEN
        ALTER TABLE order_items ADD COLUMN tax_rate NUMERIC DEFAULT 10;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='notes') THEN
        ALTER TABLE order_items ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='subtotal') THEN
        ALTER TABLE order_items ADD COLUMN subtotal NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='created_at') THEN
        ALTER TABLE order_items ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;

-- =====================================================================
-- 2. FK CONSTRAINTS CON ON DELETE CASCADE
-- =====================================================================

-- FK order_items.order_id → orders.id (CASCADE)
DO $$
BEGIN
    -- Borrar FK existente si NO tiene CASCADE
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'order_items_order_id_fkey'
        AND table_name = 'order_items'
    ) THEN
        ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
    END IF;

    -- Crear FK con CASCADE
    ALTER TABLE order_items
        ADD CONSTRAINT order_items_order_id_fkey
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'order_items FK order_id: %', SQLERRM;
END $$;

-- FK order_items.tenant_id → tenants.id (CASCADE)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'order_items_tenant_id_fkey'
        AND table_name = 'order_items'
    ) THEN
        ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_tenant_id_fkey;
    END IF;
    ALTER TABLE order_items
        ADD CONSTRAINT order_items_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'order_items FK tenant_id: %', SQLERRM;
END $$;

-- FK orders.tenant_id → tenants.id (CASCADE)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'orders_tenant_id_fkey'
        AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tenant_id_fkey;
    END IF;
    ALTER TABLE orders
        ADD CONSTRAINT orders_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'orders FK tenant_id: %', SQLERRM;
END $$;

-- FK open_orders.tenant_id → tenants.id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'open_orders_tenant_id_fkey'
        AND table_name = 'open_orders'
    ) THEN
        ALTER TABLE open_orders DROP CONSTRAINT IF EXISTS open_orders_tenant_id_fkey;
    END IF;
    ALTER TABLE open_orders
        ADD CONSTRAINT open_orders_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'open_orders FK tenant_id: %', SQLERRM;
END $$;

-- FK products.tenant_id → tenants.id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'products_tenant_id_fkey'
        AND table_name = 'products'
    ) THEN
        ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tenant_id_fkey;
    END IF;
    ALTER TABLE products
        ADD CONSTRAINT products_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'products FK tenant_id: %', SQLERRM;
END $$;

-- FK categories.tenant_id → tenants.id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'categories_tenant_id_fkey'
        AND table_name = 'categories'
    ) THEN
        ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_tenant_id_fkey;
    END IF;
    ALTER TABLE categories
        ADD CONSTRAINT categories_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'categories FK tenant_id: %', SQLERRM;
END $$;

-- FK dining_tables.tenant_id → tenants.id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dining_tables_tenant_id_fkey'
        AND table_name = 'dining_tables'
    ) THEN
        ALTER TABLE dining_tables DROP CONSTRAINT IF EXISTS dining_tables_tenant_id_fkey;
    END IF;
    ALTER TABLE dining_tables
        ADD CONSTRAINT dining_tables_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dining_tables FK tenant_id: %', SQLERRM;
END $$;

-- FK dining_tables.current_order_id → orders.id (SET NULL al borrar orden)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dining_tables_current_order_id_fkey'
        AND table_name = 'dining_tables'
    ) THEN
        ALTER TABLE dining_tables DROP CONSTRAINT IF EXISTS dining_tables_current_order_id_fkey;
    END IF;
    ALTER TABLE dining_tables
        ADD CONSTRAINT dining_tables_current_order_id_fkey
        FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dining_tables FK current_order_id: %', SQLERRM;
END $$;

-- FK open_orders.order_id → orders.id (CASCADE)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'open_orders_order_id_fkey'
        AND table_name = 'open_orders'
    ) THEN
        ALTER TABLE open_orders DROP CONSTRAINT IF EXISTS open_orders_order_id_fkey;
    END IF;
    ALTER TABLE open_orders
        ADD CONSTRAINT open_orders_order_id_fkey
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'open_orders FK order_id: %', SQLERRM;
END $$;

-- =====================================================================
-- 3. INDICES PARA RENDIMIENTO
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dining_tables_tenant ON dining_tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dining_tables_status ON dining_tables(tenant_id, status);

-- =====================================================================
-- 4. RLS PARA order_items (CRÍTICO — sin esto INSERT falla 401)
-- =====================================================================
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_authenticated_all_v63" ON order_items;
CREATE POLICY "order_items_authenticated_all_v63" ON order_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "order_items_anon_all_v63" ON order_items;
CREATE POLICY "order_items_anon_all_v63" ON order_items
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "order_items_service_role_v63" ON order_items;
CREATE POLICY "order_items_service_role_v63" ON order_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 5. RELOAD SCHEMA CACHE DE POSTGREST (CRÍTICO)
-- =====================================================================
-- Sin esto, PGRST puede seguir reportando PGRST204 en columnas recien creadas.
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 6. VERIFICACIÓN POST-MIGRACIÓN
-- =====================================================================
SELECT 'order_items_columns' AS check, COUNT(*) AS cols FROM information_schema.columns
    WHERE table_name='order_items'
UNION ALL
SELECT 'order_items_FK_cascade', COUNT(*) FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'order_items' AND rc.delete_rule = 'CASCADE'
UNION ALL
SELECT 'orders_FK_cascade', COUNT(*) FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'orders' AND rc.delete_rule = 'CASCADE'
UNION ALL
SELECT 'order_items_policies', COUNT(*) FROM pg_policies WHERE tablename = 'order_items';
