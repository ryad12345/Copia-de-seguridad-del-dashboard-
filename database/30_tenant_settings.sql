-- =====================================================================
-- MOZONA TPV — database/30_tenant_settings.sql
-- =====================================================================
-- Configuración personalizable por tenant:
--   - Diseño de tickets térmicos (cabecera, pie, toggles, ancho)
--   - Tema visual (claro/oscuro/hostelería)
--   - Tamaño de botones táctiles
--   - Densidad de cuadrícula de productos
--   - Disposición del panel de comandas
-- =====================================================================

-- ★ Tabla principal
CREATE TABLE IF NOT EXISTS public.tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- ★ Diseño de tickets
    ticket_paper_width INTEGER NOT NULL DEFAULT 58,  -- 58 o 80 (mm)
    ticket_header_text TEXT,
    ticket_footer_text TEXT,
    ticket_show_id BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_date BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_time BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_table BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_waiter BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_payment BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_show_vat BOOLEAN NOT NULL DEFAULT TRUE,

    -- ★ Tema visual
    theme_mode TEXT NOT NULL DEFAULT 'light',  -- 'light' | 'dark' | 'auto'
    theme_accent TEXT NOT NULL DEFAULT 'blue',  -- 'blue' | 'green' | 'orange' | 'red' | 'violet'
    theme_contrast TEXT NOT NULL DEFAULT 'normal', -- 'normal' | 'high'

    -- ★ UI / UX
    button_size TEXT NOT NULL DEFAULT 'md',  -- 'sm' | 'md' | 'lg' (touch-friendly)
    grid_density TEXT NOT NULL DEFAULT 'normal', -- 'compact' | 'normal' | 'comfortable'
    panel_layout TEXT NOT NULL DEFAULT 'horizontal', -- 'horizontal' | 'vertical'
    show_product_images BOOLEAN NOT NULL DEFAULT TRUE,

    -- ★ Metadatos
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ★ Índices
CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant_id
    ON public.tenant_settings(tenant_id);

-- ★ Trigger para updated_at
CREATE OR REPLACE FUNCTION update_tenant_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_settings_updated_at ON public.tenant_settings;
CREATE TRIGGER trg_tenant_settings_updated_at
    BEFORE UPDATE ON public.tenant_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_tenant_settings_updated_at();

-- ★ RLS: cada tenant solo puede ver/editar su propia config
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_settings_select_own ON public.tenant_settings;
CREATE POLICY tenant_settings_select_own ON public.tenant_settings
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT id FROM public.tenants WHERE owner_id = auth.uid()
        )
        OR auth.uid() IN (
            SELECT id FROM auth.users WHERE email = 'rofixinsta@gmail.com'
        )
    );

DROP POLICY IF EXISTS tenant_settings_modify_own ON public.tenant_settings;
CREATE POLICY tenant_settings_modify_own ON public.tenant_settings
    FOR ALL
    USING (
        tenant_id IN (
            SELECT id FROM public.tenants WHERE owner_id = auth.uid()
        )
        OR auth.uid() IN (
            SELECT id FROM auth.users WHERE email = 'rofixinsta@gmail.com'
        )
    );

-- ★ Comentarios
COMMENT ON TABLE public.tenant_settings IS 'Personalización por tenant: tickets, tema, UI';
COMMENT ON COLUMN public.tenant_settings.ticket_paper_width IS 'Ancho del rollo térmico en mm (58 o 80)';
COMMENT ON COLUMN public.tenant_settings.theme_mode IS 'Modo de tema: light, dark, auto';
COMMENT ON COLUMN public.tenant_settings.theme_accent IS 'Color de acento: blue, green, orange, red, violet';
COMMENT ON COLUMN public.tenant_settings.button_size IS 'Tamaño de botones táctiles: sm, md, lg';
COMMENT ON COLUMN public.tenant_settings.grid_density IS 'Densidad de cuadrícula: compact, normal, comfortable';
COMMENT ON COLUMN public.tenant_settings.panel_layout IS 'Disposición del panel: horizontal, vertical';
