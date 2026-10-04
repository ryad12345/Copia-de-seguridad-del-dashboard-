-- =====================================================================
-- MOZONA TPV — SQL #69 (MAESTRO BLINDADO — fix definitivo 42804 / integer=text / PGRST202)
-- =====================================================================
-- Un solo script para copiar y pegar en Supabase SQL Editor.
-- SOLUCIONA:
--   1. 42804 created_at uuid     -> tipado estricto, now()::timestamptz
--   2. integer = text            -> casting universal a TEXT
--   3. PGRST202 function not found -> DROP todas las firmas + CREATE limpio
-- =====================================================================

-- =====================================================================
-- 0. LIMPIEZA TOTAL — eliminar TODAS las firmas de las 4 funciones
-- =====================================================================
-- DROP FUNCTION sin firma es ambiguo con overloads.
-- Solución: obtener OID desde pg_proc y dropear cada firma exacta.
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN (
              'fn_atomic_checkout',
              'fn_update_table_status',
              'fn_upsert_draft',
              'fn_clear_draft'
          )
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn.signature);
        RAISE NOTICE 'DROP % OK', fn.signature;
    END LOOP;
END $$;

-- =====================================================================
-- 1. FN_ATOMIC_CHECKOUT — tipado ESTRICTO, created_at = now()
-- =====================================================================
-- Cada columna se añade UNA POR UNA con su valor en orden paralelo.
-- NO se usa string_agg(ORDER BY ...) para evitar desfases.
-- Todos los casts son EXPLÍCITOS (::UUID, ::NUMERIC, ::TIMESTAMPTZ).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_atomic_checkout(
    p_tenant_id      UUID,
    p_table_id       TEXT    DEFAULT NULL,
    p_table_number   TEXT    DEFAULT NULL,
    p_items          JSONB   DEFAULT '[]'::jsonb,
    p_subtotal       NUMERIC DEFAULT 0,
    p_tax_total      NUMERIC DEFAULT 0,
    p_total          NUMERIC DEFAULT 0,
    p_payment_method TEXT    DEFAULT 'cash',
    p_waiter_name    TEXT    DEFAULT 'Caja',
    p_series         TEXT    DEFAULT 'T-F',
    p_invoice_number INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
    v_order_id      UUID;
    v_items_count   INT := 0;
    v_table_freed   BOOLEAN := FALSE;

    -- Detección de columnas (para compatibilidad con cualquier esquema)
    v_orders_has_created_at    BOOLEAN;
    v_orders_has_updated_at    BOOLEAN;
    v_orders_has_series        BOOLEAN;
    v_orders_has_invoice_num   BOOLEAN;
    v_orders_has_items_count   BOOLEAN;
    v_orders_has_status        BOOLEAN;
    v_orders_has_waiter_name   BOOLEAN;
    v_orders_has_payment       BOOLEAN;

    v_oi_has_created_at BOOLEAN;
    v_oi_has_price      BOOLEAN;
    v_oi_has_unit_price BOOLEAN;
    v_oi_has_subtotal   BOOLEAN;
    v_oi_has_tax_rate   BOOLEAN;

    v_dt_num_type       TEXT;
    v_dt_has_updated_at BOOLEAN;
    v_dt_has_current_oid BOOLEAN;

    v_sql  TEXT;
    v_item JSONB;
    v_qty  NUMERIC;
    v_price NUMERIC;
    v_cols TEXT := '';
    v_vals TEXT := '';
BEGIN
    ------------------------------------------------------------------------
    -- 0) VALIDACIÓN DE ENTRADA
    ------------------------------------------------------------------------
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado', 'code', 'TENANT_NOT_FOUND');
    END IF;

    ------------------------------------------------------------------------
    -- 1) DETECCIÓN DINÁMICA DE ESQUEMA (orders)
    ------------------------------------------------------------------------
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='created_at')
    INTO v_orders_has_created_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at')
    INTO v_orders_has_updated_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='series')
    INTO v_orders_has_series;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='invoice_number')
    INTO v_orders_has_invoice_num;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='items_count')
    INTO v_orders_has_items_count;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='status')
    INTO v_orders_has_status;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='waiter_name')
    INTO v_orders_has_waiter_name;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='orders' AND column_name='payment_method')
    INTO v_orders_has_payment;

    -- order_items
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='order_items' AND column_name='created_at')
    INTO v_oi_has_created_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='order_items' AND column_name='price')
    INTO v_oi_has_price;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='order_items' AND column_name='unit_price')
    INTO v_oi_has_unit_price;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='order_items' AND column_name='subtotal')
    INTO v_oi_has_subtotal;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='order_items' AND column_name='tax_rate')
    INTO v_oi_has_tax_rate;

    -- dining_tables
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='dining_tables') THEN
        SELECT data_type INTO v_dt_num_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dining_tables'
          AND column_name='table_number';

        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='dining_tables'
                         AND column_name='updated_at')
        INTO v_dt_has_updated_at;

        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='dining_tables'
                         AND column_name='current_order_id')
        INTO v_dt_has_current_oid;
    END IF;

    ------------------------------------------------------------------------
    -- 2) INSERT INTO orders (arrays paralelos: cols y vals MISMO orden)
    --    ★ created_at SIEMPRE now()::timestamptz (NUNCA UUID)
    --    ★ subtotal/tax_total/total SIEMPRE ::numeric
    ------------------------------------------------------------------------
    v_cols := 'tenant_id';
    v_vals := quote_literal(p_tenant_id::text) || '::UUID';

    IF v_orders_has_status THEN
        v_cols := v_cols || ', status';
        v_vals := v_vals || ', ''closed''';
    END IF;

    IF v_orders_has_waiter_name THEN
        v_cols := v_cols || ', waiter_name';
        v_vals := v_vals || ', ' || quote_literal(COALESCE(p_waiter_name, 'Caja'));
    END IF;

    v_cols := v_cols || ', subtotal, tax_total, total';
    v_vals := v_vals || ', ' || COALESCE(p_subtotal, 0)::text ||
                        ', ' || COALESCE(p_tax_total, 0)::text ||
                        ', ' || COALESCE(p_total, 0)::text;

    IF v_orders_has_payment THEN
        v_cols := v_cols || ', payment_method';
        v_vals := v_vals || ', ' || quote_literal(COALESCE(p_payment_method, 'cash'));
    END IF;

    IF v_orders_has_series THEN
        v_cols := v_cols || ', series';
        v_vals := v_vals || ', ' || quote_literal(COALESCE(p_series, 'T-F'));
    END IF;

    IF v_orders_has_invoice_num THEN
        v_cols := v_cols || ', invoice_number';
        v_vals := v_vals || ', ' || COALESCE(p_invoice_number::text,
                                              (floor(random() * 999999)::int)::text);
    END IF;

    IF v_orders_has_items_count THEN
        v_cols := v_cols || ', items_count';
        v_vals := v_vals || ', ' || jsonb_array_length(COALESCE(p_items, '[]'::jsonb))::text;
    END IF;

    -- ★ CLAVE: created_at SIEMPRE now()::timestamptz, NUNCA UUID
    IF v_orders_has_created_at THEN
        v_cols := v_cols || ', created_at';
        v_vals := v_vals || ', now()::timestamptz';
    END IF;

    IF v_orders_has_updated_at THEN
        v_cols := v_cols || ', updated_at';
        v_vals := v_vals || ', now()::timestamptz';
    END IF;

    v_sql := 'INSERT INTO public.orders (' || v_cols || ') VALUES (' || v_vals || ') RETURNING id::UUID';
    EXECUTE v_sql INTO v_order_id;

    ------------------------------------------------------------------------
    -- 3) INSERT order_items (bulk, arrays paralelos)
    ------------------------------------------------------------------------
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_qty   := COALESCE((v_item->>'quantity')::NUMERIC, 1);
            v_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);

            v_cols := 'tenant_id, order_id';
            v_vals := quote_literal(p_tenant_id::text) || '::UUID, '
                   || quote_literal(v_order_id::text) || '::UUID';

            -- name
            v_cols := v_cols || ', name';
            v_vals := v_vals || ', ' || quote_literal(COALESCE(v_item->>'name', 'Item'));

            -- quantity
            v_cols := v_cols || ', quantity';
            v_vals := v_vals || ', ' || v_qty::text;

            -- unit_price (moderno)
            IF v_oi_has_unit_price THEN
                v_cols := v_cols || ', unit_price';
                v_vals := v_vals || ', ' || v_price::text;
            END IF;

            -- price (legacy)
            IF v_oi_has_price THEN
                v_cols := v_cols || ', price';
                v_vals := v_vals || ', ' || v_price::text;
            END IF;

            -- subtotal
            IF v_oi_has_subtotal THEN
                v_cols := v_cols || ', subtotal';
                v_vals := v_vals || ', ' || (v_qty * v_price)::text;
            END IF;

            -- tax_rate
            IF v_oi_has_tax_rate THEN
                v_cols := v_cols || ', tax_rate';
                v_vals := v_vals || ', ' || COALESCE((v_item->>'tax_rate')::NUMERIC, 10)::text;
            END IF;

            -- product_id (si existe)
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='order_items'
                         AND column_name='product_id')
               AND (v_item->>'product_id') IS NOT NULL THEN
                v_cols := v_cols || ', product_id';
                v_vals := v_vals || ', ' || quote_literal(v_item->>'product_id') || '::UUID';
            END IF;

            -- created_at (SIEMPRE now()::timestamptz)
            IF v_oi_has_created_at THEN
                v_cols := v_cols || ', created_at';
                v_vals := v_vals || ', now()::timestamptz';
            END IF;

            v_sql := 'INSERT INTO public.order_items (' || v_cols || ') VALUES (' || v_vals || ')';
            EXECUTE v_sql;
        END LOOP;

        v_items_count := jsonb_array_length(p_items);
    END IF;

    ------------------------------------------------------------------------
    -- 4) DELETE open_orders vinculados a la mesa
    ------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='open_orders')
       AND (p_table_number IS NOT NULL OR p_table_id IS NOT NULL) THEN

        -- ★ CASTING UNIVERSAL: table_number::TEXT = p_table_number
        DELETE FROM public.open_orders
        WHERE tenant_id = p_tenant_id
          AND (
              (p_table_number IS NOT NULL AND table_number::TEXT = p_table_number)
           OR (p_table_id IS NOT NULL AND table_id = p_table_id)
          );
    END IF;

    ------------------------------------------------------------------------
    -- 5) PATCH dining_tables -> 'free'
    -- ★ CASTING UNIVERSAL ::TEXT para evitar integer = text
    ------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='dining_tables')
       AND (p_table_number IS NOT NULL OR p_table_id IS NOT NULL) THEN

        -- Rama A: por UUID id
        IF p_table_id IS NOT NULL
           AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_sql := 'UPDATE public.dining_tables SET status = ''free''';
            IF v_dt_has_current_oid THEN
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
            IF v_dt_has_updated_at THEN
                v_sql := v_sql || ', updated_at = now()::timestamptz';
            END IF;
            v_sql := v_sql || ' WHERE tenant_id = $1::UUID AND id = $2::UUID';
            EXECUTE v_sql USING p_tenant_id, p_table_id;
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;

        -- Rama B: por table_number (CASTING UNIVERSAL ::TEXT)
        IF NOT v_table_freed AND p_table_number IS NOT NULL THEN
            v_sql := 'UPDATE public.dining_tables SET status = ''free''';
            IF v_dt_has_current_oid THEN
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
            IF v_dt_has_updated_at THEN
                v_sql := v_sql || ', updated_at = now()::timestamptz';
            END IF;
            -- ★ CLAVE: table_number::TEXT para comparar contra text parameter
            v_sql := v_sql || ' WHERE tenant_id = $1::UUID AND table_number::TEXT = $2';
            EXECUTE v_sql USING p_tenant_id, p_table_number;
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;

        -- Rama C: legacy "local-table-N" -> strip prefix y comparar como TEXT
        IF NOT v_table_freed AND p_table_id IS NOT NULL THEN
            v_sql := 'UPDATE public.dining_tables SET status = ''free''';
            IF v_dt_has_current_oid THEN
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
            IF v_dt_has_updated_at THEN
                v_sql := v_sql || ', updated_at = now()::timestamptz';
            END IF;
            v_sql := v_sql ||
                ' WHERE tenant_id = $1::UUID' ||
                ' AND (table_number::TEXT = $2' ||
                '      OR table_number::TEXT = $3)';
            EXECUTE v_sql USING p_tenant_id,
                                p_table_id,
                                substring(p_table_id FROM 'local-table-(.*)$');
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;
    END IF;

    ------------------------------------------------------------------------
    -- 6) RETORNO EXITOSO
    ------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'ok',          TRUE,
        'order_id',    v_order_id,
        'items_count', v_items_count,
        'table_freed', v_table_freed
    );

EXCEPTION WHEN OTHERS THEN
    -- PL/pgSQL hace ROLLBACK automáticamente
    RETURN jsonb_build_object(
        'ok',    FALSE,
        'error', SQLERRM,
        'code',  SQLSTATE,
        'hint',  CASE
                    WHEN SQLSTATE = '42804' THEN 'Type mismatch — verificar columnas'
                    WHEN SQLSTATE = '42883' THEN 'Function not found'
                    WHEN SQLSTATE = '23503' THEN 'FK violation'
                    WHEN SQLSTATE = '23505' THEN 'Unique violation'
                    WHEN SQLSTATE = '22P02' THEN 'Invalid UUID syntax'
                    ELSE NULL
                 END
    );
END;
$fn$;

-- =====================================================================
-- 2. FN_UPDATE_TABLE_STATUS — casting universal ::TEXT
-- =====================================================================
-- Compara SIEMPRE contra table_number::TEXT, sin importar si la columna
-- es integer o text en el esquema actual.
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
    v_count         INT := 0;
    v_has_current_oid BOOLEAN;
    v_has_updated_at  BOOLEAN;
    v_clean_status    TEXT;
    v_sql             TEXT;
    v_stripped        TEXT;
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
                     AND column_name='current_order_id')
    INTO v_has_current_oid;

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
    ------------------------------------------------------------------
    IF p_table_id IS NOT NULL
       AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_has_current_oid THEN
            IF p_current_order_id IS NOT NULL THEN
                v_sql := v_sql || ', current_order_id = $4::UUID';
            ELSE
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        v_sql := v_sql || ' WHERE tenant_id = $2::UUID AND id = $3::UUID';

        IF v_has_current_oid AND p_current_order_id IS NOT NULL THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, p_current_order_id;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama B: UPDATE por table_number (CASTING UNIVERSAL ::TEXT)
    -- Compatible con integer O text en la columna.
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_has_current_oid THEN
            IF p_current_order_id IS NOT NULL THEN
                v_sql := v_sql || ', current_order_id = $4::UUID';
            ELSE
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        -- ★ table_number::TEXT evita integer = text
        v_sql := v_sql || ' WHERE tenant_id = $2::UUID AND table_number::TEXT = $3';

        IF v_has_current_oid AND p_current_order_id IS NOT NULL THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_number, p_current_order_id;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_number;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama C: UPDATE por legacy 'local-table-N' (strip prefix)
    ------------------------------------------------------------------
    IF v_count = 0 AND v_stripped IS NOT NULL THEN
        v_sql := 'UPDATE public.dining_tables SET status = $1';
        IF v_has_current_oid THEN
            IF p_current_order_id IS NOT NULL THEN
                v_sql := v_sql || ', current_order_id = $4::UUID';
            ELSE
                v_sql := v_sql || ', current_order_id = NULL';
            END IF;
        END IF;
        IF v_has_updated_at THEN
            v_sql := v_sql || ', updated_at = now()::timestamptz';
        END IF;
        v_sql := v_sql ||
            ' WHERE tenant_id = $2::UUID' ||
            ' AND (table_number::TEXT = $3 OR table_number::TEXT = $5)';

        IF v_has_current_oid AND p_current_order_id IS NOT NULL THEN
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, p_current_order_id, v_stripped;
        ELSE
            EXECUTE v_sql USING v_clean_status, p_tenant_id, p_table_id, NULL, v_stripped;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama D: INSERT si la mesa no existe
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        v_sql := 'INSERT INTO public.dining_tables (tenant_id, table_number, status';
        IF v_has_current_oid THEN v_sql := v_sql || ', current_order_id'; END IF;
        IF v_has_updated_at  THEN v_sql := v_sql || ', updated_at';        END IF;
        v_sql := v_sql || ') VALUES ($1::UUID, $2, $3';
        IF v_has_current_oid THEN v_sql := v_sql || ', $4::UUID'; END IF;
        IF v_has_updated_at  THEN v_sql := v_sql || ', now()::timestamptz'; END IF;
        v_sql := v_sql || ')';

        IF v_has_current_oid AND p_current_order_id IS NOT NULL THEN
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

-- =====================================================================
-- 3. FN_UPSERT_DRAFT — UPSERT open_orders
-- =====================================================================
-- Detección dinámica de columnas (items, status, updated_at).
-- Strip 'local-table-' para table_id legacy.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_upsert_draft(
    p_tenant_id    UUID,
    p_table_id     TEXT    DEFAULT NULL,
    p_table_number TEXT    DEFAULT NULL,
    p_items        JSONB   DEFAULT '[]'::jsonb,
    p_notes        TEXT    DEFAULT NULL,
    p_waiter_name  TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
    v_id              UUID;
    v_oo_has_items    BOOLEAN;
    v_oo_has_status   BOOLEAN;
    v_oo_has_updated  BOOLEAN;
    v_oo_has_tid      BOOLEAN;
    v_oo_has_waiter   BOOLEAN;
    v_oo_has_notes    BOOLEAN;
    v_oo_has_tnumber  BOOLEAN;
    v_sql             TEXT;
    v_stripped        TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    -- Detección de columnas
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='items')
    INTO v_oo_has_items;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='status')
    INTO v_oo_has_status;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='updated_at')
    INTO v_oo_has_updated;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='table_id')
    INTO v_oo_has_tid;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='waiter_name')
    INTO v_oo_has_waiter;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='notes')
    INTO v_oo_has_notes;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='table_number')
    INTO v_oo_has_tnumber;

    v_stripped := CASE
        WHEN p_table_id LIKE 'local-table-%' THEN substring(p_table_id FROM 'local-table-(.*)$')
        ELSE p_table_id
    END;

    ------------------------------------------------------------------------
    -- Buscar fila existente por (tenant_id, table_number)
    ------------------------------------------------------------------------
    IF v_oo_has_tnumber AND (p_table_number IS NOT NULL OR v_stripped IS NOT NULL) THEN
        SELECT id INTO v_id
        FROM public.open_orders
        WHERE tenant_id = p_tenant_id
          AND (
              (p_table_number IS NOT NULL AND table_number::TEXT = p_table_number)
           OR (v_stripped IS NOT NULL AND table_number::TEXT = v_stripped)
          )
        LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
        -- UPDATE
        v_sql := 'UPDATE public.open_orders SET ';
        IF v_oo_has_items   THEN v_sql := v_sql || 'items = $2::JSONB, ';        END IF;
        IF v_oo_has_status  THEN v_sql := v_sql || 'status = ''open'', ';        END IF;
        IF v_oo_has_updated THEN v_sql := v_sql || 'updated_at = now()::timestamptz, '; END IF;
        IF v_oo_has_waiter  THEN v_sql := v_sql || 'waiter_name = $3, ';          END IF;
        IF v_oo_has_notes   THEN v_sql := v_sql || 'notes = $4, ';                END IF;
        v_sql := rtrim(v_sql, ', ');
        v_sql := v_sql || ' WHERE id = $1::UUID';

        IF v_oo_has_items THEN
            EXECUTE v_sql USING v_id, p_items,
                                COALESCE(p_waiter_name, ''),
                                COALESCE(p_notes, '');
        ELSE
            -- sin items column: solo status/updated_at/waiter/notes
            v_sql := 'UPDATE public.open_orders SET ';
            IF v_oo_has_status  THEN v_sql := v_sql || 'status = ''open'', ';        END IF;
            IF v_oo_has_updated THEN v_sql := v_sql || 'updated_at = now()::timestamptz, '; END IF;
            IF v_oo_has_waiter  THEN v_sql := v_sql || 'waiter_name = $2, ';          END IF;
            IF v_oo_has_notes   THEN v_sql := v_sql || 'notes = $3, ';                END IF;
            v_sql := rtrim(v_sql, ', ');
            v_sql := v_sql || ' WHERE id = $1::UUID';
            EXECUTE v_sql USING v_id,
                                COALESCE(p_waiter_name, ''),
                                COALESCE(p_notes, '');
        END IF;

        RETURN jsonb_build_object('ok', true, 'id', v_id, 'action', 'updated');
    ELSE
        -- INSERT
        v_sql := 'INSERT INTO public.open_orders (tenant_id';
        IF v_oo_has_tid     THEN v_sql := v_sql || ', table_id';       END IF;
        IF v_oo_has_tnumber THEN v_sql := v_sql || ', table_number';   END IF;
        IF v_oo_has_items   THEN v_sql := v_sql || ', items';          END IF;
        IF v_oo_has_status  THEN v_sql := v_sql || ', status';         END IF;
        IF v_oo_has_updated THEN v_sql := v_sql || ', updated_at';     END IF;
        IF v_oo_has_waiter  THEN v_sql := v_sql || ', waiter_name';    END IF;
        IF v_oo_has_notes   THEN v_sql := v_sql || ', notes';          END IF;
        v_sql := v_sql || ') VALUES ($1::UUID';

        IF v_oo_has_tid THEN
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_id), 'NULL');
        END IF;
        IF v_oo_has_tnumber THEN
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_number), 'NULL');
        END IF;
        IF v_oo_has_items THEN
            v_sql := v_sql || ', $2::JSONB';
        END IF;
        IF v_oo_has_status THEN
            v_sql := v_sql || ', ''open''';
        END IF;
        IF v_oo_has_updated THEN
            v_sql := v_sql || ', now()::timestamptz';
        END IF;
        IF v_oo_has_waiter THEN
            v_sql := v_sql || ', $3';
        END IF;
        IF v_oo_has_notes THEN
            v_sql := v_sql || ', $4';
        END IF;
        v_sql := v_sql || ') RETURNING id';

        IF v_oo_has_items THEN
            EXECUTE v_sql USING p_tenant_id, p_items,
                                COALESCE(p_waiter_name, ''),
                                COALESCE(p_notes, '')
                INTO v_id;
        ELSE
            v_sql := 'INSERT INTO public.open_orders (tenant_id';
            IF v_oo_has_tid     THEN v_sql := v_sql || ', table_id';     END IF;
            IF v_oo_has_tnumber THEN v_sql := v_sql || ', table_number'; END IF;
            IF v_oo_has_status  THEN v_sql := v_sql || ', status';       END IF;
            IF v_oo_has_updated THEN v_sql := v_sql || ', updated_at';   END IF;
            IF v_oo_has_waiter  THEN v_sql := v_sql || ', waiter_name';  END IF;
            IF v_oo_has_notes   THEN v_sql := v_sql || ', notes';        END IF;
            v_sql := v_sql || ') VALUES ($1::UUID';
            IF v_oo_has_tid THEN
                v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_id), 'NULL');
            END IF;
            IF v_oo_has_tnumber THEN
                v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_number), 'NULL');
            END IF;
            IF v_oo_has_status  THEN v_sql := v_sql || ', ''open'''; END IF;
            IF v_oo_has_updated THEN v_sql := v_sql || ', now()::timestamptz'; END IF;
            IF v_oo_has_waiter THEN
                v_sql := v_sql || ', $2';
            END IF;
            IF v_oo_has_notes THEN
                v_sql := v_sql || ', $3';
            END IF;
            v_sql := v_sql || ') RETURNING id';
            EXECUTE v_sql USING p_tenant_id,
                                COALESCE(p_waiter_name, ''),
                                COALESCE(p_notes, '')
                INTO v_id;
        END IF;

        RETURN jsonb_build_object('ok', true, 'id', v_id, 'action', 'inserted');
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$fn$;

-- =====================================================================
-- 4. FN_CLEAR_DRAFT — DELETE borrador
-- =====================================================================
-- Acepta table_id (UUID), table_number (text) o legacy "local-table-N".
-- Strip automático del prefijo legacy.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_clear_draft(
    p_tenant_id          UUID,
    p_table_id_or_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
    v_count     INT := 0;
    v_has_tid   BOOLEAN;
    v_has_tnum  BOOLEAN;
    v_sql       TEXT;
    v_stripped  TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;
    IF p_table_id_or_number IS NULL OR p_table_id_or_number = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_id_or_number requerido', 'code', 'INVALID_INPUT');
    END IF;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='table_id')
    INTO v_has_tid;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='open_orders'
                     AND column_name='table_number')
    INTO v_has_tnum;

    v_stripped := CASE
        WHEN p_table_id_or_number LIKE 'local-table-%' THEN substring(p_table_id_or_number FROM 'local-table-(.*)$')
        ELSE p_table_id_or_number
    END;

    -- Intento 1: por table_id si es UUID
    IF v_has_tid
       AND p_table_id_or_number ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        DELETE FROM public.open_orders
        WHERE tenant_id = p_tenant_id
          AND table_id = p_table_id_or_number;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- Intento 2: por table_number (CASTING UNIVERSAL ::TEXT)
    IF v_count = 0 AND v_has_tnum AND v_stripped IS NOT NULL THEN
        v_sql := 'DELETE FROM public.open_orders
                  WHERE tenant_id = $1::UUID
                    AND table_number::TEXT = $2';
        EXECUTE v_sql USING p_tenant_id, v_stripped;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- Intento 3: fallback con el ID completo (por si se pasó UUID directo)
    IF v_count = 0 AND v_has_tid THEN
        DELETE FROM public.open_orders
        WHERE tenant_id = p_tenant_id
          AND (table_id = p_table_id_or_number
               OR (v_has_tnum AND table_number::TEXT = v_stripped));
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('ok', true, 'deleted', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$fn$;

-- =====================================================================
-- 5. PERMISOS — usando regprocedure (firma completa, sin ambigüedad)
-- =====================================================================
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN (
              'fn_atomic_checkout',
              'fn_update_table_status',
              'fn_upsert_draft',
              'fn_clear_draft'
          )
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
            fn.signature
        );
        RAISE NOTICE 'GRANT % OK', fn.signature;
    END LOOP;
END $$;

-- =====================================================================
-- 6. RELOAD SCHEMA + VERIFICACIÓN
-- =====================================================================
NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
    v_expected TEXT[] := ARRAY[
        'fn_atomic_checkout',
        'fn_update_table_status',
        'fn_upsert_draft',
        'fn_clear_draft'
    ];
    v_found INT;
BEGIN
    SELECT COUNT(*) INTO v_found
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = ANY(v_expected);
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'MOZONA TPV — SQL #69 APLICADO CORRECTAMENTE';
    RAISE NOTICE 'Funciones creadas: % de % esperadas', v_found, array_length(v_expected, 1);
    RAISE NOTICE '================================================================';
END $$;
