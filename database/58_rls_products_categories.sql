-- =====================================================================
-- MOZONA TPV — SQL #58: fix(RLS en products/categories/etc)
-- =====================================================================
-- Auditoria: cliente guardaba productos y daba 42501 RLS error.
-- La tabla products sin política de INSERT para usuarios autenticados.
-- =====================================================================

-- ═══ TABLA PRODUCTS ═══
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_tenant_isolation ON public.products;
CREATE POLICY products_tenant_isolation ON public.products
    FOR ALL
    USING (tenant_id::text = (auth.jwt() ->> 'tenant_id'))
    WITH CHECK (tenant_id::text = (auth.jwt() ->> 'tenant_id'));

-- ═══ TABLA CATEGORIES ═══
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_tenant_isolation ON public.categories;
CREATE POLICY categories_tenant_isolation ON public.categories
    FOR ALL
    USING (tenant_id::text = (auth.jwt() ->> 'tenant_id'))
    WITH CHECK (tenant_id::text = (auth.jwt() ->> 'tenant_id'));

-- ═══ TABLA DINING_TABLES ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dining_tables') THEN
        EXECUTE 'ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS dining_tables_tenant_isolation ON public.dining_tables';
        EXECUTE '
            CREATE POLICY dining_tables_tenant_isolation ON public.dining_tables
            FOR ALL
            USING (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
            WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
        ';
    END IF;
END $$;

-- ═══ TABLA OPEN_ORDERS / ORDERS ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'open_orders') THEN
        EXECUTE 'ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS open_orders_tenant_isolation ON public.open_orders';
        EXECUTE '
            CREATE POLICY open_orders_tenant_isolation ON public.open_orders
            FOR ALL
            USING (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
            WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
        ';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
        EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS orders_tenant_isolation ON public.orders';
        EXECUTE '
            CREATE POLICY orders_tenant_isolation ON public.orders
            FOR ALL
            USING (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
            WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))
        ';
    END IF;
END $$;

-- ═══ PERMISOS PARA authenticated role ═══
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dining_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
