-- =====================================================================
-- MOZONA TPV — 20_dining_tables_rpc.sql
-- =====================================================================
-- Tabla REAL: public.dining_tables (NO public.tables)
-- Columnas: id, tenant_id, name ("S-1", "B-6"), zone, status, current_order_id
-- =====================================================================

-- ============================================================
-- 1. Funcion RPC: get_dining_tables(p_tenant_id)
--    Lee MESAS bypaseando RLS para camareros/anonimos
-- ============================================================
DROP FUNCTION IF EXISTS public.get_dining_tables(UUID);
CREATE OR REPLACE FUNCTION public.get_dining_tables(p_tenant_id UUID)
RETURNS SETOF public.dining_tables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT *
    FROM public.dining_tables
    WHERE tenant_id = p_tenant_id
    ORDER BY zone ASC, name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dining_tables(UUID) TO anon, authenticated, service_role;

-- ============================================================
-- 2. Funcion RPC: get_all_dining_tables()
--    Lee TODAS las mesas (para superadmin/VIP)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_all_dining_tables();
CREATE OR REPLACE FUNCTION public.get_all_dining_tables()
RETURNS SETOF public.dining_tables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.dining_tables
    ORDER BY tenant_id ASC, zone ASC, name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_dining_tables() TO anon, authenticated, service_role;

-- ============================================================
-- 3. Politicas RLS permisivas para dining_tables
-- ============================================================
DO $$
BEGIN
    ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP POLICY IF EXISTS "dining_tables_select_owner" ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_all_owner"    ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_all"   ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_public" ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_modify_owner" ON public.dining_tables;

-- Lectura publica (incluye anon)
CREATE POLICY "dining_tables_select_public" ON public.dining_tables
FOR SELECT TO anon, authenticated
USING (true);

-- Modificacion solo owner/superadmin
CREATE POLICY "dining_tables_modify_owner" ON public.dining_tables
FOR ALL TO authenticated
USING (
    is_tenant_owner(tenant_id) OR is_superadmin()
)
WITH CHECK (
    is_tenant_owner(tenant_id) OR is_superadmin()
);

-- ============================================================
-- 4. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
    'get_dining_tables' AS function_name,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dining_tables')::text AS exists
UNION ALL
SELECT
    'get_all_dining_tables',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_all_dining_tables')::text;

-- ============================================================
-- INSTRUCCIONES
-- ============================================================
-- 1) Ejecuta este script en Supabase SQL Editor
-- 2) El camarero puede ver las mesas via RPC
-- 3) Las mesas son visibles para todos (lectura publica)
-- 4) Solo el owner/superadmin puede modificarlas
