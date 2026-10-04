-- =====================================================================
-- MOZONA TPV — Añadir columna paper_width_mm a ticket_settings (v4.0.7)
-- =====================================================================
-- SOLUCION: ALTER TABLE para añadir la columna si no existe.
--   DEFAULT 80mm (térmica estándar)
--   NO requiere NOT NULL para no romper registros existentes
-- =====================================================================

ALTER TABLE public.ticket_settings
    ADD COLUMN IF NOT EXISTS paper_width_mm INTEGER DEFAULT 80;

COMMENT ON COLUMN public.ticket_settings.paper_width_mm IS
    'Ancho del papel de la impresora térmica en mm (58 o 80). Default: 80';

DO $$
BEGIN
    RAISE NOTICE '✓ Columna paper_width_mm añadida a ticket_settings (default 80mm)';
END $$;
