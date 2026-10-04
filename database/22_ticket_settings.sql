-- =====================================================================
-- MOZONA TPV — 22_ticket_settings.sql
-- =====================================================================
-- Tabla: configuración del ticket por tenant
-- PK: tenant_id (1 fila por restaurante)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ticket_settings (
    tenant_id            UUID        PRIMARY KEY,
    header_text          TEXT        NULL,
    footer_text          TEXT        NULL DEFAULT '¡Gracias por su visita!',
    show_vat_breakdown   BOOLEAN     NOT NULL DEFAULT TRUE,
    paper_width_mm       INTEGER     NOT NULL DEFAULT 80,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ticket_settings_tenant
    ON public.ticket_settings(tenant_id);

-- RLS permisivo (lectura/escritura) — coherente con el resto del sistema
ALTER TABLE public.ticket_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_settings_select_all" ON public.ticket_settings;
DROP POLICY IF EXISTS "ticket_settings_all_auth"   ON public.ticket_settings;

CREATE POLICY "ticket_settings_select_all"
    ON public.ticket_settings
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "ticket_settings_all_auth"
    ON public.ticket_settings
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT
    tablename,
    rowsecurity AS rls_habilitado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename  = 'ticket_settings';
