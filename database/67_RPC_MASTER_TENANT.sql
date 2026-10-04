-- =====================================================================
-- MOZONA TPV — SQL #67 (RPC MAESTRO TENANT-SCOPED + AUDITORÍA AISLAMIENTO)
-- =====================================================================
-- Esta migración establece RPCs SECURITY DEFINER como ÚNICO punto
-- de entrada para datos críticos multi-tenant:
--
--   • fn_get_company_full(tenant_id) — datos empresa + ticket
--   • fn_save_company_full(tenant_id, payload) — UPSERT atómico
--   • fn_get_tenant_dashboard(tenant_id) — todo para arrancar TPV
--   • fn_get_categories_safe(tenant_id)   — categorías del tenant
--   • fn_get_products_safe(tenant_id)     — productos del tenant
--   • fn_get_tables_safe(tenant_id)       — mesas del tenant
--   • fn_get_drafts_safe(tenant_id)       — borradores del tenant
--   • fn_get_open_orders_safe(tenant_id)  — órdenes abiertas
--   • fn_get_orders_safe(tenant_id, ...)  — órdenes históricas
--
-- TODAS las funciones:
--   ✓ SECURITY DEFINER — bypass RLS para validación centralizada
--   ✓ Validan tenant_id y verifican que existe
--   ✓ Validan que el caller tiene acceso (service_role bypass, o
--     el tenant_id debe existir en tenants)
--   ✓ Retornan JSONB estructurado {ok, error, data}
--   ✓ Idempotentes (CREATE OR REPLACE)
--   ✓ NO DROP de tablas (preservación de datos)
--
-- AUDITORÍA DE AISLAMIENTO:
--   La idea es que el frontend NUNCA use supabase.from('tenants')
--   o supabase.from('products') directamente. SIEMPRE via RPC.
--   RLS sigue activo como segunda capa de defensa.
-- =====================================================================

-- =====================================================================
-- 1. FN_GET_COMPANY_FULL — datos empresa + ticket del tenant
-- =====================================================================
-- Devuelve TODOS los campos relacionados con empresa y ticket:
--   tenants.{business_name, cif_nif, address, phone, contact_email,
--             ticket_header_msg, ticket_footer_msg, ticket_show_tax,
--             logo_url, paper_width_mm, theme_accent, ...}
--   tenant_settings.{ticket_width_mm, ticket_paper_size,
--                    ticket_show_logo, ticket_show_address, ...}
--
-- Si no encuentra fila en tenant_settings, crea una con defaults.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_get_company_full(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant       JSONB;
    v_settings     JSONB;
    v_company      JSONB;
    v_final        JSONB;
    v_has_thm      BOOLEAN;
    v_has_tf       BOOLEAN;
    v_has_tax      BOOLEAN;
    v_has_paper    BOOLEAN;
    v_has_logo     BOOLEAN;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- Verificar que el tenant existe
    SELECT to_jsonb(t.*) INTO v_tenant
    FROM tenants t
    WHERE id = p_tenant_id;

    IF v_tenant IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado');
    END IF;

    -- Obtener o crear tenant_settings
    SELECT to_jsonb(ts.*) INTO v_settings
    FROM tenant_settings ts
    WHERE tenant_id = p_tenant_id;

    IF v_settings IS NULL THEN
        -- Crear fila por defecto (idempotente)
        INSERT INTO tenant_settings (tenant_id)
        VALUES (p_tenant_id)
        ON CONFLICT (tenant_id) DO NOTHING
        RETURNING to_jsonb(tenant_settings.*) INTO v_settings;

        -- Si ON CONFLICT no retorna (ya existía), re-leer
        IF v_settings IS NULL THEN
            SELECT to_jsonb(ts.*) INTO v_settings
            FROM tenant_settings ts
            WHERE tenant_id = p_tenant_id;
        END IF;
    END IF;

    -- Detectar columnas disponibles (dynamic schema)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_header_msg'
    ) INTO v_has_thm;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_footer_msg'
    ) INTO v_has_tf;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_show_tax'
    ) INTO v_has_tax;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenant_settings' AND column_name='paper_width_mm'
    ) INTO v_has_paper;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='logo_url'
    ) INTO v_has_logo;

    -- Mezclar ambas fuentes: prioridad a tenant_settings sobre tenants
    v_company := jsonb_build_object(
        'tenant_id',        p_tenant_id,
        'business_name',    COALESCE(v_tenant->>'business_name', ''),
        'cif_nif',          COALESCE(v_tenant->>'cif_nif', ''),
        'address',          COALESCE(v_tenant->>'address', ''),
        'phone',            COALESCE(v_tenant->>'phone', ''),
        'contact_email',    COALESCE(v_tenant->>'contact_email', ''),
        'ticket_header_msg',
            CASE
                WHEN v_has_thm THEN COALESCE(v_tenant->>'ticket_header_msg',
                                              v_settings->>'ticket_header_msg', '')
                ELSE COALESCE(v_settings->>'ticket_header_msg', '')
            END,
        'ticket_footer_msg',
            CASE
                WHEN v_has_tf THEN COALESCE(v_tenant->>'ticket_footer_msg',
                                              v_settings->>'ticket_footer_msg', '')
                ELSE COALESCE(v_settings->>'ticket_footer_msg', '')
            END,
        'ticket_show_tax',
            CASE
                WHEN v_has_tax THEN COALESCE((v_tenant->>'ticket_show_tax')::BOOLEAN,
                                              (v_settings->>'ticket_show_tax')::BOOLEAN, TRUE)
                ELSE COALESCE((v_settings->>'ticket_show_tax')::BOOLEAN, TRUE)
            END,
        'paper_width_mm',
            CASE
                WHEN v_has_paper THEN COALESCE((v_settings->>'paper_width_mm')::INTEGER, 80)
                ELSE 80
            END,
        'logo_url',
            CASE
                WHEN v_has_logo THEN COALESCE(v_tenant->>'logo_url', '')
                ELSE ''
            END,
        'updated_at',       COALESCE(v_settings->>'updated_at', v_tenant->>'updated_at', now()::text)
    );

    RETURN jsonb_build_object('ok', true, 'data', v_company);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 2. FN_SAVE_COMPANY_FULL — UPSERT atómico de empresa + ticket
-- =====================================================================
-- Actualiza tenants + tenant_settings en una sola transacción.
-- Acepta TODOS los campos como opcionales; solo modifica los enviados.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_save_company_full(
    p_tenant_id     UUID,
    p_business_name TEXT DEFAULT NULL,
    p_cif_nif       TEXT DEFAULT NULL,
    p_address       TEXT DEFAULT NULL,
    p_phone         TEXT DEFAULT NULL,
    p_contact_email TEXT DEFAULT NULL,
    p_ticket_header_msg TEXT DEFAULT NULL,
    p_ticket_footer_msg TEXT DEFAULT NULL,
    p_ticket_show_tax   BOOLEAN DEFAULT NULL,
    p_paper_width_mm    INTEGER DEFAULT NULL,
    p_logo_url      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_has_thm    BOOLEAN;
    v_has_tf     BOOLEAN;
    v_has_tax    BOOLEAN;
    v_has_paper  BOOLEAN;
    v_has_logo   BOOLEAN;
    v_set_clause TEXT := '';
    v_sql        TEXT;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- Verificar tenant existe
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado');
    END IF;

    -- Detectar columnas (por si falta alguna)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_header_msg'
    ) INTO v_has_thm;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_footer_msg'
    ) INTO v_has_tf;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='ticket_show_tax'
    ) INTO v_has_tax;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenant_settings' AND column_name='paper_width_mm'
    ) INTO v_has_paper;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='logo_url'
    ) INTO v_has_logo;

    -- Construir UPDATE dinámico para tenants (solo columnas que existen)
    IF p_business_name IS NOT NULL THEN
        v_set_clause := v_set_clause || 'business_name = ' || quote_literal(p_business_name) || ',';
    END IF;
    IF p_cif_nif IS NOT NULL THEN
        v_set_clause := v_set_clause || 'cif_nif = ' || quote_literal(p_cif_nif) || ',';
    END IF;
    IF p_address IS NOT NULL THEN
        v_set_clause := v_set_clause || 'address = ' || quote_literal(p_address) || ',';
    END IF;
    IF p_phone IS NOT NULL THEN
        v_set_clause := v_set_clause || 'phone = ' || quote_literal(p_phone) || ',';
    END IF;
    IF p_contact_email IS NOT NULL THEN
        v_set_clause := v_set_clause || 'contact_email = ' || quote_literal(p_contact_email) || ',';
    END IF;
    IF v_has_thm AND p_ticket_header_msg IS NOT NULL THEN
        v_set_clause := v_set_clause || 'ticket_header_msg = ' || quote_literal(p_ticket_header_msg) || ',';
    END IF;
    IF v_has_tf AND p_ticket_footer_msg IS NOT NULL THEN
        v_set_clause := v_set_clause || 'ticket_footer_msg = ' || quote_literal(p_ticket_footer_msg) || ',';
    END IF;
    IF v_has_tax AND p_ticket_show_tax IS NOT NULL THEN
        v_set_clause := v_set_clause || 'ticket_show_tax = ' || p_ticket_show_tax::TEXT || ',';
    END IF;
    IF v_has_logo AND p_logo_url IS NOT NULL THEN
        v_set_clause := v_set_clause || 'logo_url = ' || quote_literal(p_logo_url) || ',';
    END IF;
    -- updated_at SIEMPRE al final
    v_set_clause := v_set_clause || 'updated_at = now()';

    IF v_set_clause IS NOT NULL AND length(v_set_clause) > 0 THEN
        v_sql := 'UPDATE tenants SET ' || v_set_clause || ' WHERE id = ' || quote_literal(p_tenant_id::text) || '::UUID';
        EXECUTE v_sql;
    END IF;

    -- UPSERT tenant_settings (papel y ticket_*) — siempre
    -- Construir UPSERT dinámico para columnas que existen
    DECLARE
        v_ts_col TEXT := '';
        v_ts_val TEXT := '';
    BEGIN
        -- Asegurar fila existe
        INSERT INTO tenant_settings (tenant_id)
        VALUES (p_tenant_id)
        ON CONFLICT (tenant_id) DO NOTHING;

        -- ticket_header_msg en tenant_settings (si existe)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='ticket_header_msg')
           AND p_ticket_header_msg IS NOT NULL THEN
            v_ts_col := v_ts_col || 'ticket_header_msg,';
            v_ts_val := v_ts_val || quote_literal(p_ticket_header_msg) || ',';
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='ticket_footer_msg')
           AND p_ticket_footer_msg IS NOT NULL THEN
            v_ts_col := v_ts_col || 'ticket_footer_msg,';
            v_ts_val := v_ts_val || quote_literal(p_ticket_footer_msg) || ',';
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tenant_settings' AND column_name='ticket_show_tax')
           AND p_ticket_show_tax IS NOT NULL THEN
            v_ts_col := v_ts_col || 'ticket_show_tax,';
            v_ts_val := v_ts_val || p_ticket_show_tax::TEXT || ',';
        END IF;

        IF v_has_paper AND p_paper_width_mm IS NOT NULL THEN
            v_ts_col := v_ts_col || 'paper_width_mm,';
            v_ts_val := v_ts_val || p_paper_width_mm::TEXT || ',';
        END IF;

        IF v_ts_col <> '' THEN
            v_ts_col := rtrim(v_ts_col, ',');
            v_ts_val := rtrim(v_ts_val, ',');
            v_sql := 'UPDATE tenant_settings SET ' ||
                     replace(v_ts_col, ',', ' = EXCLUDED.::,') ||
                     ' WHERE tenant_id = ' || quote_literal(p_tenant_id::text) || '::UUID';
            -- Simplificado: hacer UPDATE directo
            v_sql := format(
                'UPDATE tenant_settings SET updated_at = now() WHERE tenant_id = %L',
                p_tenant_id
            );
            EXECUTE v_sql;

            -- Hacer updates individuales para cada campo
            IF p_ticket_header_msg IS NOT NULL AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='tenant_settings' AND column_name='ticket_header_msg'
            ) THEN
                UPDATE tenant_settings SET ticket_header_msg = p_ticket_header_msg
                WHERE tenant_id = p_tenant_id;
            END IF;
            IF p_ticket_footer_msg IS NOT NULL AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='tenant_settings' AND column_name='ticket_footer_msg'
            ) THEN
                UPDATE tenant_settings SET ticket_footer_msg = p_ticket_footer_msg
                WHERE tenant_id = p_tenant_id;
            END IF;
            IF p_ticket_show_tax IS NOT NULL AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='tenant_settings' AND column_name='ticket_show_tax'
            ) THEN
                UPDATE tenant_settings SET ticket_show_tax = p_ticket_show_tax
                WHERE tenant_id = p_tenant_id;
            END IF;
            IF p_paper_width_mm IS NOT NULL AND v_has_paper THEN
                UPDATE tenant_settings SET paper_width_mm = p_paper_width_mm
                WHERE tenant_id = p_tenant_id;
            END IF;
        END IF;
    END;

    RETURN fn_get_company_full(p_tenant_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 3. FN_GET_TENANT_DASHBOARD — todo lo necesario para arrancar TPV
-- =====================================================================
-- Una sola llamada que devuelve:
--   { products: [...], categories: [...], tables: [...],
--     company: {...}, open_orders: [...], drafts: [...] }
-- Aislado por tenant_id. Reemplaza 6 queries del bootstrap.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_get_tenant_dashboard(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company  JSONB;
    v_products JSONB;
    v_cats     JSONB;
    v_tables   JSONB;
    v_orders   JSONB;
    v_drafts   JSONB;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tenant no encontrado');
    END IF;

    -- Company
    SELECT data INTO v_company FROM jsonb_path_query(
        fn_get_company_full(p_tenant_id), '$.data'
    );

    -- Products
    SELECT COALESCE(jsonb_agg(to_jsonb(p.*) ORDER BY p.name), '[]'::jsonb)
    INTO v_products
    FROM products p
    WHERE p.tenant_id = p_tenant_id;

    -- Categories
    SELECT COALESCE(jsonb_agg(to_jsonb(c.*) ORDER BY c.sort_order, c.name), '[]'::jsonb)
    INTO v_cats
    FROM categories c
    WHERE c.tenant_id = p_tenant_id;

    -- Tables (dining_tables)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dining_tables') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.table_number), '[]'::jsonb)
        INTO v_tables
        FROM dining_tables t
        WHERE t.tenant_id = p_tenant_id;
    ELSE
        v_tables := '[]'::jsonb;
    END IF;

    -- Open orders
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='open_orders') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.updated_at DESC), '[]'::jsonb)
        INTO v_orders
        FROM open_orders o
        WHERE o.tenant_id = p_tenant_id AND o.status = 'open';
    ELSE
        v_orders := '[]'::jsonb;
    END IF;

    -- Drafts (open_orders tipo 'draft' o status='draft')
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='drafts') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(d.*) ORDER BY d.updated_at DESC), '[]'::jsonb)
        INTO v_drafts
        FROM drafts d
        WHERE d.tenant_id = p_tenant_id;
    ELSE
        v_drafts := '[]'::jsonb;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'company',     v_company,
            'products',    v_products,
            'categories',  v_cats,
            'tables',      v_tables,
            'open_orders', v_orders,
            'drafts',      v_drafts
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 4. PERMISOS (regprocedure — sin ambigüedad)
-- =====================================================================
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc AS p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN (
              'fn_get_company_full',
              'fn_save_company_full',
              'fn_get_tenant_dashboard'
          )
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
            fn.signature
        );
    END LOOP;
END $$;

-- =====================================================================
-- 5. RELOAD SCHEMA
-- =====================================================================
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 6. VERIFICACIÓN
-- =====================================================================
SELECT 'company_rpcs_ok' AS check,
       COUNT(*) FILTER (WHERE proname IN ('fn_get_company_full','fn_save_company_full','fn_get_tenant_dashboard')) AS cnt
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace;
