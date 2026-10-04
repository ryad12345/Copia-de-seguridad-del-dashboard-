-- =====================================================================
-- MOZONA TPV — SQL #68 (RPC ATÓMICAS PRODUCTION-READY)
-- =====================================================================
-- Estrategia: SQL dinámico + casts explícitos + transacciones BEGIN/COMMIT
-- Soluciona:
--   1. 42804 created_at uuid     (arrays paralelos col/val, sin desfase)
--   2. 42804 col/val desalineado (cada columna con su valor en orden)
--   3. integer = text            (detección + cast dinámico)
--   4. PGRST202 RPC not found    (definición limpia de TODAS las RPC)
-- =====================================================================

-- =====================================================================
-- 1. FN_ATOMIC_CHECKOUT
-- =====================================================================
-- Devuelve: {ok, order_id, items_count, table_freed}
-- Tipos garantizados:
--   p_tenant_id     : UUID
--   p_table_id      : TEXT  (legacy "local-table-N" o UUID)
--   p_table_number  : TEXT  (casteado a INTEGER si la columna es integer)
--   p_items         : JSONB
--   *_total         : NUMERIC
--   p_payment_method: TEXT
--   p_waiter_name   : TEXT
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

    -- order columns (detectamos qué columnas existen)
    v_has_created_at    BOOLEAN;
    v_has_updated_at    BOOLEAN;
    v_has_series        BOOLEAN;
    v_has_invoice_num   BOOLEAN;
    v_has_items_count   BOOLEAN;

    -- order_items columns
    v_oi_has_created_at BOOLEAN;
    v_oi_has_price      BOOLEAN;
    v_oi_has_unit_price BOOLEAN;

    -- dining_tables columns
    v_dt_num_type       TEXT;  -- 'integer' or 'text'
    v_dt_has_updated_at BOOLEAN;

    -- helpers
    v_sql       TEXT;
    v_item      JSONB;
    v_qty       NUMERIC;
    v_price     NUMERIC;
BEGIN
    ------------------------------------------------------------------------
    -- 0) VALIDACIÓN DE ENTRADA (fail-fast)
    ------------------------------------------------------------------------
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado', 'code', 'TENANT_NOT_FOUND');
    END IF;

    ------------------------------------------------------------------------
    -- 1) DETECCIÓN DINÁMICA DE ESQUEMA
    ------------------------------------------------------------------------
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='created_at')
    INTO v_has_created_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='updated_at')
    INTO v_has_updated_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='series')
    INTO v_has_series;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='invoice_number')
    INTO v_has_invoice_num;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='items_count')
    INTO v_has_items_count;

    -- order_items
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='created_at')
    INTO v_oi_has_created_at;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='price')
    INTO v_oi_has_price;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='order_items' AND column_name='unit_price')
    INTO v_oi_has_unit_price;

    -- dining_tables
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dining_tables') THEN
        SELECT data_type INTO v_dt_num_type
        FROM information_schema.columns
        WHERE table_name='dining_tables' AND column_name='table_number';

        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='dining_tables' AND column_name='updated_at')
        INTO v_dt_has_updated_at;
    END IF;

    ------------------------------------------------------------------------
    -- 2) INSERT INTO orders (arrays paralelos, ningún desfase)
    --    Cada columna se añade con su valor en el mismo orden.
    ------------------------------------------------------------------------
    v_sql := 'INSERT INTO orders (tenant_id';

    -- Las columnas extra se concatenan en orden FIJO
    IF v_has_series       THEN v_sql := v_sql || ', series';       END IF;
    IF v_has_invoice_num  THEN v_sql := v_sql || ', invoice_number'; END IF;
    v_sql := v_sql || ', waiter_name, subtotal, tax_total, total, payment_method, status';
    IF v_has_items_count  THEN v_sql := v_sql || ', items_count';  END IF;
    IF v_has_created_at   THEN v_sql := v_sql || ', created_at';   END IF;
    IF v_has_updated_at   THEN v_sql := v_sql || ', updated_at';   END IF;

    v_sql := v_sql || ') VALUES (' || quote_literal(p_tenant_id::text) || '::UUID';

    IF v_has_series THEN
        v_sql := v_sql || ', ' || quote_literal(COALESCE(p_series, 'T-F'));
    END IF;
    IF v_has_invoice_num THEN
        v_sql := v_sql || ', ' || COALESCE(p_invoice_number::text,
                                            (floor(random() * 999999)::int)::text);
    END IF;
    v_sql := v_sql || ', ' || quote_literal(COALESCE(p_waiter_name, 'Caja'));
    v_sql := v_sql || ', ' || COALESCE(p_subtotal, 0)::text;
    v_sql := v_sql || ', ' || COALESCE(p_tax_total, 0)::text;
    v_sql := v_sql || ', ' || COALESCE(p_total, 0)::text;
    v_sql := v_sql || ', ' || quote_literal(COALESCE(p_payment_method, 'cash'));
    v_sql := v_sql || ', ''closed''';
    IF v_has_items_count THEN
        v_sql := v_sql || ', ' || jsonb_array_length(COALESCE(p_items, '[]'::jsonb))::text;
    END IF;
    IF v_has_created_at THEN
        v_sql := v_sql || ', now()::timestamptz';
    END IF;
    IF v_has_updated_at THEN
        v_sql := v_sql || ', now()::timestamptz';
    END IF;

    v_sql := v_sql || ') RETURNING id';
    EXECUTE v_sql INTO v_order_id;

    ------------------------------------------------------------------------
    -- 3) INSERT order_items (bulk, arrays paralelos)
    ------------------------------------------------------------------------
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_qty   := COALESCE((v_item->>'quantity')::NUMERIC, 1);
            v_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);

            -- Construir SQL con arrays paralelos
            v_sql := 'INSERT INTO order_items (';
            v_sql := v_sql || 'tenant_id, order_id';
            IF v_oi_has_price OR v_oi_has_unit_price THEN
                -- usaremos al menos una
                v_sql := v_sql || ', name, quantity';
                IF v_oi_has_unit_price THEN v_sql := v_sql || ', unit_price'; END IF;
                IF v_oi_has_price      THEN v_sql := v_sql || ', price';      END IF;
                v_sql := v_sql || ', subtotal';
            END IF;
            IF v_oi_has_created_at THEN v_sql := v_sql || ', created_at'; END IF;
            v_sql := v_sql || ') VALUES (';
            v_sql := v_sql || quote_literal(p_tenant_id::text) || '::UUID';
            v_sql := v_sql || ', ' || quote_literal(v_order_id::text) || '::UUID';

            IF v_oi_has_price OR v_oi_has_unit_price THEN
                v_sql := v_sql || ', ' || quote_literal(COALESCE(v_item->>'name', 'Item'));
                v_sql := v_sql || ', ' || v_qty::text;
                IF v_oi_has_unit_price THEN
                    v_sql := v_sql || ', ' || v_price::text;
                END IF;
                IF v_oi_has_price THEN
                    v_sql := v_sql || ', ' || v_price::text;
                END IF;
                v_sql := v_sql || ', ' || (v_qty * v_price)::text;
            END IF;
            IF v_oi_has_created_at THEN
                v_sql := v_sql || ', now()::timestamptz';
            END IF;
            v_sql := v_sql || ')';

            EXECUTE v_sql;
        END LOOP;

        v_items_count := jsonb_array_length(p_items);
    END IF;

    ------------------------------------------------------------------------
    -- 4) DELETE open_orders (limpiar borradores vinculados a la mesa)
    ------------------------------------------------------------------------
    IF p_table_number IS NOT NULL OR p_table_id IS NOT NULL THEN
        DELETE FROM open_orders
        WHERE tenant_id = p_tenant_id
          AND (
              (p_table_number IS NOT NULL AND table_number = p_table_number)
           OR (p_table_id IS NOT NULL AND table_id = p_table_id)
          );
    END IF;

    ------------------------------------------------------------------------
    -- 5) PATCH dining_tables -> free (solo si existe la tabla)
    ------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dining_tables')
       AND (p_table_number IS NOT NULL OR p_table_id IS NOT NULL) THEN

        -- Rama A: por table_id si es UUID
        IF p_table_id IS NOT NULL
           AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            IF v_dt_has_updated_at THEN
                UPDATE dining_tables
                SET status = 'free',
                    current_order_id = NULL,
                    updated_at = now()
                WHERE tenant_id = p_tenant_id
                  AND id = p_table_id::UUID;
            ELSE
                UPDATE dining_tables
                SET status = 'free',
                    current_order_id = NULL
                WHERE tenant_id = p_tenant_id
                  AND id = p_table_id::UUID;
            END IF;
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;

        -- Rama B: por table_number (cast según tipo detectado)
        IF NOT v_table_freed AND p_table_number IS NOT NULL THEN
            IF v_dt_num_type = 'integer' THEN
                IF v_dt_has_updated_at THEN
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL, updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND table_number = p_table_number::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL
                    WHERE tenant_id = p_tenant_id
                      AND table_number = p_table_number::INTEGER;
                END IF;
            ELSE
                IF v_dt_has_updated_at THEN
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL, updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND table_number = p_table_number;
                ELSE
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL
                    WHERE tenant_id = p_tenant_id
                      AND table_number = p_table_number;
                END IF;
            END IF;
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;

        -- Rama C: legacy "local-table-N" -> N
        IF NOT v_table_freed AND p_table_id IS NOT NULL THEN
            v_sql := replace(p_table_id, 'local-table-', '');
            IF v_dt_num_type = 'integer' THEN
                IF v_dt_has_updated_at THEN
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL, updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND table_number = v_sql::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL
                    WHERE tenant_id = p_tenant_id
                      AND table_number = v_sql::INTEGER;
                END IF;
            ELSE
                IF v_dt_has_updated_at THEN
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL, updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND table_number = v_sql;
                ELSE
                    UPDATE dining_tables
                    SET status = 'free', current_order_id = NULL
                    WHERE tenant_id = p_tenant_id
                      AND table_number = v_sql;
                END IF;
            END IF;
            GET DIAGNOSTICS v_table_freed = ROW_COUNT;
        END IF;
    END IF;

    ------------------------------------------------------------------------
    -- 6) RETORNO
    ------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'ok',          TRUE,
        'order_id',    v_order_id,
        'items_count', v_items_count,
        'table_freed', v_table_freed
    );

EXCEPTION WHEN OTHERS THEN
    -- PL/pgSQL automáticamente hace ROLLBACK al lanzar EXCEPTION
    RETURN jsonb_build_object(
        'ok',    FALSE,
        'error', SQLERRM,
        'code',  SQLSTATE,
        'hint',  CASE
                    WHEN SQLSTATE = '42804' THEN 'Type mismatch — revisa columnas'
                    WHEN SQLSTATE = '42883' THEN 'Function not found'
                    WHEN SQLSTATE = '23503' THEN 'FK violation'
                    WHEN SQLSTATE = '23505' THEN 'Unique violation'
                    ELSE NULL
                 END
    );
END;
$fn$;

-- =====================================================================
-- 2. FN_UPDATE_TABLE_STATUS
-- =====================================================================
-- Detección automática de integer vs text para table_number.
-- Maneja id UUID, table_number, y legacy "local-table-N".
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
    v_num_type      TEXT;
    v_has_upd       BOOLEAN;
    v_has_oid       BOOLEAN;
    v_clean_status  TEXT;
    v_real_id       TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado', 'code', 'TENANT_NOT_FOUND');
    END IF;

    -- Normalizar status
    v_clean_status := LOWER(TRIM(COALESCE(p_status, 'free')));

    -- Detección de esquema
    SELECT data_type INTO v_num_type
    FROM information_schema.columns
    WHERE table_name = 'dining_tables' AND column_name = 'table_number';

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='updated_at')
    INTO v_has_upd;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='dining_tables' AND column_name='current_order_id')
    INTO v_has_oid;

    -- Strip 'local-table-' si viene así
    v_real_id := CASE
        WHEN p_table_id LIKE 'local-table-%' THEN substring(p_table_id FROM 'local-table-(.*)$')
        ELSE p_table_id
    END;

    ------------------------------------------------------------------
    -- Rama A: UPDATE por UUID (id)
    ------------------------------------------------------------------
    IF p_table_id IS NOT NULL
       AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        IF v_has_oid AND p_current_order_id IS NOT NULL THEN
            IF v_has_upd THEN
                UPDATE dining_tables
                SET status = v_clean_status,
                    current_order_id = p_current_order_id,
                    updated_at = now()
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            ELSE
                UPDATE dining_tables
                SET status = v_clean_status,
                    current_order_id = p_current_order_id
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            END IF;
        ELSIF v_has_oid THEN
            IF v_has_upd THEN
                UPDATE dining_tables
                SET status = v_clean_status,
                    current_order_id = NULL,
                    updated_at = now()
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            ELSE
                UPDATE dining_tables
                SET status = v_clean_status,
                    current_order_id = NULL
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            END IF;
        ELSE
            IF v_has_upd THEN
                UPDATE dining_tables
                SET status = v_clean_status, updated_at = now()
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            ELSE
                UPDATE dining_tables
                SET status = v_clean_status
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama B: UPDATE por table_number
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        IF v_num_type = 'integer' THEN
            IF v_has_oid AND p_current_order_id IS NOT NULL THEN
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER;
                END IF;
            ELSE
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER;
                END IF;
            END IF;
        ELSE  -- text
            IF v_has_oid AND p_current_order_id IS NOT NULL THEN
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number;
                END IF;
            ELSE
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number;
                END IF;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama C: UPDATE por legacy "local-table-N" -> N
    ------------------------------------------------------------------
    IF v_count = 0 AND v_real_id IS NOT NULL
       AND v_real_id ~ '^[0-9]+$' THEN
        IF v_num_type = 'integer' THEN
            IF v_has_oid AND p_current_order_id IS NOT NULL THEN
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id::INTEGER;
                END IF;
            ELSE
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id::INTEGER;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id::INTEGER;
                END IF;
            END IF;
        ELSE
            IF v_has_oid AND p_current_order_id IS NOT NULL THEN
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status, current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id;
                END IF;
            ELSE
                IF v_has_upd THEN
                    UPDATE dining_tables
                    SET status = v_clean_status, updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id;
                ELSE
                    UPDATE dining_tables
                    SET status = v_clean_status
                    WHERE tenant_id = p_tenant_id AND table_number = v_real_id;
                END IF;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    ------------------------------------------------------------------
    -- Rama D: INSERT si la mesa no existe (solo si dan table_number)
    ------------------------------------------------------------------
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        IF v_num_type = 'integer' THEN
            INSERT INTO dining_tables (tenant_id, table_number, status)
            VALUES (p_tenant_id, p_table_number::INTEGER, v_clean_status);
        ELSE
            INSERT INTO dining_tables (tenant_id, table_number, status)
            VALUES (p_tenant_id, p_table_number, v_clean_status);
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
-- 3. FN_UPSERT_DRAFT
-- =====================================================================
-- Guarda o actualiza un borrador de pedido en open_orders.
-- Acepta items en formato JSONB. Si la fila existe, UPDATE.
-- Si no, INSERT.
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
    v_id          UUID;
    v_has_items   BOOLEAN;
    v_has_status  BOOLEAN;
    v_has_updated BOOLEAN;
    v_has_oid     BOOLEAN;
    v_has_tid     BOOLEAN;
    v_sql         TEXT;
    v_legacy_id   TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;

    -- Detección de esquema
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='items')
    INTO v_has_items;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='status')
    INTO v_has_status;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='updated_at')
    INTO v_has_updated;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='order_id')
    INTO v_has_oid;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='table_id')
    INTO v_has_tid;

    -- Strip 'local-table-' si viene así
    v_legacy_id := CASE
        WHEN p_table_id LIKE 'local-table-%' THEN substring(p_table_id FROM 'local-table-(.*)$')
        ELSE p_table_id
    END;

    -- Buscar fila existente (por tenant_id + table_id + table_number)
    SELECT id INTO v_id
    FROM open_orders
    WHERE tenant_id = p_tenant_id
      AND (
          (p_table_number IS NOT NULL AND table_number::TEXT = p_table_number)
       OR (v_legacy_id IS NOT NULL AND table_number::TEXT = v_legacy_id)
      )
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        -- UPDATE
        v_sql := 'UPDATE open_orders SET ';
        IF v_has_items   THEN v_sql := v_sql || 'items = $1, ';       END IF;
        IF v_has_status  THEN v_sql := v_sql || 'status = ''open'', '; END IF;
        IF v_has_updated THEN v_sql := v_sql || 'updated_at = now(), '; END IF;
        v_sql := rtrim(v_sql, ', ');
        v_sql := v_sql || ' WHERE id = $2::UUID';

        IF v_has_items THEN
            EXECUTE v_sql USING p_items, v_id;
        ELSE
            v_sql := 'UPDATE open_orders SET ';
            IF v_has_status  THEN v_sql := v_sql || 'status = ''open'', '; END IF;
            IF v_has_updated THEN v_sql := v_sql || 'updated_at = now(), '; END IF;
            v_sql := rtrim(v_sql, ', ');
            v_sql := v_sql || ' WHERE id = $1::UUID';
            EXECUTE v_sql USING v_id;
        END IF;

        RETURN jsonb_build_object('ok', true, 'id', v_id, 'action', 'updated');
    ELSE
        -- INSERT
        v_sql := 'INSERT INTO open_orders (tenant_id';
        IF v_has_tid        THEN v_sql := v_sql || ', table_id';      END IF;
        v_sql := v_sql || ', table_number';
        IF v_has_items      THEN v_sql := v_sql || ', items';          END IF;
        IF v_has_status     THEN v_sql := v_sql || ', status';         END IF;
        IF v_has_updated    THEN v_sql := v_sql || ', updated_at';     END IF;
        v_sql := v_sql || ', waiter_name, notes';
        v_sql := v_sql || ') VALUES (';
        v_sql := v_sql || '$1::UUID';  -- tenant_id
        IF v_has_tid THEN
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_id), 'NULL');
        END IF;
        v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_number), 'NULL');
        IF v_has_items THEN
            v_sql := v_sql || ', $2::JSONB';
        END IF;
        IF v_has_status THEN
            v_sql := v_sql || ', ''open''';
        END IF;
        IF v_has_updated THEN
            v_sql := v_sql || ', now()::timestamptz';
        END IF;
        v_sql := v_sql || ', ' || COALESCE(quote_literal(p_waiter_name), 'NULL');
        v_sql := v_sql || ', ' || COALESCE(quote_literal(p_notes), 'NULL');
        v_sql := v_sql || ') RETURNING id';

        IF v_has_items THEN
            EXECUTE v_sql USING p_tenant_id, p_items INTO v_id;
        ELSE
            v_sql := 'INSERT INTO open_orders (tenant_id';
            IF v_has_tid    THEN v_sql := v_sql || ', table_id'; END IF;
            v_sql := v_sql || ', table_number';
            IF v_has_status  THEN v_sql := v_sql || ', status';    END IF;
            IF v_has_updated THEN v_sql := v_sql || ', updated_at'; END IF;
            v_sql := v_sql || ', waiter_name, notes';
            v_sql := v_sql || ') VALUES (';
            v_sql := v_sql || '$1::UUID';
            IF v_has_tid THEN
                v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_id), 'NULL');
            END IF;
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_table_number), 'NULL');
            IF v_has_status  THEN v_sql := v_sql || ', ''open''';      END IF;
            IF v_has_updated THEN v_sql := v_sql || ', now()::timestamptz'; END IF;
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_waiter_name), 'NULL');
            v_sql := v_sql || ', ' || COALESCE(quote_literal(p_notes), 'NULL');
            v_sql := v_sql || ') RETURNING id';
            EXECUTE v_sql USING p_tenant_id INTO v_id;
        END IF;

        RETURN jsonb_build_object('ok', true, 'id', v_id, 'action', 'inserted');
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$fn$;

-- =====================================================================
-- 4. FN_CLEAR_DRAFT
-- =====================================================================
-- Elimina el borrador vinculado a una mesa (o mesa+tenant completo).
-- Acepta p_table_id_or_number que puede ser UUID, número, o "local-table-N".
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
    v_count    INT := 0;
    v_has_tid  BOOLEAN;
    v_real_id  TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido', 'code', 'INVALID_INPUT');
    END IF;
    IF p_table_id_or_number IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_id_or_number requerido', 'code', 'INVALID_INPUT');
    END IF;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='open_orders' AND column_name='table_id')
    INTO v_has_tid;

    v_real_id := CASE
        WHEN p_table_id_or_number LIKE 'local-table-%' THEN substring(p_table_id_or_number FROM 'local-table-(.*)$')
        ELSE p_table_id_or_number
    END;

    -- Intento 1: por table_id (si columna existe)
    IF v_has_tid AND p_table_id_or_number ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        DELETE FROM open_orders
        WHERE tenant_id = p_tenant_id
          AND table_id = p_table_id_or_number;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- Intento 2: por table_number (text o integer)
    IF v_count = 0 AND v_real_id IS NOT NULL THEN
        DELETE FROM open_orders
        WHERE tenant_id = p_tenant_id
          AND table_number::TEXT = v_real_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('ok', true, 'deleted', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$fn$;

-- =====================================================================
-- 5. PERMISOS — usar regprocedure (firma completa) para evitar 42725
-- =====================================================================
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc AS p
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
    END LOOP;
END $$;

-- =====================================================================
-- 6. RELOAD SCHEMA + VERIFICACIÓN
-- =====================================================================
NOTIFY pgrst, 'reload schema';

SELECT 'rpcs_v4_5_2_ok' AS check,
       COUNT(*) AS cnt
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
      'fn_atomic_checkout',
      'fn_update_table_status',
      'fn_upsert_draft',
      'fn_clear_draft'
  );
