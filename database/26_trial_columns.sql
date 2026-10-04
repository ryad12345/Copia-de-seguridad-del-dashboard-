-- =====================================================================
-- MOZONA TPV — 26_trial_columns.sql
-- =====================================================================
-- Añade campos de Free Trial de 7 días a la tabla tenants.
--
-- ★ EJECUTAR EN PRODUCCIÓN (es aditivo, no rompe nada)
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS → no falla si ya existe
--   - UPDATE defaults → retroactivo para tenants existentes
--
-- Campos:
--   trial_started_at  TIMESTAMPTZ  → cuándo empezó el trial
--   trial_ends_at    TIMESTAMPTZ  → cuándo caduca (trial_started + 7d)
--   subscription_status TEXT       → 'trial' | 'active' | 'expired' | 'trialing' | 'past_due' | 'canceled'
--   cancelled_at     TIMESTAMPTZ  → opcional
-- =====================================================================

-- Añadir columnas (idempotente)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_ends_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_at    TIMESTAMPTZ;

-- Índices
CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends
    ON public.tenants(trial_ends_at);

-- Retroactivo: tenants sin trial_ends_at reciben trial de 7 días desde created_at
-- (Para que ningún tenant quede sin estado de suscripción)
UPDATE public.tenants
SET
    trial_started_at = COALESCE(trial_started_at, created_at, now()),
    trial_ends_at   = COALESCE(trial_ends_at,
                                created_at + INTERVAL '7 days',
                                now() + INTERVAL '7 days'),
    subscription_status = COALESCE(subscription_status, 'trial')
WHERE trial_ends_at IS NULL;

-- Trigger: cuando se crea un tenant SIN trial_ends_at, asignar automáticamente
-- 7 días de trial (compatible con signUp, service_role, o inserciones manuales)
CREATE OR REPLACE FUNCTION public.set_default_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.trial_started_at IS NULL THEN
        NEW.trial_started_at := now();
    END IF;
    IF NEW.trial_ends_at IS NULL THEN
        NEW.trial_ends_at := NEW.trial_started_at + INTERVAL '7 days';
    END IF;
    IF NEW.subscription_status IS NULL THEN
        NEW.subscription_status := 'trial';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_trial ON public.tenants;
CREATE TRIGGER trg_set_default_trial
    BEFORE INSERT ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.set_default_trial();

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'tenants'
  AND column_name IN ('trial_started_at', 'trial_ends_at', 'subscription_status', 'cancelled_at')
ORDER BY column_name;
