-- =====================================================================
-- MOZONA TPV — database/32_onboarding_columns.sql (v3.4.8)
-- =====================================================================
-- Añade las columnas que usa el OnboardingWizard y que faltan en
-- el schema cache de PostgREST.
-- =====================================================================

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS default_iva NUMERIC(5, 2) DEFAULT 10,
    ADD COLUMN IF NOT EXISTS cif_nif    TEXT,
    ADD COLUMN IF NOT EXISTS phone      TEXT,
    ADD COLUMN IF NOT EXISTS address    TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT,
    ADD COLUMN IF NOT EXISTS city       TEXT;

COMMENT ON COLUMN public.tenants.default_iva IS 'IVA por defecto para los productos del tenant (%)';
COMMENT ON COLUMN public.tenants.cif_nif IS 'CIF/NIF del tenant para facturación';
COMMENT ON COLUMN public.tenants.postal_code IS 'Código postal de la dirección';
COMMENT ON COLUMN public.tenants.city IS 'Ciudad de la dirección';
