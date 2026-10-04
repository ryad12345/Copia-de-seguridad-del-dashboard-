-- =====================================================================
-- MOZONA TPV — database/37_ai_local_tables.sql (v3.5.0)
-- =====================================================================
-- Tablas para el módulo de IA 100% LOCAL:
--   - ai_logs: auditoría de cada llamada a Ollama/Whisper
--   - ai_alerts: alertas predictivas (mermas, precios, restock)
--   - stock_movements: registro inmutable de movimientos de stock
-- RLS estricto con has_tenant_access()
-- =====================================================================

-- ★ AI LOGS (auditoría)
CREATE TABLE IF NOT EXISTS public.ai_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID,
    action TEXT NOT NULL,                -- 'scan_invoice' | 'voice_order' | 'predict_pricing'
    model TEXT,                          -- 'llama3.2-vision' | 'whisper' | 'llama3.1:8b'
    input_hash TEXT,                     -- SHA-256 del input (PII-safe)
    output_json JSONB,
    latency_ms INT,
    status TEXT DEFAULT 'ok',            -- 'ok' | 'error'
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_created
    ON public.ai_logs(tenant_id, created_at DESC);

-- ★ AI ALERTS (alertas predictivas)
CREATE TABLE IF NOT EXISTS public.ai_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,           -- 'price_drop' | 'waste_warning' | 'restock' | 'expiring'
    severity TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
    title TEXT NOT NULL,
    message TEXT,
    suggested_action JSONB,             -- { new_price, discount_pct, suggested_qty }
    dismissed BOOLEAN DEFAULT FALSE,
    dismissed_at TIMESTAMPTZ,
    dismissed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_tenant_active
    ON public.ai_alerts(tenant_id, dismissed, created_at DESC);

-- ★ STOCK MOVEMENTS (registro inmutable)
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    delta INT NOT NULL,                 -- +entrada / -salida
    source TEXT NOT NULL,               -- 'invoice_scan' | 'manual' | 'sale' | 'waste' | 'adjustment'
    reference_id UUID,
    notes TEXT,
    user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON public.stock_movements(tenant_id, product_id, created_at DESC);

-- ★ Añadir columnas útiles a products
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS current_stock INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_stock INT DEFAULT 5,
    ADD COLUMN IF NOT EXISTS last_restock_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- ═══════════════════════════════════════════════════════════════
-- RLS con has_tenant_access()
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_logs_all" ON public.ai_logs;
CREATE POLICY "ai_logs_select_own" ON public.ai_logs FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "ai_logs_modify_own" ON public.ai_logs FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

DROP POLICY IF EXISTS "ai_alerts_all" ON public.ai_alerts;
CREATE POLICY "ai_alerts_select_own" ON public.ai_alerts FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "ai_alerts_modify_own" ON public.ai_alerts FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

DROP POLICY IF EXISTS "stock_movements_all" ON public.stock_movements;
CREATE POLICY "stock_movements_select_own" ON public.stock_movements FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "stock_movements_modify_own" ON public.stock_movements FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

COMMENT ON TABLE public.ai_logs IS 'Auditoria de llamadas a Ollama/Whisper locales. 0 datos enviados a APIs externas.';
COMMENT ON TABLE public.ai_alerts IS 'Alertas predictivas (mermas, precios). Generadas por IA local.';
COMMENT ON TABLE public.stock_movements IS 'Registro inmutable de movimientos de stock.';
