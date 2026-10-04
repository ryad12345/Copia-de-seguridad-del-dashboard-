-- =====================================================================
-- MOZONA TPV — 19_waiter_tables_rpc.sql
-- =====================================================================
-- SOLUCION: camareros (y anonimos) pueden leer mesas de su tenant
-- via RPC con SECURITY DEFINER (bypasa RLS)
-- =====================================================================

-- ============================================================
-- 1. Verificar si la tabla es 'tables' o 'dining_tables'
-- ============================================================
DO $$
DECLARE
    v_table_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tables') THEN
        v_table_name := 'tables';
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dining_tables') THEN
        v_table_name := 'dining_tables';
    ELSE
        RAISE EXCEPTION 'No existe ni public.tables ni public.dining_tables';
    END IF;
    RAISE NOTICE 'Usando tabla: %', v_table_name;
END $$;

-- ============================================================
-- 2. Funcion RPC: get_waiter_tables(p_tenant_id)
-- ============================================================
-- Lee mesas de un tenant bypaseando RLS
-- Util para camareros y vistas anonimas
DROP FUNCTION IF EXISTS public.get_waiter_tables(UUID);
CREATE OR REPLACE FUNCTION public.get_waiter_tables(p_tenant_id UUID)
RETURNS SETOF public.tables
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
    FROM public.tables
    WHERE tenant_id = p_tenant_id
    ORDER BY number ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_waiter_tables(UUID) TO anon, authenticated, service_role;

-- ============================================================
-- 3. Variante para dining_tables (alias)
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
    ORDER BY number ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dining_tables(UUID) TO anon, authenticated, service_role;

-- ============================================================
-- 4. Politica RLS adicional: permitir SELECT a anon si tiene tenant_id
-- ============================================================
DO $$
BEGIN
    -- Habilitar RLS si esta deshabilitado
    ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Eliminar policies restrictivas viejas
DROP POLICY IF EXISTS "tables_select_owner" ON public.tables;
DROP POLICY IF EXISTS "tables_all_owner"    ON public.tables;
DROP POLICY IF EXISTS "tables_select_all"   ON public.tables;

-- Policy: SELECT para todos (lectura publica de mesas)
-- Las mutaciones (INSERT/UPDATE/DELETE) siguen siendo del owner
CREATE POLICY "tables_select_public" ON public.tables FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "tables_modify_owner" ON public.tables FOR ALL TO authenticated
USING (
    is_tenant_owner(tenant_id) OR is_superadmin()
)
WITH CHECK (
    is_tenant_owner(tenant_id) OR is_superadmin()
);

-- ============================================================
-- 5. Politica equivalente para dining_tables
-- ============================================================
DO $$
BEGIN
    ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP POLICY IF EXISTS "dining_tables_select_owner" ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_all_owner"    ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_all"   ON public.dining_tables;

CREATE POLICY "dining_tables_select_public" ON public.dining_tables FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "dining_tables_modify_owner" ON public.dining_tables FOR ALL TO authenticated
USING (
    is_tenant_owner(tenant_id) OR is_superadmin()
)
WITH CHECK (
    is_tenant_owner(tenant_id) OR is_superadmin()
);

-- ============================================================
-- 6. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
    'get_waiter_tables' AS function_name,
    EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'get_waiter_tables'
    )::text AS exists;

-- ============================================================
-- INSTRUCCIONES
-- ============================================================
-- 1) Ejecuta este script en Supabase SQL Editor
-- 2) El camarero (incluso anon) puede ver las mesas via RPC
-- 3) Las mesas son visibles para todos (lectura publica)
-- 4) Solo el owner/superadmin puede modificarlas
