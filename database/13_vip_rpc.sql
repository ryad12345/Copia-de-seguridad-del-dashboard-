-- =====================================================================
-- MOZONA TPV — 13_vip_rpc.sql
-- =====================================================================
-- FIX CRÍTICO: 403 permission denied en RLS para el VIP bypass
--
-- Síntoma en consola:
--   [resolveRealTenantId] error: permission denied for table users
--   Failed to load resource: status of 403
--
-- Causa:
--   - La policy RLS de `tenants` llama is_superadmin()
--   - is_superadmin() hacía SELECT FROM auth.users (privilegio SYSTEM)
--   - El rol 'authenticated' no puede leer auth.users
--   - Resultado: 403 incluso para lecturas legítimas
--
-- Solución:
--   1) is_superadmin() y is_tenant_owner() con SECURITY DEFINER
--      (se ejecutan con privilegios del owner de la función)
--   2) RPC público get_first_active_tenant() que retorna el primer
--      tenant activo sin pasar por RLS
--   3) GRANT EXECUTE a anon y authenticated
--   4) Recargar PostgREST
-- =====================================================================

-- ============================================================
-- 1. is_superadmin() con SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (raw_user_meta_data->>'is_superadmin')::boolean
         FROM auth.users WHERE id = auth.uid()),
        FALSE
    );
$$;

-- Permitir que authenticated ejecute la función
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated, anon;

-- ============================================================
-- 2. is_tenant_owner() con SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_tenant_owner(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = tid AND owner_id = auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_owner(UUID) TO authenticated, anon;

-- ============================================================
-- 3. RPC get_first_active_tenant() — para el VIP bypass
-- ============================================================
-- Retorna el primer tenant activo. SECURITY DEFINER bypasea RLS.
-- Usado por resolveRealTenantId() en el frontend cuando el usuario
-- VIP no tiene owner_id sobre ningún tenant.
DROP FUNCTION IF EXISTS public.get_first_active_tenant();
CREATE OR REPLACE FUNCTION public.get_first_active_tenant()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.tenants
    WHERE subscription_status IN ('active', 'trialing', 'lifetime_vip', 'past_due')
    ORDER BY created_at ASC
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_first_active_tenant() TO authenticated, anon;

-- ============================================================
-- 4. RPC get_tenant_id_for_user() — devuelve tenant_id por user_id
-- ============================================================
-- Útil para casos en los que el frontend no sabe el tenant_id
DROP FUNCTION IF EXISTS public.get_tenant_id_for_user();
CREATE OR REPLACE FUNCTION public.get_tenant_id_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.tenants
    WHERE owner_id = p_user_id
    ORDER BY created_at ASC
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_id_for_user(UUID) TO authenticated, anon;

-- ============================================================
-- 5. Asegurar que el tenant VIP existe (idempotente)
-- ============================================================
-- Si no hay ningún tenant activo, el VIP no puede hacer nada.
-- Este bloque crea uno si no existe.
DO $$
DECLARE
    v_tenant_id UUID;
    v_owner_id  UUID;
BEGIN
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE subscription_status IN ('active', 'trialing', 'lifetime_vip')
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        -- Buscar el user de chalohiahmd1980
        SELECT id INTO v_owner_id
        FROM auth.users
        WHERE email = 'chalohiahmd1980@gmail.com'
        LIMIT 1;

        IF v_owner_id IS NULL THEN
            v_owner_id := '00000000-0000-0000-0000-000000000000'::uuid;
        END IF;

        INSERT INTO public.tenants (
            name, owner_id, subscription_status, plan, is_superadmin
        ) VALUES (
            'MOZONA TPV (Demo VIP)',
            v_owner_id,
            'lifetime_vip',
            'lifetime_vip',
            TRUE
        );
        RAISE NOTICE 'Tenant VIP creado';
    ELSE
        RAISE NOTICE 'Tenant activo existente: %', v_tenant_id;
    END IF;
END $$;

-- ============================================================
-- 6. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
    'is_superadmin_test' AS check_name,
    public.is_superadmin()::text AS value
UNION ALL
SELECT
    'get_first_active_tenant',
    public.get_first_active_tenant()::text
UNION ALL
SELECT
    'tenants_count',
    count(*)::text
FROM public.tenants
WHERE subscription_status IN ('active', 'trialing', 'lifetime_vip');

-- ============================================================
-- INSTRUCCIONES
-- ============================================================
-- 1) Ejecuta este script en Supabase SQL Editor
-- 2) Refresca /app con Ctrl+Shift+R
-- 3) Los errores 403 deben desaparecer
-- 4) resolveRealTenantId() ahora usa el RPC y bypassa RLS
-- ============================================================
