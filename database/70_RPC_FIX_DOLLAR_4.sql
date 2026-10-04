-- =====================================================================
-- MOZONA TPV — SQL #70 (FIX $4 — parche surgical sobre SQL #69)
-- =====================================================================
-- Bug: en fn_update_table_status, cuando p_current_order_id IS NOT NULL
--      pero la columna current_order_id NO existe en la tabla,
--      EXECUTE USING pasa $4 pero SQL no tiene $4.
--
-- Solución: usar siempre current_order_id si p_current_order_id viene,
--           o usar NULL si no viene. Y construir SQL coherente.
-- =====================================================================

DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = 'fn_update_table_status'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn.signature);
        RAISE NOTICE 'DROP % OK', fn.signature;
    END LOOP;
END $$;

-- =====================================================================
-- FN_UPDATE_TABLE_STATUS v4.5.4 — fix coherente de $4
-- =====================================================================
-- Regla de oro: el número de $ en SQL EXECUTE debe COINCIDIR
-- con el número de placeholders en la cadena SQL.
-- Lógica: si p_current_order_id IS NOT NULL → incluimos current_order_id
--         en SET; si no, NO lo incluimos (pero podemos poner NULL).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_update_table_status(
    p_tenant_id        UUID,
    p_table_id         TEXT,
    p_table_number     TEXT    DEFAULT NULL,
    p_status           TEXT    DEFAULT 'free',
    p_current_order_id UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
    v_count           INT := 0;
    v_has_updated_at  BOOLEAN;
    v_clean_status    TEXT;
    v_sql             TEXT;
    v_stripped        TEXT;

    -- ★ Decisión única: ¿usamos current_order_id?
    v_use_oid BOOLEAN := (p_current_order_id IS NOT NULL);
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado', 'code', 'TENANT_NOT_FOUND');
    END IF;

    v_clean_status := LOWER(TRIM(COALESCE(p_status, 'free')));

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='dining_tables'
                     AND column_name='updated_at')
    INTO v_has_updated_at;

    -- Strip 'local-table-' legacy
    v_stripped := CASE
        WHEN p_table_id LIKE 'local-table-%' THEN substring(p_table_id FROM 'local-table-(.*)$')
        ELSE p_table_id
    END;

    ------------------------------------------------------------------
    -- Rama A: UPDATE por UUID id
    -- SQL: 3 placeholders SIEMPRE ($1=status, $2=tenant, $3=id)
    --      + $4 SOLO si v_use_oid
    ------------------------------------------------------------------
    IF p_table_id IS NOT NULL
       AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_use_oid THEN
            v_sql := v_sql || ', current_order_id = $4::UUID';
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        v_sql := v_sql || ' WHERE tenant_id = $2::UUID AND id = $3::UUID';

        IF v_use_oid THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, p_current_order_id;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama B: UPDATE por table_number (CASTING UNIVERSAL ::TEXT)
    -- SQL: 3 placeholders SIEMPRE ($1=status, $2=tenant, $3=table_number)
    --      + $4 SOLO si v_use_oid
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_use_oid THEN
            v_sql := v_sql || ', current_order_id = $4::UUID';
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        v_sql := v_sql || ' WHERE tenant_id = $2::UUID AND table_number::TEXT = $3';

        IF v_use_oid THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_number, p_current_order_id;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_number;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama C: UPDATE por legacy 'local-table-N'
    -- SQL: $1=status, $2=tenant, $3=table_id, $4=v_stripped
    --      + $5 SOLO si v_use_oid
    ------------------------------------------------------------------
    IF v_count = 0 AND v_stripped IS NOT NULL THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_use_oid THEN
            v_sql := v_sql || ', current_order_id = $5::UUID';
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        v_sql := v_sql ||
            ' WHERE tenant_id = $2::UUID' ||
            ' AND (table_number::TEXT = $3 OR table_number::TEXT = $4)';

        IF v_use_oid THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, v_stripped, p_current_order_id;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, v_stripped;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama D: INSERT si la mesa no existe
    -- SQL: 3 placeholders base ($1=tenant, $2=table_number, $3=status)
    --      + $4 SOLO si v_use_oid
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        v_sql := 'INSERT INTO public.dining_tables (tenant_id, table_number, status';
        IF v_use_oid THEN v_sql := v_sql || ', current_order_id'; END IF;
        IF v_has_updated_at THEN v_sql := v_sql || ', updated_at'; END IF;
        v_sql := v_sql || ') VALUES ($1::UUID, $2, $3';
        IF v_use_oid THEN v_sql := v_sql || ', $4::UUID'; END IF;
        IF v_has_updated_at THEN v_sql := v_sql || ', now()::timestamptz'; END IF;
        v_sql := v_sql || ')';

        IF v_use_oid THEN
            EXECUTE v_sql USING p_tenant_id, p_table_number, v_clean_status, p_current_order_id;
        ELSE
            EXECUTE v_sql USING p_tenant_id, p_table_number, v_clean_status;
        END IF;
        v_count := 1;
    END IF;

    IF v_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'mesa no encontrada', 'count', 0);
    END IF;

    RETURN jsonb_build_object('ok', true, 'count', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$fn$;

-- Permisos
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = 'fn_update_table_status'
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
            fn.signature
        );
        RAISE NOTICE 'GRANT % OK', fn.signature;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'MOZONA TPV — SQL #70 APLICADO (fix $4 en fn_update_table_status)';
    RAISE NOTICE '================================================================';
END $$;
