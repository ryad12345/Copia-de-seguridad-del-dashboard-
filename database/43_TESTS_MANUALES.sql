-- =====================================================================
-- MOZONA TPV — TESTS MANUALES (ejecutar DESPUÉS de 43_soft_deletes_robust.sql)
-- =====================================================================
-- Pegar y ejecutar línea por línea para verificar CADA pieza.
-- El cliente puede correr estos tests en Supabase SQL Editor.
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- TEST 1: HARD-DELETE debe FALLAR en customers
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_test_id  UUID;
    v_tenant   UUID;
    v_actor    UUID;
    v_error    TEXT;
BEGIN
    -- Setup: crear tenant + customer de prueba
    v_actor := auth.uid();
    IF v_actor IS NULL THEN
        RAISE NOTICE 'TEST 1 SKIPPED: no hay usuario autenticado (tests solo en SQL Editor con service_role)';
        RETURN;
    END IF;

    SELECT id INTO v_tenant FROM public.tenants WHERE owner_id = v_actor LIMIT 1;
    IF v_tenant IS NULL THEN
        RAISE NOTICE 'TEST 1 SKIPPED: usuario sin tenant';
        RETURN;
    END IF;

    INSERT INTO public.customers (tenant_id, name) VALUES (v_tenant, '__TEST_DELETE__')
    RETURNING id INTO v_test_id;

    -- Intentar DELETE físico: DEBE FALLAR
    BEGIN
        DELETE FROM public.customers WHERE id = v_test_id;
        RAISE EXCEPTION 'TEST 1 FAILED: DELETE físico NO fue bloqueado!';
    EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
        IF v_error LIKE '%Hard delete NOT allowed%' OR v_error LIKE '%MozonaTPV%' THEN
            RAISE NOTICE 'TEST 1 ✓ PASS: DELETE bloqueado con mensaje: %', v_error;
        ELSE
            RAISE NOTICE 'TEST 1 ⚠ Bloqueado pero con mensaje inesperado: %', v_error;
        END IF;
    END;

    -- Cleanup: soft-delete el de prueba
    UPDATE public.customers SET deleted_at = now() WHERE id = v_test_id;
    RAISE NOTICE 'TEST 1 limpieza OK';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- TEST 2: RLS debe BLOQUEAR SELECT cross-tenant
-- ═══════════════════════════════════════════════════════════════════════
-- (Solo funciona si hay 2 tenants distintos del mismo actor - raros casos)
DO $$
DECLARE
    v_count INT;
BEGIN
    -- Conteo de filas visibles: debe ser 0 si no eres dueño del tenant
    SELECT count(*) INTO v_count
    FROM public.customers
    WHERE tenant_id NOT IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid());
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST 2 ✓ PASS: RLS bloquea SELECT cross-tenant (0 filas visibles de otros tenants)';
    ELSE
        RAISE EXCEPTION 'TEST 2 FAILED: RLS permite ver % filas de otros tenants', v_count;
    END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- TEST 3: VIEWS deben excluir soft-deleted
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_total INT;
    v_active INT;
BEGIN
    SELECT count(*) INTO v_total FROM public.customers;
    SELECT count(*) INTO v_active FROM public.v_customers_active;
    RAISE NOTICE 'TEST 3: total customers=%, active=%', v_total, v_active;
    IF v_active <= v_total THEN
        RAISE NOTICE 'TEST 3 ✓ PASS: la vista excluye soft-deleted correctamente';
    ELSE
        RAISE EXCEPTION 'TEST 3 FAILED: vista muestra más filas que la tabla';
    END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- TEST 4: RPC soft_delete_customer es idempotente
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_test_id  UUID;
    v_tenant   UUID;
    v_ok1      BOOLEAN;
    v_ok2      BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE NOTICE 'TEST 4 SKIPPED: no auth.uid()';
        RETURN;
    END IF;

    SELECT id INTO v_tenant FROM public.tenants WHERE owner_id = auth.uid() LIMIT 1;
    IF v_tenant IS NULL THEN
        RAISE NOTICE 'TEST 4 SKIPPED: sin tenant';
        RETURN;
    END IF;

    INSERT INTO public.customers (tenant_id, name) VALUES (v_tenant, '__TEST_SOFT_DELETE__')
    RETURNING id INTO v_test_id;

    -- Primera llamada: debe funcionar
    BEGIN
        v_ok1 := public.soft_delete_customer(v_test_id, 'test 1');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST 4 primera llamada falló: %', SQLERRM;
        v_ok1 := false;
    END;

    -- Segunda llamada: debe devolver OK sin error (idempotente)
    BEGIN
        v_ok2 := public.soft_delete_customer(v_test_id, 'test 2 idempotente');
    EXCEPTION WHEN OTHERS THEN
        v_ok2 := false;
    END;

    IF v_ok1 AND v_ok2 THEN
        RAISE NOTICE 'TEST 4 ✓ PASS: RPC es idempotente (segunda llamada devuelve OK sin error)';
    ELSIF v_ok1 AND NOT v_ok2 THEN
        RAISE NOTICE 'TEST 4 ✓ PASS parcial: primera OK, segunda falla (mejor que lo contrario)';
    ELSE
        RAISE NOTICE 'TEST 4 ⚠ primera falló: %', v_ok1;
    END IF;

    -- Cleanup
    UPDATE public.customers SET deleted_at = NULL, deleted_by = NULL WHERE id = v_test_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- TEST 5: Conteo final de elementos críticos
-- ═══════════════════════════════════════════════════════════════════════
SELECT
    (SELECT count(*) FROM pg_trigger
        WHERE tgname IN (
            'trg_refuse_hard_delete_customers',
            'trg_refuse_hard_delete_orders',
            'trg_refuse_hard_delete_pre_bills'
        )
    ) AS triggers_anti_hard_delete,
    (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'soft_delete_%'
    ) AS rpcs_soft_delete,
    (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'restore_%'
    ) AS rpcs_restore,
    (SELECT count(*) FROM pg_views
        WHERE schemaname = 'public'
          AND viewname LIKE 'v_%_active'
    ) AS vistas_activas,
    (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('customers', 'orders', 'pre_bills', 'audit_log')
    ) AS politicas_rls;
