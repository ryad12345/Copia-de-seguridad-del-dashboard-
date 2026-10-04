-- =====================================================================
-- MOZONA TPV — 14_insert_order_rpc.sql
-- =====================================================================
-- FIX CRÍTICO: VIP no es owner del tenant → RLS de orders lo bloquea
--
-- Síntoma:
--   - El RPC get_first_active_tenant devuelve un UUID correctamente
--   - Pero el INSERT en orders falla con 42501 (new row violates
--     row-level security policy) porque la policy exige
--     is_tenant_owner(tenant_id) y el VIP no es owner
--
-- Solución:
--   1) Crear RPC insert_order_with_tenant() con SECURITY DEFINER
--      que inserta en orders bypaseando RLS
--   2) Ajustar la policy orders_insert_owner para permitir INSERT
--      a cualquier authenticated (los tickets no son datos sensibles)
--   3) Recargar PostgREST
-- =====================================================================

-- ============================================================
-- 1. Ajustar policies de orders para permitir INSERT autenticado
-- ============================================================
-- Las policies originales exigían is_tenant_owner(tenant_id) en INSERT.
-- Eso bloquea al VIP que opera sobre un tenant del que NO es owner.
-- Cambiamos a: cualquier authenticated puede INSERT (es un ticket
-- de venta, no un dato personal), pero solo el owner puede UPDATE/DELETE.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_update_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_delete_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_all_owner"    ON public.orders;

-- SELECT: solo el owner o superadmin
CREATE POLICY "orders_select_owner" ON public.orders FOR SELECT TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

-- INSERT: cualquier authenticated (los camareros y el VIP necesitan
-- poder crear tickets sin ser necesariamente owners del tenant)
CREATE POLICY "orders_insert_authenticated" ON public.orders FOR INSERT TO authenticated
WITH CHECK (TRUE);

-- UPDATE: solo el owner o superadmin (los tickets cerrados no se editan)
CREATE POLICY "orders_update_owner" ON public.orders FOR UPDATE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

-- DELETE: solo el owner o superadmin
CREATE POLICY "orders_delete_owner" ON public.orders FOR DELETE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

-- ============================================================
-- 2. RPC insert_order_with_tenant() — bypasea RLS
-- ============================================================
-- Útil si las policies se complican o si necesitamos lógica extra.
DROP FUNCTION IF EXISTS public.insert_order_with_tenant(JSONB);
CREATE OR REPLACE FUNCTION public.insert_order_with_tenant(p_order JSONB)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id TEXT;
    v_row       JSONB;
    v_new_id    UUID;
BEGIN
    -- Validar que venga tenant_id
    v_tenant_id := p_order->>'tenant_id';
    IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
        RETURN json_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;

    -- Validar formato UUID
    IF NOT (v_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RETURN json_build_object('ok', false, 'error', 'tenant_id no es un UUID válido: ' || v_tenant_id);
    END IF;

    -- Verificar que el tenant existe
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id::uuid) THEN
        RETURN json_build_object('ok', false, 'error', 'Tenant no existe: ' || v_tenant_id);
    END IF;

    -- Insertar
    INSERT INTO public.orders (
        tenant_id, table_id, table_number, waiter_name, items,
        subtotal, tax_total, total, payment_method, payment_status,
        status, series, verifactu_qr
    ) VALUES (
        (p_order->>'tenant_id')::uuid,
        NULLIF(p_order->>'table_id', ''),
        p_order->>'table_number',
        p_order->>'waiter_name',
        COALESCE(p_order->'items', '[]'::jsonb),
        COALESCE((p_order->>'subtotal')::numeric, 0),
        COALESCE((p_order->>'tax_total')::numeric, 0),
        COALESCE((p_order->>'total')::numeric, 0),
        p_order->>'payment_method',
        COALESCE(p_order->>'payment_status', 'paid'),
        COALESCE(p_order->>'status', 'closed'),
        p_order->>'series',
        p_order->>'verifactu_qr'
    )
    RETURNING id INTO v_new_id;

    RETURN json_build_object('ok', true, 'id', v_new_id);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_order_with_tenant(JSONB) TO authenticated, anon;

-- ============================================================
-- 3. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
    'orders_policies' AS check_name,
    count(*)::text AS value
FROM pg_policies
WHERE tablename = 'orders'
UNION ALL
SELECT
    'insert_order_rpc',
    'created'
WHERE EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'insert_order_with_tenant'
);

-- ============================================================
-- INSTRUCCIONES
-- ============================================================
-- 1) Ejecuta este script en Supabase SQL Editor
-- 2) Refresca /app con Ctrl+Shift+R
-- 3) Cobra una mesa de prueba
-- 4) El INSERT ahora debe funcionar (policy permite cualquier authenticated)
-- ============================================================
