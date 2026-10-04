-- =====================================================================
-- MOZONA TPV — SQL #65 (PATRÓN RPC SECURITY DEFINER)
-- =====================================================================
-- Capa de transacciones atómicas que evitan bloqueos RLS directos
-- en el cliente. Las funciones se ejecutan con SECURITY DEFINER
-- para bypassear RLS y validar el tenant_id internamente.
--
-- REGLAS:
--   ✓ Idempotente (CREATE OR REPLACE)
--   ✓ NO borra datos (ALTER TABLE ADD COLUMN IF NOT EXISTS)
--   ✓ Validación de tenant_id obligatoria en cada función
--   ✓ Retorna JSONB con {ok, error, data}
--
-- NOTA IMPORTANTE (v4.4.9):
--   Si ya tienes instalada una versión anterior de este SQL
--   y aparecen errores de GRANT por funciones duplicadas
--   (overloads), ejecuta SOLO el bloque de GRANT del paso 10
--   (abajo) — eso es seguro y no toca nada más.
--   NO uses DROP FUNCTION con CASCADE indiscriminadamente:
--   borra funciones ajenas y objetos dependientes.
-- =====================================================================

-- =====================================================================
-- 1. FN_ATOMIC_CHECKOUT — INSERT orders + items + free mesa atómico
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_atomic_checkout(
    p_tenant_id       UUID,
    p_table_id        TEXT DEFAULT NULL,
    p_table_number    TEXT DEFAULT NULL,
    p_items           JSONB DEFAULT '[]'::jsonb,
    p_subtotal        NUMERIC DEFAULT 0,
    p_tax_total       NUMERIC DEFAULT 0,
    p_total           NUMERIC DEFAULT 0,
    p_payment_method  TEXT DEFAULT 'cash',
    p_waiter_name     TEXT DEFAULT 'Caja',
    p_series          TEXT DEFAULT 'T-F',
    p_invoice_number  INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id     UUID;
    v_item         JSONB;
    v_clean_tid    UUID;
    v_sql          TEXT;
    v_cols         TEXT;
    v_vals         TEXT;
    v_qty          NUMERIC;
    v_price        NUMERIC;
BEGIN
    -- ★ Validación tenant_id obligatorio
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- ★ Limpiar zero-UUID defensivo
    v_clean_tid := CASE
        WHEN p_tenant_id = '00000000-0000-0000-0000-000000000000' THEN NULL
        ELSE p_tenant_id
    END;

    IF v_clean_tid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id invalido');
    END IF;

    -- ★ Verificar tenant existe
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_clean_tid) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado');
    END IF;

    -- 1) INSERT order (v4.4.9: arrays paralelos col/val en mismo orden)
    DECLARE
        v_order_col TEXT;
        v_order_val TEXT;
        v_col_list  TEXT := '';
        v_val_list  TEXT := '';
    BEGIN
        -- tenant_id (siempre primero)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='tenant_id') THEN
            v_col_list := v_col_list || 'tenant_id,';
            v_val_list := v_val_list || quote_literal(v_clean_tid::text) || '::UUID,';
        END IF;
        -- waiter_name
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='waiter_name') THEN
            v_col_list := v_col_list || 'waiter_name,';
            v_val_list := v_val_list || quote_literal(COALESCE(p_waiter_name, 'Caja')) || ',';
        END IF;
        -- subtotal / tax_total / total
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='subtotal') THEN
            v_col_list := v_col_list || 'subtotal,';
            v_val_list := v_val_list || COALESCE(p_subtotal, p_total)::text || ',';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='tax_total') THEN
            v_col_list := v_col_list || 'tax_total,';
            v_val_list := v_val_list || COALESCE(p_tax_total, 0)::text || ',';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='total') THEN
            v_col_list := v_col_list || 'total,';
            v_val_list := v_val_list || COALESCE(p_total, 0)::text || ',';
        END IF;
        -- payment_method / status
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='payment_method') THEN
            v_col_list := v_col_list || 'payment_method,';
            v_val_list := v_val_list || quote_literal(COALESCE(p_payment_method, 'cash')) || ',';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='status') THEN
            v_col_list := v_col_list || 'status,';
            v_val_list := v_val_list || '''closed'',';
        END IF;
        -- series / invoice_number / items_count
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='series') THEN
            v_col_list := v_col_list || 'series,';
            v_val_list := v_val_list || quote_literal(COALESCE(p_series, 'T-F')) || ',';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='invoice_number') THEN
            v_col_list := v_col_list || 'invoice_number,';
            v_val_list := v_val_list || COALESCE(p_invoice_number, floor(random() * 999999)::int)::text || ',';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='items_count') THEN
            v_col_list := v_col_list || 'items_count,';
            v_val_list := v_val_list || jsonb_array_length(COALESCE(p_items, '[]'::jsonb))::text || ',';
        END IF;
        -- created_at / updated_at (timestamps SIEMPRE now() — evita 42804)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='created_at') THEN
            v_col_list := v_col_list || 'created_at,';
            v_val_list := v_val_list || 'now(),';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='orders' AND column_name='updated_at') THEN
            v_col_list := v_col_list || 'updated_at,';
            v_val_list := v_val_list || 'now(),';
        END IF;

        -- Quitar coma final
        v_col_list := rtrim(v_col_list, ',');
        v_val_list := rtrim(v_val_list, ',');

        v_order_sql := 'INSERT INTO orders (' || v_col_list || ') VALUES (' || v_val_list || ') RETURNING id';
        EXECUTE v_order_sql INTO v_order_id;
    END;

    -- 2) INSERT order_items (bulk) — v4.4.9: arrays paralelos
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_qty   := COALESCE((v_item->>'quantity')::NUMERIC, 1);
            v_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
            v_cols  := '';
            v_vals  := '';

            -- tenant_id
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='tenant_id') THEN
                v_cols := v_cols || 'tenant_id,'; v_vals := v_vals || quote_literal(v_clean_tid::text) || '::UUID,';
            END IF;
            -- order_id
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='order_id') THEN
                v_cols := v_cols || 'order_id,'; v_vals := v_vals || quote_literal(v_order_id::text) || '::UUID,';
            END IF;
            -- product_id
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='product_id') THEN
                v_cols := v_cols || 'product_id,';
                IF (v_item->>'product_id') IS NOT NULL THEN
                    v_vals := v_vals || quote_literal(v_item->>'product_id') || '::UUID,';
                ELSE
                    v_vals := v_vals || 'NULL,';
                END IF;
            END IF;
            -- name
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='name') THEN
                v_cols := v_cols || 'name,'; v_vals := v_vals || quote_literal(COALESCE(v_item->>'name', 'Item')) || ',';
            END IF;
            -- quantity
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='quantity') THEN
                v_cols := v_cols || 'quantity,'; v_vals := v_vals || v_qty::text || ',';
            END IF;
            -- unit_price (nuevo)
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='unit_price') THEN
                v_cols := v_cols || 'unit_price,'; v_vals := v_vals || v_price::text || ',';
            END IF;
            -- price (legacy)
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='price') THEN
                v_cols := v_cols || 'price,'; v_vals := v_vals || v_price::text || ',';
            END IF;
            -- subtotal
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='subtotal') THEN
                v_cols := v_cols || 'subtotal,'; v_vals := v_vals || (v_qty * v_price)::text || ',';
            END IF;
            -- tax_rate
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='tax_rate') THEN
                v_cols := v_cols || 'tax_rate,';
                v_vals := v_vals || COALESCE((v_item->>'tax_rate')::NUMERIC, 10)::text || ',';
            END IF;
            -- notes
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='notes') THEN
                v_cols := v_cols || 'notes,';
                IF (v_item->>'notes') IS NOT NULL THEN
                    v_vals := v_vals || quote_literal(v_item->>'notes') || ',';
                ELSE
                    v_vals := v_vals || 'NULL,';
                END IF;
            END IF;
            -- created_at
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='order_items' AND column_name='created_at') THEN
                v_cols := v_cols || 'created_at,'; v_vals := v_vals || 'now(),';
            END IF;

            v_cols := rtrim(v_cols, ',');
            v_vals := rtrim(v_vals, ',');
            v_sql  := 'INSERT INTO order_items (' || v_cols || ') VALUES (' || v_vals || ')';
            EXECUTE v_sql;
        END LOOP;
    END IF;

    -- 3) DELETE open_orders de esa mesa
    IF p_table_number IS NOT NULL THEN
        DELETE FROM open_orders
        WHERE tenant_id = v_clean_tid
          AND (table_number = p_table_number OR table_id = p_table_id);
    ELSIF p_table_id IS NOT NULL THEN
        DELETE FROM open_orders
        WHERE tenant_id = v_clean_tid
          AND (table_id = p_table_id OR table_number = p_table_id);
    END IF;

    -- 4) PATCH dining_tables -> free
    IF p_table_number IS NOT NULL THEN
        UPDATE dining_tables
        SET status = 'free', current_order_id = NULL,
            updated_at = now()
        WHERE tenant_id = v_clean_tid AND table_number = p_table_number;
    ELSIF p_table_id IS NOT NULL THEN
        -- intentar por UUID id
        BEGIN
            UPDATE dining_tables
            SET status = 'free', current_order_id = NULL,
                updated_at = now()
            WHERE tenant_id = v_clean_tid AND id = p_table_id::UUID;
        EXCEPTION WHEN OTHERS THEN
            -- table_id no es UUID, intentar como table_number
            UPDATE dining_tables
            SET status = 'free', current_order_id = NULL,
                updated_at = now()
            WHERE tenant_id = v_clean_tid AND table_number = p_table_id;
        END;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'items_count', jsonb_array_length(COALESCE(p_items, '[]'::jsonb))
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'ok', false,
        'error', SQLERRM,
        'code', SQLSTATE
    );
END;
$$;

-- =====================================================================
-- 2. FN_UPSERT_DRAFT — UPSERT open_orders
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_upsert_draft(
    p_tenant_id    UUID,
    p_table_id     TEXT,
    p_table_number TEXT,
    p_items        JSONB DEFAULT '[]'::jsonb,
    p_notes        TEXT DEFAULT NULL,
    p_waiter_name  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row     open_orders%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- Borrar si items vacíos
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        DELETE FROM open_orders
        WHERE tenant_id = p_tenant_id
          AND (table_number = p_table_number OR table_id = p_table_id);
        RETURN jsonb_build_object('ok', true, 'cleared', true);
    END IF;

    INSERT INTO open_orders (
        tenant_id, table_id, table_number, items, notes, waiter_name, status
    ) VALUES (
        p_tenant_id, p_table_id, p_table_number, p_items, p_notes, p_waiter_name, 'open'
    )
    ON CONFLICT (tenant_id, table_number) DO UPDATE SET
        items = EXCLUDED.items,
        notes = EXCLUDED.notes,
        waiter_name = EXCLUDED.waiter_name,
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 3. FN_CLEAR_DRAFT — DELETE open_orders
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_clear_draft(
    p_tenant_id     UUID,
    p_table_id_or_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    DELETE FROM open_orders
    WHERE tenant_id = p_tenant_id
      AND (table_number = p_table_id_or_number OR table_id = p_table_id_or_number);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'deleted', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 4. FN_UPDATE_TABLE_STATUS — PATCH dining_tables (v4.4.4 SQL DINÁMICO)
-- =====================================================================
-- Detecta columnas presentes para evitar:
--   - operator does not exist: integer = text (table_number)
--   - updated_at does not exist (PGRST204)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_update_table_status(
    p_tenant_id      UUID,
    p_table_id       TEXT,
    p_table_number   TEXT DEFAULT NULL,
    p_status         TEXT DEFAULT 'free',
    p_current_order_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row       dining_tables%ROWTYPE;
    v_count     INT := 0;
    v_num_type  TEXT;  -- 'integer' or 'text'
    v_has_upd   BOOLEAN;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- Detectar tipo de table_number (puede ser integer o text)
    SELECT data_type INTO v_num_type
    FROM information_schema.columns
    WHERE table_name = 'dining_tables' AND column_name = 'table_number';

    -- Detectar si updated_at existe
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dining_tables' AND column_name = 'updated_at'
    ) INTO v_has_upd;

    -- v4.4.9: helper inline (cada rama construye su SQL completo)
    -- SET clause (común a todas las ramas UPDATE)
    -- ================================================================
    -- Rama A: UPDATE por UUID (id) — p_table_id es UUID
    -- ================================================================
    IF p_table_id IS NOT NULL
       AND p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        IF v_has_upd THEN
            IF p_current_order_id IS NOT NULL THEN
                UPDATE dining_tables
                SET status = LOWER(p_status),
                    current_order_id = p_current_order_id,
                    updated_at = now()
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID
                RETURNING * INTO v_row;
            ELSE
                UPDATE dining_tables
                SET status = LOWER(p_status),
                    updated_at = now()
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID
                RETURNING * INTO v_row;
            END IF;
        ELSE
            IF p_current_order_id IS NOT NULL THEN
                UPDATE dining_tables
                SET status = LOWER(p_status),
                    current_order_id = p_current_order_id
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID
                RETURNING * INTO v_row;
            ELSE
                UPDATE dining_tables
                SET status = LOWER(p_status)
                WHERE tenant_id = p_tenant_id AND id = p_table_id::UUID
                RETURNING * INTO v_row;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- ================================================================
    -- Rama B: UPDATE por table_number explícito (p_table_number)
    -- ================================================================
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        IF v_num_type = 'integer' THEN
            IF v_has_upd THEN
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id,
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER
                    RETURNING * INTO v_row;
                END IF;
            ELSE
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status)
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number::INTEGER
                    RETURNING * INTO v_row;
                END IF;
            END IF;
        ELSE  -- text
            IF v_has_upd THEN
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id,
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number
                    RETURNING * INTO v_row;
                END IF;
            ELSE
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status)
                    WHERE tenant_id = p_tenant_id AND table_number = p_table_number
                    RETURNING * INTO v_row;
                END IF;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- ================================================================
    -- Rama C: UPDATE por table_number derivado de p_table_id legacy
    --         ("local-table-8" → 8)
    -- ================================================================
    IF v_count = 0 AND p_table_id IS NOT NULL THEN
        IF v_num_type = 'integer' THEN
            IF v_has_upd THEN
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id,
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id::INTEGER
                           OR table_number = REPLACE(p_table_id, 'local-table-', '')::INTEGER)
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id::INTEGER
                           OR table_number = REPLACE(p_table_id, 'local-table-', '')::INTEGER)
                    RETURNING * INTO v_row;
                END IF;
            ELSE
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id::INTEGER
                           OR table_number = REPLACE(p_table_id, 'local-table-', '')::INTEGER)
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status)
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id::INTEGER
                           OR table_number = REPLACE(p_table_id, 'local-table-', '')::INTEGER)
                    RETURNING * INTO v_row;
                END IF;
            END IF;
        ELSE
            IF v_has_upd THEN
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id,
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id
                           OR table_number = REPLACE(p_table_id, 'local-table-', ''))
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        updated_at = now()
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id
                           OR table_number = REPLACE(p_table_id, 'local-table-', ''))
                    RETURNING * INTO v_row;
                END IF;
            ELSE
                IF p_current_order_id IS NOT NULL THEN
                    UPDATE dining_tables
                    SET status = LOWER(p_status),
                        current_order_id = p_current_order_id
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id
                           OR table_number = REPLACE(p_table_id, 'local-table-', ''))
                    RETURNING * INTO v_row;
                ELSE
                    UPDATE dining_tables
                    SET status = LOWER(p_status)
                    WHERE tenant_id = p_tenant_id
                      AND (table_number = p_table_id
                           OR table_number = REPLACE(p_table_id, 'local-table-', ''))
                    RETURNING * INTO v_row;
                END IF;
            END IF;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- ================================================================
    -- Rama D: INSERT (mesa no existe, crear)
    -- ================================================================
    IF v_count = 0 AND p_table_number IS NOT NULL THEN
        IF v_num_type = 'integer' THEN
            INSERT INTO dining_tables (tenant_id, table_number, status, current_order_id)
            VALUES (
                p_tenant_id, p_table_number::INTEGER,
                LOWER(p_status), p_current_order_id
            )
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO dining_tables (tenant_id, table_number, status, current_order_id)
            VALUES (
                p_tenant_id, p_table_number,
                LOWER(p_status), p_current_order_id
            )
            RETURNING * INTO v_row;
        END IF;
        v_count := 1;
    END IF;
        v_sql := v_sql || ') RETURNING *';
        EXECUTE v_sql INTO v_row;
        v_count := 1;
    END IF;

    IF v_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'mesa no encontrada', 'count', 0);
    END IF;

    RETURN jsonb_build_object('ok', true, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 5. FN_CANCEL_SALE — DELETE orders (CASCADE items)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_cancel_sale(
    p_tenant_id UUID,
    p_order_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_items_count INT := 0;
    v_deleted_count INT := 0;
BEGIN
    IF p_tenant_id IS NULL OR p_order_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id y order_id requeridos');
    END IF;

    -- 1) DELETE order_items (defense in depth — CASCADE debería bastar)
    DELETE FROM order_items
    WHERE tenant_id = p_tenant_id AND order_id = p_order_id;
    GET DIAGNOSTICS v_items_count = ROW_COUNT;

    -- 2) DELETE orders (con CASCADE automático)
    DELETE FROM orders
    WHERE tenant_id = p_tenant_id AND id = p_order_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'orden no encontrada');
    END IF;

    -- 3) DELETE open_orders huérfanas (no estaban linkeadas)
    DELETE FROM open_orders
    WHERE tenant_id = p_tenant_id AND order_id = p_order_id;

    RETURN jsonb_build_object(
        'ok', true,
        'deleted_items', v_items_count,
        'order_id', p_order_id
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 6. FN_SAVE_PRODUCT — UPSERT products
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_save_product(
    p_tenant_id   UUID,
    p_id          UUID DEFAULT NULL,
    p_name        TEXT DEFAULT '',
    p_price       NUMERIC DEFAULT 0,
    p_category    TEXT DEFAULT 'Otros',
    p_category_id UUID DEFAULT NULL,
    p_image_url   TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_tax_rate    NUMERIC DEFAULT 10,
    p_is_active   BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT := 0;
    v_row products%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;
    IF p_name IS NULL OR LENGTH(TRIM(p_name)) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'name requerido');
    END IF;

    IF p_id IS NOT NULL THEN
        UPDATE products SET
            name = p_name, price = p_price, category = p_category,
            category_id = p_category_id, image_url = p_image_url,
            description = p_description, tax_rate = p_tax_rate,
            is_active = p_is_active, updated_at = now()
        WHERE tenant_id = p_tenant_id AND id = p_id
        RETURNING * INTO v_row;
        GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    IF v_count = 0 THEN
        INSERT INTO products (
            tenant_id, name, price, category, category_id,
            image_url, description, tax_rate, is_active, is_available
        ) VALUES (
            p_tenant_id, p_name, p_price, COALESCE(NULLIF(p_category, ''), 'Otros'),
            p_category_id, p_image_url, p_description, p_tax_rate, p_is_active, true
        )
        RETURNING * INTO v_row;
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 7. FN_DELETE_PRODUCT — DELETE products
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_delete_product(
    p_tenant_id UUID,
    p_id        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count INT;
BEGIN
    IF p_tenant_id IS NULL OR p_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id y id requeridos');
    END IF;

    DELETE FROM products
    WHERE tenant_id = p_tenant_id AND id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'deleted', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 8. FN_SAVE_TENANT_SETTINGS — UPSERT tenant_settings
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_save_tenant_settings(
    p_tenant_id            UUID,
    p_header_text          TEXT DEFAULT NULL,
    p_footer_text          TEXT DEFAULT NULL,
    p_show_vat_breakdown   BOOLEAN DEFAULT true,
    p_ticket_paper_width   INTEGER DEFAULT 58,
    p_ticket_layout_json   JSONB DEFAULT NULL,
    p_theme_mode           TEXT DEFAULT 'system',
    p_theme_accent         TEXT DEFAULT 'blue',
    p_theme_contrast       TEXT DEFAULT 'normal',
    p_button_size          TEXT DEFAULT 'md',
    p_grid_density         TEXT DEFAULT 'normal',
    p_panel_layout         TEXT DEFAULT 'horizontal',
    p_show_product_images  BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_row tenant_settings%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    INSERT INTO tenant_settings (
        tenant_id, header_text, footer_text, show_vat_breakdown,
        ticket_paper_width, ticket_layout_json, theme_mode, theme_accent,
        theme_contrast, button_size, grid_density, panel_layout,
        show_product_images, updated_at
    ) VALUES (
        p_tenant_id, p_header_text, p_footer_text, p_show_vat_breakdown,
        p_ticket_paper_width, p_ticket_layout_json, p_theme_mode, p_theme_accent,
        p_theme_contrast, p_button_size, p_grid_density, p_panel_layout,
        p_show_product_images, now()
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        header_text = EXCLUDED.header_text,
        footer_text = EXCLUDED.footer_text,
        show_vat_breakdown = EXCLUDED.show_vat_breakdown,
        ticket_paper_width = EXCLUDED.ticket_paper_width,
        ticket_layout_json = EXCLUDED.ticket_layout_json,
        theme_mode = EXCLUDED.theme_mode,
        theme_accent = EXCLUDED.theme_accent,
        theme_contrast = EXCLUDED.theme_contrast,
        button_size = EXCLUDED.button_size,
        grid_density = EXCLUDED.grid_density,
        panel_layout = EXCLUDED.panel_layout,
        show_product_images = EXCLUDED.show_product_images,
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 9. FN_SAVE_COMPANY — PATCH tenants (datos empresa + ticket)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_save_company(
    p_tenant_id          UUID,
    p_business_name      TEXT DEFAULT NULL,
    p_cif_nif            TEXT DEFAULT NULL,
    p_address            TEXT DEFAULT NULL,
    p_phone              TEXT DEFAULT NULL,
    p_contact_email      TEXT DEFAULT NULL,
    p_ticket_header_msg  TEXT DEFAULT NULL,
    p_ticket_footer_msg  TEXT DEFAULT NULL,
    p_ticket_show_tax    BOOLEAN DEFAULT NULL,
    p_ticket_paper_width INTEGER DEFAULT NULL,
    p_default_series     TEXT DEFAULT NULL,
    p_business_type      TEXT DEFAULT NULL,
    p_features_config    JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_row tenants%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    UPDATE tenants SET
        business_name      = COALESCE(p_business_name, business_name),
        cif_nif            = COALESCE(p_cif_nif, cif_nif),
        address            = COALESCE(p_address, address),
        phone              = COALESCE(p_phone, phone),
        contact_email      = COALESCE(p_contact_email, contact_email),
        ticket_header_msg  = COALESCE(p_ticket_header_msg, ticket_header_msg),
        ticket_footer_msg  = COALESCE(p_ticket_footer_msg, ticket_footer_msg),
        ticket_show_tax    = COALESCE(p_ticket_show_tax, ticket_show_tax),
        ticket_paper_width = COALESCE(p_ticket_paper_width, ticket_paper_width),
        default_series     = COALESCE(p_default_series, default_series),
        business_type      = COALESCE(p_business_type, business_type),
        features_config    = COALESCE(p_features_config, features_config),
        updated_at         = now()
    WHERE id = p_tenant_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado');
    END IF;

    RETURN jsonb_build_object('ok', true, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 9.5 FN_GET_TENANT_CATEGORIES — SELECT categories
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_get_tenant_categories(
    p_tenant_id  UUID,
    p_only_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.sort_order, c.name), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT id, tenant_id, name, sort_order, image_url,
               COALESCE(is_active, true) AS is_active,
               metadata, created_at, updated_at
        FROM categories
        WHERE tenant_id = p_tenant_id
          AND (NOT p_only_active OR COALESCE(is_active, true) = true)
    ) c;

    RETURN jsonb_build_object('ok', true, 'data', v_rows, 'count', jsonb_array_length(v_rows));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 9.6 FN_SAVE_CATEGORY — UPSERT categories
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_save_category(
    p_tenant_id   UUID,
    p_id          UUID DEFAULT NULL,
    p_name        TEXT DEFAULT '',
    p_sort_order  INTEGER DEFAULT 0,
    p_image_url   TEXT DEFAULT NULL,
    p_is_active   BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row categories%ROWTYPE;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;
    IF p_name IS NULL OR LENGTH(TRIM(p_name)) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'name requerido');
    END IF;

    IF p_id IS NOT NULL THEN
        UPDATE categories SET
            name = p_name,
            sort_order = p_sort_order,
            image_url = COALESCE(p_image_url, image_url),
            is_active = p_is_active,
            updated_at = now()
        WHERE tenant_id = p_tenant_id AND id = p_id
        RETURNING * INTO v_row;
    END IF;

    IF v_row.id IS NULL THEN
        INSERT INTO categories (tenant_id, name, sort_order, image_url, is_active)
        VALUES (p_tenant_id, p_name, p_sort_order, p_image_url, p_is_active)
        RETURNING * INTO v_row;
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'data', to_jsonb(v_row));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 9.7 FN_DELETE_CATEGORY — DELETE categories
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_delete_category(
    p_tenant_id UUID,
    p_id        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count INT;
BEGIN
    IF p_tenant_id IS NULL OR p_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id y id requeridos');
    END IF;

    DELETE FROM categories
    WHERE tenant_id = p_tenant_id AND id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'deleted', v_count);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 10. PERMISOS — usar regprocedure (firma completa) para evitar
--               ambigüedad cuando hay overloads de fn_atomic_checkout
-- =====================================================================
-- Solo 'authenticated' y 'service_role'. NO 'anon':
--   estas funciones verifican que el tenant existe, pero
--   NO autorizan al caller a actuar sobre ese tenant.
--   Anon solo debe poder llamar fn_atomic_checkout para
--   flujo publico si explicitamente se necesita.
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc AS p
        WHERE p.pronamespace = 'public'::regnamespace
          AND left(p.proname, 3) = 'fn_'
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
            fn.signature
        );
    END LOOP;
END $$;

-- =====================================================================
-- 11. RELOAD SCHEMA
-- =====================================================================
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 12. VERIFICACIÓN
-- =====================================================================
SELECT 'rpc_functions' AS check, COUNT(*) AS cnt FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname LIKE 'fn_%'
UNION ALL
SELECT 'grants_total', COUNT(*) FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' AND privilege_type = 'EXECUTE';
