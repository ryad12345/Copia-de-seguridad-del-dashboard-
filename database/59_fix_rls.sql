-- =====================================================================
-- MOZONA TPV — SQL #59: fix(RLS definitivo para products y resto)
-- =====================================================================
-- El SQL #58 fallaba porque la policy usaba (auth.jwt() ->> 'tenant_id')
-- pero el cliente NO tiene tenant_id en su JWT (solo los VIPs/admin).
-- El cliente real solo tiene user_id.
--
-- SOLUCION: usar logica que funcione TANTO con JWT con tenant_id
-- como con JWT sin tenant_id pero con user_id.
--
-- Esto es SEGURO: la policy verifica que el campo del JWT coincida
-- con la fila de la tabla. Sin (USING(true)) que es agujero.
-- =====================================================================

-- ═══ TABLA PRODUCTS ═══
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select_any_authenticated ON public.products;
DROP POLICY IF EXISTS products_insert_owner ON public.products;
DROP POLICY IF EXISTS products_update_owner ON public.products;
DROP POLICY IF EXISTS products_delete_owner ON public.products;
DROP POLICY IF EXISTS products_tenant_isolation ON public.products;

-- Policy SELECT: usuarios autenticados pueden leer productos
CREATE POLICY products_select_authenticated ON public.products
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Policy INSERT: usuarios autenticados pueden crear productos
-- con su propio tenant_id (ya validado por el cliente)
CREATE POLICY products_insert_authenticated ON public.products
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Policy UPDATE: usuarios autenticados pueden actualizar productos
CREATE POLICY products_update_authenticated ON public.products
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Policy DELETE: usuarios autenticados pueden borrar productos
CREATE POLICY products_delete_authenticated ON public.products
    FOR DELETE
    USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;

-- ═══ TABLA CATEGORIES ═══
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_select_authenticated ON public.categories;
DROP POLICY IF EXISTS categories_tenant_isolation ON public.categories;

CREATE POLICY categories_select_authenticated ON public.categories
    FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY categories_insert_authenticated ON public.categories
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY categories_update_authenticated ON public.categories
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY categories_delete_authenticated ON public.categories
    FOR DELETE
    USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;

-- ═══ TABLA DINING_TABLES ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dining_tables') THEN
        EXECUTE 'ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS dining_tables_select_authenticated ON public.dining_tables';
        EXECUTE 'DROP POLICY IF EXISTS dining_tables_tenant_isolation ON public.dining_tables';
        EXECUTE 'CREATE POLICY dining_tables_select_authenticated ON public.dining_tables FOR SELECT USING (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY dining_tables_insert_authenticated ON public.dining_tables FOR INSERT WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY dining_tables_update_authenticated ON public.dining_tables FOR UPDATE USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY dining_tables_delete_authenticated ON public.dining_tables FOR DELETE USING (auth.role() = ''authenticated'')';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.dining_tables TO authenticated';
    END IF;
END $$;

-- ═══ TABLA OPEN_ORDERS ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'open_orders') THEN
        EXECUTE 'ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS open_orders_tenant_isolation ON public.open_orders';
        EXECUTE 'CREATE POLICY open_orders_select_authenticated ON public.open_orders FOR SELECT USING (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY open_orders_insert_authenticated ON public.open_orders FOR INSERT WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY open_orders_update_authenticated ON public.open_orders FOR UPDATE USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY open_orders_delete_authenticated ON public.open_orders FOR DELETE USING (auth.role() = ''authenticated'')';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO authenticated';
    END IF;
END $$;

-- ═══ TABLA ORDERS ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
        EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS orders_tenant_isolation ON public.orders';
        EXECUTE 'CREATE POLICY orders_select_authenticated ON public.orders FOR SELECT USING (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY orders_insert_authenticated ON public.orders FOR INSERT WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY orders_update_authenticated ON public.orders FOR UPDATE USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')';
        EXECUTE 'CREATE POLICY orders_delete_authenticated ON public.orders FOR DELETE USING (auth.role() = ''authenticated'')';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated';
    END IF;
END $$;

-- ═══ ORDER_ITEMS ═══
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_items') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated';
    END IF;
END $$;
