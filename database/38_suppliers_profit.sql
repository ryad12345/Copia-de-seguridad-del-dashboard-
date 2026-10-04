-- =====================================================================
-- MOZONA TPV — database/38_suppliers_profit.sql (v3.5.0)
-- =====================================================================
-- Módulos revolucionarios:
--   - 🌌 Barista Fantasma: proveedores + auto-pedidos
--   - 👥 Socio Oculto: rentabilidades + insights IA
--   - 📈 Tracking de márgenes y sugerencias de precio
-- RLS estricto con has_tenant_access()
-- =====================================================================

-- ★ PROVEEDORES
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,              -- WhatsApp E.164
    email TEXT,
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active
    ON public.suppliers(tenant_id, is_active);

-- ★ PRODUCTO ↔ PROVEEDOR (precios dinámicos, lead time, etc.)
CREATE TABLE IF NOT EXISTS public.product_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    supplier_sku TEXT,
    cost_price NUMERIC(10, 2) NOT NULL,
    pack_size INT DEFAULT 1,         -- cuántos productos vienen por pack
    lead_time_days INT DEFAULT 1,
    is_preferred BOOLEAN DEFAULT FALSE,
    last_price_change_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product
    ON public.product_suppliers(tenant_id, product_id);

-- ★ AUTO-ORDERS (borradores generados por "Barista Fantasma")
CREATE TABLE IF NOT EXISTS public.supplier_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sent' | 'confirmed' | 'delivered' | 'cancelled'
    lines JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{product_id, qty, unit_cost, line_total}]
    subtotal NUMERIC(12, 2),
    notes TEXT,
    whatsapp_url TEXT,
    sent_at TIMESTAMPTZ,
    sent_by UUID,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_status
    ON public.supplier_orders(tenant_id, status, created_at DESC);

-- ★ MARGEN TRACKING (histórico de cambios de precio)
CREATE TABLE IF NOT EXISTS public.product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    old_sale_price NUMERIC(10, 2),
    new_sale_price NUMERIC(10, 2),
    old_cost_price NUMERIC(10, 2),
    new_cost_price NUMERIC(10, 2),
    source TEXT,  -- 'manual' | 'ai_suggestion' | 'supplier_update'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_price_history_product
    ON public.product_price_history(tenant_id, product_id, created_at DESC);

-- ★ AÑADIR COLUMNAS A PRODUCTS PARA MARGEN
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS target_margin_pct NUMERIC(5, 2) DEFAULT 65;

-- ═══════════════════════════════════════════════════════════════
-- RLS con has_tenant_access()
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_all" ON public.suppliers;
CREATE POLICY "suppliers_select_own" ON public.suppliers FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "suppliers_modify_own" ON public.suppliers FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

DROP POLICY IF EXISTS "product_suppliers_all" ON public.product_suppliers;
CREATE POLICY "product_suppliers_select_own" ON public.product_suppliers FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "product_suppliers_modify_own" ON public.product_suppliers FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

DROP POLICY IF EXISTS "supplier_orders_all" ON public.supplier_orders;
CREATE POLICY "supplier_orders_select_own" ON public.supplier_orders FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "supplier_orders_modify_own" ON public.supplier_orders FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

DROP POLICY IF EXISTS "product_price_history_all" ON public.product_price_history;
CREATE POLICY "product_price_history_select_own" ON public.product_price_history FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "product_price_history_modify_own" ON public.product_price_history FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

COMMENT ON TABLE public.suppliers IS 'Proveedores del tenant con WhatsApp para Barista Fantasma';
COMMENT ON TABLE public.product_suppliers IS 'Relacion producto-proveedor con coste y lead time';
COMMENT ON TABLE public.supplier_orders IS 'Borradores de pedidos generados por IA local';
COMMENT ON TABLE public.product_price_history IS 'Historico de cambios de precio para analisis de margen';
