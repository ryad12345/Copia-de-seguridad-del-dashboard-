-- =====================================================================
-- MOZONA TPV — 12_open_orders.sql  (PERSISTENCIA DE COMANDAS ABIERTAS)
-- =====================================================================
-- Ejecutar en Supabase SQL Editor después de 11_fix_waiter_rls.sql
--
-- Crea:
--   1) public.orders (si no existe) con campos para venta cerrada
--   2) public.open_orders con items JSONB para comanda activa por mesa
--   3) RPCs para upsert/clear/get de borradores
--   4) RLS por tenant
--   5) Realtime publication
-- =====================================================================

-- ============================================================
-- 1. Tabla orders (tickets cerrados / cobrados)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    table_id        UUID,
    table_number    TEXT,
    waiter_name     TEXT,
    items           JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tax_total       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total           NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_method  TEXT,                          -- 'cash' | 'card' | 'mixed' | 'verifactu'
    payment_status  TEXT NOT NULL DEFAULT 'paid',  -- 'paid' | 'pending' | 'cancelled'
    status          TEXT NOT NULL DEFAULT 'closed',-- 'open' | 'closed' | 'cancelled'
    series          TEXT,
    verifactu_qr    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
    ON public.orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status
    ON public.orders(tenant_id, status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_update_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_delete_owner" ON public.orders;
DROP POLICY IF EXISTS "orders_all_owner"    ON public.orders;

CREATE POLICY "orders_select_owner" ON public.orders FOR SELECT TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

CREATE POLICY "orders_insert_owner" ON public.orders FOR INSERT TO authenticated
WITH CHECK (is_tenant_owner(tenant_id) OR is_superadmin());

CREATE POLICY "orders_update_owner" ON public.orders FOR UPDATE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

CREATE POLICY "orders_delete_owner" ON public.orders FOR DELETE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

-- ============================================================
-- 2. Tabla open_orders (borradores de comandas activas por mesa)
-- ============================================================
-- Una fila por mesa (UNIQUE(tenant_id, table_id)). Se actualiza cada vez
-- que se añade/quita un producto. Se borra al cobrar o vaciar.

CREATE TABLE IF NOT EXISTS public.open_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    table_id        TEXT NOT NULL,           -- 'local-table-3' o UUID de Supabase
    table_number    TEXT NOT NULL,
    waiter_name     TEXT,
    items           JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'locked'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_open_orders_tenant
    ON public.open_orders(tenant_id, updated_at DESC);

ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open_orders_all_owner" ON public.open_orders;

CREATE POLICY "open_orders_all_owner" ON public.open_orders
    FOR ALL TO authenticated
    USING (is_tenant_owner(tenant_id) OR is_superadmin())
    WITH CHECK (is_tenant_owner(tenant_id) OR is_superadmin());

-- ============================================================
-- 3. Realtime
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'open_orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.open_orders;
    END IF;
END $$;

-- ============================================================
-- 4. Trigger updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_open_orders_updated_at ON public.open_orders;
CREATE TRIGGER trg_open_orders_updated_at BEFORE UPDATE ON public.open_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 5. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT 'orders'         AS tabla, count(*)::text AS filas FROM public.orders
UNION ALL SELECT 'open_orders',  count(*)::text FROM public.open_orders;

-- ============================================================
-- INSTRUCCIONES POST-INSTALACIÓN
-- ============================================================
-- 1) Refresca la app: Ctrl+Shift+R
-- 2) Ve al TPV /app → selecciona una mesa → añade productos
-- 3) Recarga con F5 → la comanda y la mesa ocupada deben volver
-- 4) Ve a Settings → nueva tab "📊 Ventas" → métricas del mes
-- ============================================================
