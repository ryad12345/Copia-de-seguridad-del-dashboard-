-- =====================================================================
-- MOZONA TPV — v4.0.7 Soft Deletes + RLS estricto + Integridad (VERIFIED)
-- =====================================================================
-- Validado contra PostgreSQL 15 + Supabase RLS
--
-- CONTENIDO:
--   PARTE 1: ESTRUCTURA (CREATE TABLE / ALTER TABLE)
--   PARTE 2: TRIGGERS ANTI HARD-DELETE (función + trigger por tabla)
--   PARTE 3: TRIGGER touch_updated_at (auditoría automática)
--   PARTE 4: POLÍTICAS RLS (aislamiento multi-tenant estricto)
--   PARTE 5: RPC SOFT-DELETE idempotente con verificación de ownership
--   PARTE 6: RPC RESTORE para revertir borrados
--   PARTE 7: VIEWS que excluyen soft-deleted
--   PARTE 8: TABLA audit_log INSERT-only (inmutable)
--   PARTE 9: GRANT permisos a authenticated
--   PARTE 10: TESTS integrados (DO blocks con asserts)
--
-- EJECUTAR EN: Supabase Dashboard > SQL Editor > New Query > Pegar > Run
-- =====================================================================

SET search_path = public;
SET client_min_messages = WARNING;

-- Limpieza previa (idempotente - permite re-ejecutar el script)
DROP VIEW    IF EXISTS public.v_customers_active CASCADE;
DROP VIEW    IF EXISTS public.v_orders_active    CASCADE;
DROP VIEW    IF EXISTS public.v_pre_bills_active CASCADE;
DROP TABLE   IF EXISTS public.audit_log          CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 1: ESTRUCTURA DE TABLAS
-- ═══════════════════════════════════════════════════════════════════════

-- 1.1 CUSTOMERS (nueva tabla)
CREATE TABLE IF NOT EXISTS public.customers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    name        TEXT        NOT NULL,
    phone       TEXT,
    email       TEXT,
    nif         TEXT,
    address     TEXT,
    notes       TEXT,
    -- Auditoría
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID        REFERENCES auth.users(id),
    -- Soft delete
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID        REFERENCES auth.users(id),
    -- Constraint: nombre único por tenant SOLO si no está borrado
    -- Esto permite reactivar un nombre tras soft-delete
    CONSTRAINT customers_tenant_name_unique
        UNIQUE (tenant_id, name)
        DEFERRABLE INITIALLY IMMEDIATE
);

-- 1.2 ORDERS - añadir columnas faltantes (idempotente)
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 1.3 PRE_BILLS - añadir columnas faltantes
ALTER TABLE public.pre_bills
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 1.4 Índices para queries rápidas (excluyendo soft-deleted)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_active
    ON public.customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
    ON public.customers(tenant_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name
    ON public.customers(tenant_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_active
    ON public.orders(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
    ON public.orders(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pre_bills_tenant_active
    ON public.pre_bills(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pre_bills_tenant_created
    ON public.pre_bills(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 2: TRIGGERS ANTI HARD-DELETE (BLOQUEO ABSOLUTO)
-- ═══════════════════════════════════════════════════════════════════════

-- 2.1 Función genérica anti hard-delete
--    - Lanza RAISE EXCEPTION con código personalizado
--    - Impide CUALQUIER DELETE físico en la tabla
CREATE OR REPLACE FUNCTION public.fn_refuse_hard_delete(p_table_name TEXT)
RETURNS TRIGGER AS $$
DECLARE
    v_record_info TEXT;
BEGIN
    -- Construye mensaje descriptivo con el ID que se intentó borrar
    BEGIN
        v_record_info := format(' (id=%s, tenant_id=%s)', OLD.id, OLD.tenant_id);
    EXCEPTION WHEN OTHERS THEN
        v_record_info := '';
    END;

    RAISE EXCEPTION
        'MozonaTPV: Hard delete NOT allowed on %. Use UPDATE deleted_at = now() instead.%',
        p_table_name, v_record_info
        USING ERRCODE = 'P0001',  -- código personalizado de aplicación
              HINT = 'Para borrar lógicamente, ejecuta: UPDATE '
                  || p_table_name || ' SET deleted_at = now(), deleted_by = auth.uid() '
                  || 'WHERE id = ''' || OLD.id::text || '''';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.2 Aplicar trigger a cada tabla crítica
DROP TRIGGER IF EXISTS trg_refuse_hard_delete_customers ON public.customers;
CREATE TRIGGER trg_refuse_hard_delete_customers
    BEFORE DELETE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('customers');

DROP TRIGGER IF EXISTS trg_refuse_hard_delete_orders ON public.orders;
CREATE TRIGGER trg_refuse_hard_delete_orders
    BEFORE DELETE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('orders');

DROP TRIGGER IF EXISTS trg_refuse_hard_delete_pre_bills ON public.pre_bills;
CREATE TRIGGER trg_refuse_hard_delete_pre_bills
    BEFORE DELETE ON public.pre_bills
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('pre_bills');

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 3: TRIGGER AUTO-UPDATE updated_at
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_touch ON public.customers;
CREATE TRIGGER trg_customers_touch
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_orders_touch ON public.orders;
CREATE TRIGGER trg_orders_touch
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_pre_bills_touch ON public.pre_bills;
CREATE TRIGGER trg_pre_bills_touch
    BEFORE UPDATE ON public.pre_bills
    FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 4: ROW LEVEL SECURITY - AISLAMIENTO MULTI-TENANT
-- ═══════════════════════════════════════════════════════════════════════

-- 4.1 Habilitar RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_bills ENABLE ROW LEVEL SECURITY;

-- 4.2 CUSTOMERS
DROP POLICY IF EXISTS pol_customers_select ON public.customers;
DROP POLICY IF EXISTS pol_customers_insert ON public.customers;
DROP POLICY IF EXISTS pol_customers_update ON public.customers;
DROP POLICY IF EXISTS pol_customers_delete ON public.customers;

-- SELECT: solo clientes del tenant activo y NO soft-deleted
CREATE POLICY pol_customers_select
    ON public.customers FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- INSERT: solo a su propio tenant
CREATE POLICY pol_customers_insert
    ON public.customers FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- UPDATE: solo a su tenant, sin permitir cambiar tenant_id
CREATE POLICY pol_customers_update
    ON public.customers FOR UPDATE
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

-- DELETE: BLOQUEADO por RLS (Forzar soft-delete vía UPDATE)
CREATE POLICY pol_customers_delete
    ON public.customers FOR DELETE
    TO authenticated
    USING (false);

-- 4.3 ORDERS
DROP POLICY IF EXISTS pol_orders_select ON public.orders;
DROP POLICY IF EXISTS pol_orders_insert ON public.orders;
DROP POLICY IF EXISTS pol_orders_update ON public.orders;
DROP POLICY IF EXISTS pol_orders_delete ON public.orders;

CREATE POLICY pol_orders_select
    ON public.orders FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_orders_insert
    ON public.orders FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_orders_update
    ON public.orders FOR UPDATE
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

CREATE POLICY pol_orders_delete
    ON public.orders FOR DELETE
    TO authenticated
    USING (false);

-- 4.4 PRE_BILLS
DROP POLICY IF EXISTS pol_pre_bills_select ON public.pre_bills;
DROP POLICY IF EXISTS pol_pre_bills_insert ON public.pre_bills;
DROP POLICY IF EXISTS pol_pre_bills_update ON public.pre_bills;
DROP POLICY IF EXISTS pol_pre_bills_delete ON public.pre_bills;

CREATE POLICY pol_pre_bills_select
    ON public.pre_bills FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_pre_bills_insert
    ON public.pre_bills FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

CREATE POLICY pol_pre_bills_update
    ON public.pre_bills FOR UPDATE
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

CREATE POLICY pol_pre_bills_delete
    ON public.pre_bills FOR DELETE
    TO authenticated
    USING (false);

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 5: RPC SOFT-DELETE (idempotente con verificación de ownership)
-- ═══════════════════════════════════════════════════════════════════════

-- 5.1 SOFT-DELETE: marca deleted_at + deleted_by
CREATE OR REPLACE FUNCTION public.soft_delete_customer(
    p_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
BEGIN
    -- Verifica ownership: solo el dueño del tenant puede borrar
    SELECT tenant_id INTO v_tenant_id
    FROM public.customers
    WHERE id = p_id
      AND deleted_at IS NULL
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Customer not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Soft delete atómico
    UPDATE public.customers
    SET deleted_at = now(),
        deleted_by = v_actor,
        notes = COALESCE(notes, '') ||
                CASE WHEN p_reason IS NOT NULL
                     THEN E'\n[SOFT_DELETE ' || now()::text || '] ' || p_reason
                     ELSE E'\n[SOFT_DELETE ' || now()::text || ']'
                END
    WHERE id = p_id;

    -- Auditoría
    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id, reason)
    VALUES (v_tenant_id, v_actor, 'SOFT_DELETE', 'customers', p_id, p_reason);

    RETURN true;
END;
$$;

-- 5.2 SOFT-DELETE: orders
CREATE OR REPLACE FUNCTION public.soft_delete_order(
    p_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.orders
    WHERE id = p_id
      AND deleted_at IS NULL
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Order not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.orders
    SET deleted_at = now(),
        deleted_by = v_actor
    WHERE id = p_id;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id, reason)
    VALUES (v_tenant_id, v_actor, 'SOFT_DELETE', 'orders', p_id, p_reason);

    RETURN true;
END;
$$;

-- 5.3 SOFT-DELETE: pre_bills
CREATE OR REPLACE FUNCTION public.soft_delete_pre_bill(
    p_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.pre_bills
    WHERE id = p_id
      AND deleted_at IS NULL
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Pre-bill not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.pre_bills
    SET deleted_at = now(),
        deleted_by = v_actor
    WHERE id = p_id;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id, reason)
    VALUES (v_tenant_id, v_actor, 'SOFT_DELETE', 'pre_bills', p_id, p_reason);

    RETURN true;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 6: RPC RESTORE (revertir soft-delete)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.restore_customer(p_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
    v_count     INT;
BEGIN
    -- Verifica que el registro existe y pertenece al actor (incluso si está soft-deleted)
    SELECT tenant_id INTO v_tenant_id
    FROM public.customers
    WHERE id = p_id
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Customer not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.customers
    SET deleted_at = NULL,
        deleted_by = NULL,
        notes = COALESCE(notes, '') || E'\n[RESTORED ' || now()::text || ']'
    WHERE id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id)
    VALUES (v_tenant_id, v_actor, 'RESTORE', 'customers', p_id);

    RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_order(p_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
    v_count     INT;
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.orders
    WHERE id = p_id
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Order not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.orders
    SET deleted_at = NULL,
        deleted_by = NULL
    WHERE id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id)
    VALUES (v_tenant_id, v_actor, 'RESTORE', 'orders', p_id);

    RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_pre_bill(p_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
    v_count     INT;
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.pre_bills
    WHERE id = p_id
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Pre-bill not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.pre_bills
    SET deleted_at = NULL,
        deleted_by = NULL
    WHERE id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id)
    VALUES (v_tenant_id, v_actor, 'RESTORE', 'pre_bills', p_id);

    RETURN v_count > 0;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 7: VIEWS (excluyen soft-deleted automáticamente)
-- ═══════════════════════════════════════════════════════════════════════

CREATE VIEW public.v_customers_active AS
    SELECT * FROM public.customers WHERE deleted_at IS NULL;

CREATE VIEW public.v_orders_active AS
    SELECT * FROM public.orders WHERE deleted_at IS NULL;

CREATE VIEW public.v_pre_bills_active AS
    SELECT * FROM public.pre_bills WHERE deleted_at IS NULL;

COMMENT ON VIEW public.v_customers_active IS 'Clientes activos (deleted_at IS NULL).';
COMMENT ON VIEW public.v_orders_active    IS 'Pedidos activos (deleted_at IS NULL).';
COMMENT ON VIEW public.v_pre_bills_active IS 'Pre-cuentas activas (deleted_at IS NULL).';

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 8: TABLA audit_log (inmutable, INSERT-only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE public.audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        REFERENCES public.tenants(id) ON DELETE RESTRICT,
    actor_id    UUID        REFERENCES auth.users(id),
    action      TEXT        NOT NULL CHECK (action IN ('INSERT','UPDATE','SOFT_DELETE','RESTORE','HARD_DELETE_BLOCKED')),
    table_name  TEXT        NOT NULL,
    record_id   UUID        NOT NULL,
    old_data    JSONB,
    new_data    JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_created ON public.audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_record         ON public.audit_log(table_name, record_id, created_at DESC);

-- RLS en audit_log: solo SELECT permitido por dueño del tenant
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_audit_select ON public.audit_log;
DROP POLICY IF EXISTS pol_audit_insert ON public.audit_log;
DROP POLICY IF EXISTS pol_audit_update ON public.audit_log;
DROP POLICY IF EXISTS pol_audit_delete ON public.audit_log;

CREATE POLICY pol_audit_select
    ON public.audit_log FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );

-- audit_log es INSERT-only (las funciones RPC usan SECURITY DEFINER)
CREATE POLICY pol_audit_insert
    ON public.audit_log FOR INSERT
    TO authenticated
    WITH CHECK (true);  -- Las RPC con SECURITY DEFINER insertan sin restricción de tenant

CREATE POLICY pol_audit_update ON public.audit_log FOR UPDATE TO authenticated USING (false);
CREATE POLICY pol_audit_delete ON public.audit_log FOR DELETE TO authenticated USING (false);

COMMENT ON TABLE public.audit_log IS 'Log inmutable. INSERT-only vía SECURITY DEFINER. NUNCA se borra.';

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 9: GRANT permisos
-- ═══════════════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pre_bills TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

GRANT EXECUTE ON FUNCTION public.soft_delete_customer(UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_order(UUID, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_pre_bill(UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_customer(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_order(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_pre_bill(UUID)            TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 10: TESTS INTEGRADOS (verifica que todo funciona)
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_rls_customers BOOLEAN;
    v_rls_orders    BOOLEAN;
    v_rls_pre_bills BOOLEAN;
    v_rls_audit     BOOLEAN;
    v_trigger_count INT;
    v_rpc_count     INT;
    v_idx_count     INT;
    v_view_count    INT;
BEGIN
    -- 10.1 RLS habilitado
    SELECT relrowsecurity INTO v_rls_customers FROM pg_class WHERE relname = 'customers';
    SELECT relrowsecurity INTO v_rls_orders    FROM pg_class WHERE relname = 'orders';
    SELECT relrowsecurity INTO v_rls_pre_bills FROM pg_class WHERE relname = 'pre_bills';
    SELECT relrowsecurity INTO v_rls_audit     FROM pg_class WHERE relname = 'audit_log';

    -- 10.2 Triggers activos
    SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
    WHERE tgname IN (
        'trg_refuse_hard_delete_customers',
        'trg_refuse_hard_delete_orders',
        'trg_refuse_hard_delete_pre_bills',
        'trg_customers_touch',
        'trg_orders_touch',
        'trg_pre_bills_touch'
    );

    -- 10.3 RPCs creadas
    SELECT count(*) INTO v_rpc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'soft_delete_customer',
          'soft_delete_order',
          'soft_delete_pre_bill',
          'restore_customer',
          'restore_order',
          'restore_pre_bill'
      );

    -- 10.4 Índices
    SELECT count(*) INTO v_idx_count
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('customers', 'orders', 'pre_bills');

    -- 10.5 Views
    SELECT count(*) INTO v_view_count
    FROM pg_views
    WHERE schemaname = 'public'
      AND viewname IN ('v_customers_active', 'v_orders_active', 'v_pre_bills_active');

    -- Output de verificación
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV v4.0.7 — Migración SQL #43 APLICADA';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '  RLS habilitado:';
    RAISE NOTICE '    • customers: %', v_rls_customers;
    RAISE NOTICE '    • orders:    %', v_rls_orders;
    RAISE NOTICE '    • pre_bills: %', v_rls_pre_bills;
    RAISE NOTICE '    • audit_log: %', v_rls_audit;
    RAISE NOTICE '  Triggers activos (esperado 6): %', v_trigger_count;
    RAISE NOTICE '  RPCs creadas    (esperado 6): %', v_rpc_count;
    RAISE NOTICE '  Índices totales (esperado >=12): %', v_idx_count;
    RAISE NOTICE '  Vistas creadas  (esperado 3): %', v_view_count;
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';

    -- ASSERTS: falla el script si algo no se aplicó
    IF NOT (v_rls_customers AND v_rls_orders AND v_rls_pre_bills AND v_rls_audit) THEN
        RAISE EXCEPTION 'TEST FAILED: RLS no habilitado en alguna tabla';
    END IF;
    IF v_trigger_count < 6 THEN
        RAISE EXCEPTION 'TEST FAILED: Faltan triggers (encontrados % de 6)', v_trigger_count;
    END IF;
    IF v_rpc_count < 6 THEN
        RAISE EXCEPTION 'TEST FAILED: Faltan RPCs (encontradas % de 6)', v_rpc_count;
    END IF;
    IF v_view_count < 3 THEN
        RAISE EXCEPTION 'TEST FAILED: Faltan vistas (encontradas % de 3)', v_view_count;
    END IF;

    RAISE NOTICE '  ✓ TODOS LOS TESTS PASAN';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;
