-- =====================================================================
-- MOZONA TPV — 23_ticket_settings_company.sql
-- =====================================================================
-- Añade columnas de empresa a public.ticket_settings para evitar
-- depender de localStorage desde el about:blank del pop-up de impresión.
-- =====================================================================

ALTER TABLE public.ticket_settings
    ADD COLUMN IF NOT EXISTS company_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS nif           TEXT NULL,
    ADD COLUMN IF NOT EXISTS address       TEXT NULL,
    ADD COLUMN IF NOT EXISTS phone         TEXT NULL;

-- Recargar PostgREST para que la nueva forma esté disponible
NOTIFY pgrst, 'reload schema';

-- Verificación: muestra la forma final de la tabla
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'ticket_settings'
ORDER BY ordinal_position;
