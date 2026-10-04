-- =====================================================================
-- MOZONA TPV — SQL #45 — Habilitar RLS en ticket_settings y tenant_settings
-- =====================================================================
-- PROBLEMA DETECTADO POR AUDITORIA:
--   Las tablas public.ticket_settings y public.tenant_settings
--   tienen RLS DESHABILITADO. Esto permite que anon y authenticated
--   lean/modifiquen filas sin protección.
--
-- SOLUCIÓN:
--   Habilitar RLS con políticas estrictas multi-tenant.
--   Solo el dueño del tenant puede leer/modificar sus settings.
--
-- EJECUTAR EN: Supabase Dashboard > SQL Editor > New Query
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ticket_settings — Aislamiento por tenant
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ticket_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_ticket_settings_select ON public.ticket_settings;
DROP POLICY IF EXISTS pol_ticket_settings_insert ON public.ticket_settings;
DROP POLICY IF EXISTS pol_ticket_settings_update ON public.ticket_settings;
DROP POLICY IF EXISTS pol_ticket_settings_delete ON public.ticket_settings;

-- SELECT: solo filas del tenant del usuario
CREATE POLICY pol_ticket_settings_select
    ON public.ticket_settings FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- INSERT: solo a su propio tenant
CREATE POLICY pol_ticket_settings_insert
    ON public.ticket_settings FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- UPDATE: solo su tenant, mantiene tenant_id
CREATE POLICY pol_ticket_settings_update
    ON public.ticket_settings FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- DELETE: nadie (usar soft-delete si se necesita)
CREATE POLICY pol_ticket_settings_delete
    ON public.ticket_settings FOR DELETE
    TO authenticated
    USING (false);

GRANT SELECT, INSERT, UPDATE ON public.ticket_settings TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. tenant_settings — Aislamiento por tenant
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_tenant_settings_select ON public.tenant_settings;
DROP POLICY IF EXISTS pol_tenant_settings_insert ON public.tenant_settings;
DROP POLICY IF EXISTS pol_tenant_settings_update ON public.tenant_settings;
DROP POLICY IF EXISTS pol_tenant_settings_delete ON public.tenant_settings;

CREATE POLICY pol_tenant_settings_select
    ON public.tenant_settings FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_tenant_settings_insert
    ON public.tenant_settings FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_tenant_settings_update
    ON public.tenant_settings FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_tenant_settings_delete
    ON public.tenant_settings FOR DELETE
    TO authenticated
    USING (false);

GRANT SELECT, INSERT, UPDATE ON public.tenant_settings TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_ticket_rls BOOLEAN;
    v_tenant_rls BOOLEAN;
    v_ticket_policies INT;
    v_tenant_policies INT;
BEGIN
    SELECT relrowsecurity INTO v_ticket_rls FROM pg_class WHERE relname = 'ticket_settings';
    SELECT relrowsecurity INTO v_tenant_rls FROM pg_class WHERE relname = 'tenant_settings';

    SELECT count(*) INTO v_ticket_policies FROM pg_policies WHERE tablename = 'ticket_settings';
    SELECT count(*) INTO v_tenant_policies FROM pg_policies WHERE tablename = 'tenant_settings';

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #45 APLICADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  ticket_settings RLS: % (policies: %)', v_ticket_rls, v_ticket_policies;
    RAISE NOTICE '  tenant_settings RLS: % (policies: %)', v_tenant_rls, v_tenant_policies;
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;
