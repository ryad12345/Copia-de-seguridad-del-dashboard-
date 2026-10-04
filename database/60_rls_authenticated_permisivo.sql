-- =====================================================================
-- SQL #60 — RLS PERMISIVO PARA authenticated (FIX DEFINITIVO)
-- =====================================================================
-- Problema:
--   Las policies con auth.jwt() ->> 'tenant_id' NO funcionan para
--   clientes VIP cuyo JWT no incluye tenant_id (solo user_id).
--   El cliente Supabase usa anon_key + JWT del usuario.
--   Si las policies usan auth.role() = 'authenticated', debería funcionar.
--
-- Este SQL es la versión DEFINITIVA:
--   - Habilita RLS en TODAS las tablas
--   - Policies con auth.role() = 'authenticated' (compatible con todos los JWTs)
--   - GRANT SELECT/INSERT/UPDATE/DELETE a authenticated
--   - Mantiene anon como solo-lectura mínima
-- =====================================================================

-- 1. Habilitar RLS en tablas clave
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tables_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.waiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.open_orders ENABLE ROW LEVEL SECURITY;

-- 2. Policies permisivas para authenticated (FIX PRINCIPAL)
-- PRODUCTS
DROP POLICY IF EXISTS products_all_authenticated ON public.products;
CREATE POLICY products_all_authenticated ON public.products
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- CATEGORIES
DROP POLICY IF EXISTS categories_all_authenticated ON public.categories;
CREATE POLICY categories_all_authenticated ON public.categories
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- TENANTS
DROP POLICY IF EXISTS tenants_all_authenticated ON public.tenants;
CREATE POLICY tenants_all_authenticated ON public.tenants
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- DINING_TABLES
DROP POLICY IF EXISTS dining_tables_all_authenticated ON public.dining_tables;
CREATE POLICY dining_tables_all_authenticated ON public.dining_tables
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- TABLES_NEW (legacy)
DROP POLICY IF EXISTS tables_new_all_authenticated ON public.tables_new;
CREATE POLICY tables_new_all_authenticated ON public.tables_new
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- WAITERS
DROP POLICY IF EXISTS waiters_all_authenticated ON public.waiters;
CREATE POLICY waiters_all_authenticated ON public.waiters
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- ORDERS
DROP POLICY IF EXISTS orders_all_authenticated ON public.orders;
CREATE POLICY orders_all_authenticated ON public.orders
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- ORDER_ITEMS
DROP POLICY IF EXISTS order_items_all_authenticated ON public.order_items;
CREATE POLICY order_items_all_authenticated ON public.order_items
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- OPEN_ORDERS
DROP POLICY IF EXISTS open_orders_all_authenticated ON public.open_orders;
CREATE POLICY open_orders_all_authenticated ON public.open_orders
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- 3. GRANT permisos al rol authenticated
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dining_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tables_new TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.waiters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO authenticated;

-- 4. anon: solo lectura básica (count, structure)
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.categories TO anon;

-- =====================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =====================================================================
-- Ejecutar en SQL Editor:
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
--
-- Debe mostrar 9 policies nuevas con nombre *_all_authenticated
-- =====================================================================
