-- =====================================================================
-- MOZONA TPV — 10_ticket_design.sql
-- =====================================================================
-- Añade las columnas de diseño de ticket a la tabla `tenants`:
--   - ticket_header_msg: texto libre de cabecera (ej. "¡Bienvenido!")
--   - ticket_show_tax:   boolean para mostrar/ocultar desglose de IVA
--   - ticket_footer_msg: ya existía
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
    ) THEN
        RAISE EXCEPTION 'La tabla public.tenants no existe.  Ejecuta primero 02_saas_migration.sql';
    END IF;
END $$;

-- 1) Cabecera libre (opcional)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS ticket_header_msg TEXT;

-- 2) Mostrar/ocultar desglose de IVA
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS ticket_show_tax BOOLEAN NOT NULL DEFAULT TRUE;

-- 3) Asegurar que ticket_footer_msg existe (por si la tabla se creó
--    sin esa columna en instalaciones antiguas)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS ticket_footer_msg TEXT NOT NULL DEFAULT '¡Gracias por su visita!';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFICACIÓN:
--   SELECT name, cif_nif, address, phone,
--          ticket_header_msg, ticket_footer_msg, ticket_show_tax
--   FROM public.tenants;
-- =====================================================================
