-- =====================================================================
-- MOZONA TPV — Fix RLS recursivo en tabla tenants (v4.0.7)
-- =====================================================================
-- PROBLEMA: infinite recursion detected in policy for relation "tenants"
-- CAUSA:    Alguna policy de tenants consulta tenants (auto-referencia)
--           via subquery en USING o WITH CHECK, causando recursion infinita.
--
-- SOLUCION: Eliminar todas las policies problematicas y recrearlas
--           SIN auto-referencia.
--
-- ANTES:    tenants tiene policy que hace
--             USING (EXISTS (SELECT 1 FROM tenants WHERE ...))
--           Esto causa recursion infinita.
--
-- DESPUES:  policies simples sin subqueries a la misma tabla.
-- =====================================================================

-- 1) Eliminar TODAS las policies existentes de tenants (incluyendo las problematicas)
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tenants'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.tenants', policy_record.policyname);
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- 2) Asegurar RLS habilitado
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 3) Crear policies LIMPIAS sin auto-referencia

-- ★ Policy 1: SELECT público (cualquiera puede leer datos básicos)
CREATE POLICY "tenants_select_public"
    ON public.tenants
    FOR SELECT
    USING (true);

-- ★ Policy 2: INSERT solo para VIPs (whitelist por email JWT)
--   NO usa subquery a tenants (sin recursion)
CREATE POLICY "tenants_insert_vip_only"
    ON public.tenants
    FOR INSERT
    WITH CHECK (
        -- Solo VIPs o service_role pueden crear tenants
        coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', '') IN (
            'chalohiahmd1980@gmail.com',
            'rofixinsta@gmail.com'
        )
        OR coalesce(current_setting('role', true), '') = 'service_role'
        OR current_setting('is_superuser', true) = 'on'
    );

-- ★ Policy 3: UPDATE solo para VIPs o owner del tenant
--   Usa auth.uid() directo, NO subquery a tenants
CREATE POLICY "tenants_update_owner_or_vip"
    ON public.tenants
    FOR UPDATE
    USING (
        -- VIP por email JWT
        coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', '') IN (
            'chalohiahmd1980@gmail.com',
            'rofixinsta@gmail.com'
        )
        -- Service role puede todo
        OR coalesce(current_setting('role', true), '') = 'service_role'
        OR current_setting('is_superuser', true) = 'on'
        -- Owner via metadata (no subquery)
        OR owner_id::text = coalesce(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')
    )
    WITH CHECK (
        coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', '') IN (
            'chalohiahmd1980@gmail.com',
            'rofixinsta@gmail.com'
        )
        OR coalesce(current_setting('role', true), '') = 'service_role'
        OR current_setting('is_superuser', true) = 'on'
        OR owner_id::text = coalesce(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')
    );

-- ★ Policy 4: DELETE solo para VIPs (proteccion maxima)
CREATE POLICY "tenants_delete_vip_only"
    ON public.tenants
    FOR DELETE
    USING (
        coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', '') IN (
            'chalohiahmd1980@gmail.com',
            'rofixinsta@gmail.com'
        )
        OR coalesce(current_setting('role', true), '') = 'service_role'
        OR current_setting('is_superuser', true) = 'on'
    );

-- 4) Verificar recursion eliminada
DO $$
BEGIN
    RAISE NOTICE '✓ Policies de tenants recreadas sin recursion';
    RAISE NOTICE '★ SELECT: publico';
    RAISE NOTICE '★ INSERT: solo VIP';
    RAISE NOTICE '★ UPDATE: VIP o owner';
    RAISE NOTICE '★ DELETE: solo VIP';
END $$;
