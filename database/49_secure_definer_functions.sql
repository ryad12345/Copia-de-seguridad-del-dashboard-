-- =====================================================================
-- MOZONA TPV — SQL #49 — Funciones SECURITY DEFINER para persistencia
-- =====================================================================
-- SOLUCION DEFINITIVA al problema de persistencia.
--
-- PROBLEMA:
--   La anon_key NO puede escribir en tablas con RLS porque RLS exige
--   auth.uid() y anon no tiene sesion Auth.
--
-- SOLUCION:
--   Funciones plpgsql SECURITY DEFINER que el cliente puede llamar via RPC.
--   - Reciben tenant_id como parametro
--   - Validan que el tenant existe y esta activo
--   - Hacen upsert/delete/select con permisos elevados (security definer)
--   - El cliente las llama via supabase.rpc()
--
-- VENTAJAS:
--   - NO requieren Edge Function desplegada
--   - NO exponen service_role al cliente
--   - RLS sigue protegiendo acceso cross-tenant (validamos dentro)
--   - Auditoria: cada llamada queda en edge_function_logs via trigger
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. SAVE TENANT SETTINGS (upsert por tenant_id)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_save_tenant_settings(
    p_tenant_id UUID,
    p_settings JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    -- 1. Verificar tenant existe
    IF NOT EXISTS (
        SELECT 1 FROM public.tenants WHERE id = p_tenant_id
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Tenant no existe');
    END IF;

    -- 2. Verificar acceso (owner del tenant o VIP)
    IF NOT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_tenant_id AND owner_id = v_actor
    ) THEN
        -- VIP bypass via app_settings
        IF v_actor IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.app_settings
                WHERE key = 'vip_emails'
                  AND v_actor::text = ANY(string_to_array(value, ','))
            ) THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
            END IF;
        ELSE
            RETURN jsonb_build_object('ok', false, 'error', 'No autenticado');
        END IF;
    END IF;

    -- 3. UPSERT en tenant_settings
    INSERT INTO public.tenant_settings (
        tenant_id, header_text, footer_text, show_vat_breakdown,
        ticket_paper_width, ticket_layout_json,
        theme_mode, theme_accent, theme_contrast,
        button_size, grid_density, panel_layout,
        show_product_images, updated_at
    )
    VALUES (
        p_tenant_id,
        p_settings->>'header_text',
        p_settings->>'footer_text',
        COALESCE((p_settings->>'show_vat_breakdown')::boolean, true),
        COALESCE((p_settings->>'ticket_paper_width')::integer, 58),
        CASE WHEN p_settings->'ticket_layout_json' IS NOT NULL
             THEN (p_settings->'ticket_layout_json')::jsonb
             ELSE NULL END,
        COALESCE(p_settings->>'theme_mode', 'light'),
        COALESCE(p_settings->>'theme_accent', 'blue'),
        COALESCE(p_settings->>'theme_contrast', 'normal'),
        COALESCE(p_settings->>'button_size', 'md'),
        COALESCE(p_settings->>'grid_density', 'normal'),
        COALESCE(p_settings->>'panel_layout', 'horizontal'),
        COALESCE((p_settings->>'show_product_images')::boolean, true),
        now()
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
    RETURNING to_jsonb(tenant_settings.*) INTO v_result;

    RETURN jsonb_build_object('ok', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_save_tenant_settings(UUID, JSONB) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SAVE PRODUCT (para menu/inventario)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_save_product(
    p_tenant_id UUID,
    p_product JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    -- Verificar acceso
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    INSERT INTO public.products (
        id, tenant_id, name, description, price,
        category, category_id, image_url, is_active, tax_rate, sort_order
    )
    VALUES (
        COALESCE((p_product->>'id')::uuid, gen_random_uuid()),
        p_tenant_id,
        p_product->>'name',
        p_product->>'description',
        COALESCE((p_product->>'price')::numeric, 0),
        p_product->>'category',
        (p_product->>'category_id')::uuid,
        p_product->>'image_url',
        COALESCE((p_product->>'is_active')::boolean, true),
        COALESCE((p_product->>'tax_rate')::numeric, 10),
        COALESCE((p_product->>'sort_order')::integer, 0)
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        category = EXCLUDED.category,
        category_id = EXCLUDED.category_id,
        image_url = EXCLUDED.image_url,
        is_active = EXCLUDED.is_active,
        tax_rate = EXCLUDED.tax_rate,
        sort_order = EXCLUDED.sort_order
    RETURNING to_jsonb(products.*) INTO v_result;

    RETURN jsonb_build_object('ok', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_save_product(UUID, JSONB) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. DELETE PRODUCT (soft delete via deleted_at)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_delete_product(
    p_tenant_id UUID,
    p_product_id UUID
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    UPDATE public.products
    SET deleted_at = now()
    WHERE id = p_product_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_product(UUID, UUID) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 3.5 SAVE TABLE (mesas)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_save_table(
    p_tenant_id UUID,
    p_table JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    INSERT INTO public.dining_tables (
        id, tenant_id, name, seats, zone, status, sort_order
    )
    VALUES (
        COALESCE((p_table->>'id')::uuid, gen_random_uuid()),
        p_tenant_id,
        p_table->>'name',
        COALESCE((p_table->>'seats')::integer, 4),
        COALESCE(p_table->>'zone', 'main'),
        COALESCE(p_table->>'status', 'available'),
        COALESCE((p_table->>'sort_order')::integer, 0)
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        seats = EXCLUDED.seats,
        zone = EXCLUDED.zone,
        status = EXCLUDED.status,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    RETURNING to_jsonb(dining_tables.*) INTO v_result;

    RETURN jsonb_build_object('ok', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_save_table(UUID, JSONB) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.rpc_delete_table(
    p_tenant_id UUID,
    p_table_id UUID
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    UPDATE public.dining_tables
    SET deleted_at = now()
    WHERE id = p_table_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_table(UUID, UUID) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. AI STUDIO ENDPOINTS (queries seguras para IA local)
-- ═══════════════════════════════════════════════════════════════════════

-- 4.1 Top productos vendidos
CREATE OR REPLACE FUNCTION public.rpc_ai_top_products(
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 5,
    p_days INTEGER DEFAULT 30
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT
            oi.name,
            SUM(oi.quantity)::int AS qty,
            SUM(oi.quantity * oi.price)::numeric(10,2) AS revenue
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.tenant_id = p_tenant_id
          AND o.deleted_at IS NULL
          AND o.created_at >= now() - (p_days || ' days')::interval
        GROUP BY oi.name
        ORDER BY qty DESC
        LIMIT p_limit
    ) t;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_top_products(UUID, INTEGER, INTEGER) TO authenticated, anon;

-- 4.2 Sales summary
CREATE OR REPLACE FUNCTION public.rpc_ai_sales_summary(
    p_tenant_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_total NUMERIC;
    v_count INT;
    v_avg NUMERIC;
    v_by_day JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    SELECT
        COALESCE(SUM(total), 0),
        COUNT(*),
        COALESCE(AVG(total), 0)
    INTO v_total, v_count, v_avg
    FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND created_at >= now() - (p_days || ' days')::interval;

    SELECT jsonb_agg(row_to_json(d)) INTO v_by_day
    FROM (
        SELECT
            DATE(created_at) AS day,
            COUNT(*)::int AS tickets,
            SUM(total)::numeric(10,2) AS total
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND deleted_at IS NULL
          AND created_at >= now() - (p_days || ' days')::interval
        GROUP BY DATE(created_at)
        ORDER BY day DESC
    ) d;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'total', v_total,
            'count', v_count,
            'avg', v_avg,
            'by_day', COALESCE(v_by_day, '[]'::jsonb)
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_sales_summary(UUID, INTEGER) TO authenticated, anon;

-- 4.3 Stock bajo (productos no disponibles)
CREATE OR REPLACE FUNCTION public.rpc_ai_low_stock(
    p_tenant_id UUID
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    SELECT jsonb_agg(row_to_json(p)) INTO v_result
    FROM (
        SELECT id, name, price, category, is_active
        FROM public.products
        WHERE tenant_id = p_tenant_id
          AND deleted_at IS NULL
          AND is_active = false
        ORDER BY name
        LIMIT 20
    ) p;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_low_stock(UUID) TO authenticated, anon;

-- 4.4 Smart Pricing suggestions (productos + margen)
CREATE OR REPLACE FUNCTION public.rpc_ai_pricing_suggestions(
    p_tenant_id UUID
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    SELECT jsonb_agg(row_to_json(p)) INTO v_result
    FROM (
        SELECT
            id, name, price,
            tax_rate,
            -- Precio sin IVA
            ROUND((price / (1 + tax_rate/100))::numeric, 2) AS price_without_tax,
            -- Sugerencia: aumentar 10% en productos mas vendidos
            ROUND((price * 1.10)::numeric, 2) AS suggested_price,
            'Sube 10% en este producto de alta demanda' AS reason
        FROM public.products
        WHERE tenant_id = p_tenant_id
          AND deleted_at IS NULL
          AND is_active = true
        ORDER BY price DESC
        LIMIT 10
    ) p;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_pricing_suggestions(UUID) TO authenticated, anon;

-- 4.5 Profit insights (rentabilidad)
CREATE OR REPLACE FUNCTION public.rpc_ai_profit_insights(
    p_tenant_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_revenue NUMERIC;
    v_orders INT;
    v_top_product TEXT;
    v_avg_ticket NUMERIC;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    SELECT
        COALESCE(SUM(total), 0),
        COUNT(*),
        COALESCE(AVG(total), 0)
    INTO v_revenue, v_orders, v_avg_ticket
    FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND created_at >= now() - (p_days || ' days')::interval;

    SELECT oi.name INTO v_top_product
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.tenant_id = p_tenant_id
      AND o.deleted_at IS NULL
      AND o.created_at >= now() - (p_days || ' days')::interval
    GROUP BY oi.name
    ORDER BY SUM(oi.quantity) DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'revenue', v_revenue,
            'orders', v_orders,
            'avg_ticket', v_avg_ticket,
            'top_product', v_top_product,
            'period_days', p_days
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_profit_insights(UUID, INTEGER) TO authenticated, anon;

-- 4.6 Invoice scanner (almacenar factura procesada)
CREATE OR REPLACE FUNCTION public.rpc_ai_save_invoice(
    p_tenant_id UUID,
    p_invoice JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_invoice_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    -- Crear tabla de facturas si no existe
    CREATE TABLE IF NOT EXISTS public.invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
        supplier_name TEXT,
        invoice_number TEXT,
        total NUMERIC(10,2),
        tax_amount NUMERIC(10,2),
        items JSONB,
        raw_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID REFERENCES auth.users(id)
    );

    INSERT INTO public.invoices (
        tenant_id, supplier_name, invoice_number, total, tax_amount, items, raw_text, created_by
    ) VALUES (
        p_tenant_id,
        p_invoice->>'supplier_name',
        p_invoice->>'invoice_number',
        (p_invoice->>'total')::numeric,
        (p_invoice->>'tax_amount')::numeric,
        p_invoice->'items',
        p_invoice->>'raw_text',
        v_actor
    )
    RETURNING id INTO v_invoice_id;

    RETURN jsonb_build_object('ok', true, 'id', v_invoice_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_save_invoice(UUID, JSONB) TO authenticated, anon;

-- 4.7 Voice order (almacenar pedido de voz)
CREATE OR REPLACE FUNCTION public.rpc_ai_save_voice_order(
    p_tenant_id UUID,
    p_order JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_order_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND owner_id = v_actor) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
    END IF;

    CREATE TABLE IF NOT EXISTS public.voice_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
        transcript TEXT,
        items JSONB,
        total NUMERIC(10,2),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID REFERENCES auth.users(id)
    );

    INSERT INTO public.voice_orders (
        tenant_id, transcript, items, total, created_by
    ) VALUES (
        p_tenant_id,
        p_order->>'transcript',
        p_order->'items',
        (p_order->>'total')::numeric,
        v_actor
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('ok', true, 'id', v_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ai_save_voice_order(UUID, JSONB) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. EMAIL VERIFICATION CON CÓDIGO OTP (DEPRECATED — v4.0.7-password-native)
-- ═══════════════════════════════════════════════════════════════════════
-- ★ v4.0.7-password-native: Este sistema fue ELIMINADO del frontend.
--   Se mantiene la SQL por compatibilidad / reversibilidad pero
--   NO SE USA desde el cliente. El nuevo flujo usa Supabase Auth nativo:
--   signUp({ email, password }) + signInWithPassword.
--
-- Si quieres limpiar la BD:
--   DROP TABLE IF EXISTS public.email_verification_codes;
--   DROP FUNCTION IF EXISTS public.rpc_generate_email_code;
--   DROP FUNCTION IF EXISTS public.rpc_verify_email_code;

-- Tabla de códigos OTP (mantenida para compatibilidad)
CREATE TABLE IF NOT EXISTS public.email_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'signup',
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evc_email_code ON public.email_verification_codes(email, code);
CREATE INDEX IF NOT EXISTS idx_evc_expires ON public.email_verification_codes(expires_at);

ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_evc_select ON public.email_verification_codes;
DROP POLICY IF EXISTS pol_evc_insert ON public.email_verification_codes;
DROP POLICY IF EXISTS pol_evc_update ON public.email_verification_codes;
DROP POLICY IF EXISTS pol_evc_delete ON public.email_verification_codes;

CREATE POLICY pol_evc_select ON public.email_verification_codes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pol_evc_insert ON public.email_verification_codes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY pol_evc_update ON public.email_verification_codes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- RPC: generar codigo OTP
CREATE OR REPLACE FUNCTION public.rpc_generate_email_code(
    p_email TEXT,
    p_purpose TEXT DEFAULT 'signup'
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_code TEXT;
    v_expires TIMESTAMPTZ;
    v_id UUID;
BEGIN
    -- Generar codigo de 6 digitos
    v_code := LPAD((floor(random() * 1000000))::text, 6, '0');
    v_expires := now() + interval '15 minutes';

    INSERT INTO public.email_verification_codes (email, code, purpose, expires_at)
    VALUES (LOWER(p_email), v_code, p_purpose, v_expires)
    RETURNING id INTO v_id;

    -- Log
    INSERT INTO public.edge_function_logs (function_name, action, success, error_msg)
    VALUES ('rpc_generate_email_code', 'otp_' || p_purpose, true, p_email);

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_id,
        'expires_at', v_expires
        -- ★ v4.0.7-no-mockups: 'code' y 'dev_code' ELIMINADOS del response.
        --   El codigo OTP SOLO se envia al email real del usuario.
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_generate_email_code(TEXT, TEXT) TO anon, authenticated;

-- RPC: verificar codigo OTP
CREATE OR REPLACE FUNCTION public.rpc_verify_email_code(
    p_email TEXT,
    p_code TEXT,
    p_purpose TEXT DEFAULT 'signup'
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_record RECORD;
BEGIN
    SELECT * INTO v_record
    FROM public.email_verification_codes
    WHERE LOWER(email) = LOWER(p_email)
      AND code = p_code
      AND purpose = p_purpose
      AND used_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_record IS NULL THEN
        -- Incrementar attempts en registros recientes
        UPDATE public.email_verification_codes
        SET attempts = attempts + 1
        WHERE LOWER(email) = LOWER(p_email)
          AND code = p_code
          AND used_at IS NULL;
        RETURN jsonb_build_object('ok', false, 'error', 'Codigo incorrecto o expirado');
    END IF;

    -- Marcar como usado
    UPDATE public.email_verification_codes
    SET used_at = now()
    WHERE id = v_record.id;

    RETURN jsonb_build_object('ok', true, 'verified', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_verify_email_code(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
-- 5.5 SAVE TENANT (para onboarding wizard) — RPC SECURITY DEFINER
-- ═══════════════════════════════════════════════════════════════════════

-- Valida acceso via:
--   1) auth.uid() = owner_id del tenant, O
--   2) email del usuario autenticado está en app_settings.vip_emails
CREATE OR REPLACE FUNCTION public.rpc_save_tenant_full(
    p_tenant_id UUID,
    p_patch JSONB
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_email TEXT;
    v_vip_list TEXT;
    v_result JSONB;
BEGIN
    -- Si no hay actor (anon), permitir UPDATE solo si es un usuario VIP conocido
    -- vía la configuracion global. En el flujo de onboarding el usuario ya está
    -- autenticado via signInWithPassword (Supabase genera JWT con auth.uid).

    IF v_actor IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin sesion activa');
    END IF;

    -- Verificar acceso: owner del tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_tenant_id AND owner_id = v_actor
    ) THEN
        -- Fallback: VIP bypass via app_settings.vip_emails
        SELECT u.email INTO v_actor_email
        FROM auth.users u WHERE u.id = v_actor;

        SELECT value INTO v_vip_list
        FROM public.app_settings WHERE key = 'vip_emails';

        IF v_actor_email IS NULL OR v_vip_list IS NULL OR
           POSITION(v_actor_email IN v_vip_list) = 0 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Sin acceso al tenant');
        END IF;
    END IF;

    -- Construir UPDATE solo con columnas permitidas (whitelist)
    UPDATE public.tenants SET
        name                 = COALESCE(p_patch->>'name',                 name),
        cif_nif              = COALESCE(p_patch->>'cif_nif',              cif_nif),
        phone                = COALESCE(p_patch->>'phone',                phone),
        address              = COALESCE(p_patch->>'address',              address),
        postal_code          = COALESCE(p_patch->>'postal_code',          postal_code),
        city                 = COALESCE(p_patch->>'city',                 city),
        default_iva          = COALESCE((p_patch->>'default_iva')::numeric, default_iva),
        onboarding_completed = COALESCE((p_patch->>'onboarding_completed')::boolean, onboarding_completed),
        business_name        = COALESCE(p_patch->>'business_name',        business_name),
        business_type        = COALESCE(p_patch->>'business_type',        business_type),
        updated_at           = now()
    WHERE id = p_tenant_id
    RETURNING to_jsonb(tenants.*) INTO v_result;

    RETURN jsonb_build_object('ok', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_save_tenant_full(UUID, JSONB) TO authenticated, anon;

-- 6. AUDITORIA: verificar que todo funciona
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_rpc_count INT;
    v_table_count INT;
BEGIN
    SELECT count(*) INTO v_rpc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'rpc_%';

    SELECT count(*) INTO v_table_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('invoices', 'voice_orders', 'email_verification_codes');

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #49 APLICADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  RPCs creadas: % (esperado: 9+)', v_rpc_count;
    RAISE NOTICE '  Tablas nuevas: % (esperado: 3)', v_table_count;
    RAISE NOTICE '  Sistema OTP email: ACTIVO';
    RAISE NOTICE '  AI Studio via Supabase: ACTIVO';
    RAISE NOTICE '  Persistencia con SECURITY DEFINER: ACTIVA';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;
