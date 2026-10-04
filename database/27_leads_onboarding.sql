-- =====================================================================
-- MOZONA TPV — 27_leads_onboarding.sql
-- =====================================================================
-- Tabla para guardar leads e interacciones del AI Assistant.
-- Diseño compatible con futura migración a Firebase (mismo schema).
--
-- ★ EJECUTAR EN PRODUCCIÓN (aditivo, idempotente)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leads_onboarding (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email      TEXT         NULL,
    user_id         UUID         NULL,    -- auth.users.id si está logueado
    restaurant_name TEXT         NULL,
    selected_plan   TEXT         NULL,    -- 'basic' | 'professional' | 'premium' | 'trial'
    trial_ends_at   TIMESTAMPTZ  NULL,
    status          TEXT         NOT NULL DEFAULT 'lead_nuevo'
                    CHECK (status IN (
                        'lead_nuevo', 'trial_activo',
                        'pendiente_pago', 'pago_completado',
                        'descartado'
                    )),
    chat_history    JSONB        NOT NULL DEFAULT '[]'::jsonb,
    source          TEXT         NULL,    -- 'paywall' | 'landing' | 'onboarding' | 'pricing'
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Índices para queries típicas
CREATE INDEX IF NOT EXISTS idx_leads_status
    ON public.leads_onboarding(status);
CREATE INDEX IF NOT EXISTS idx_leads_created
    ON public.leads_onboarding(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email
    ON public.leads_onboarding(user_email) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_plan
    ON public.leads_onboarding(selected_plan) WHERE selected_plan IS NOT NULL;

-- Trigger: updated_at automático
CREATE OR REPLACE FUNCTION public.leads_onboarding_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads_onboarding;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON public.leads_onboarding
    FOR EACH ROW
    EXECUTE FUNCTION public.leads_onboarding_set_updated_at();

-- RLS: solo superadmin lee, anon puede INSERT (formulario de captura)
ALTER TABLE public.leads_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_insert_anon" ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_select_admin" ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_update_admin" ON public.leads_onboarding;

-- Cualquiera (incluso anon) puede crear un lead (formulario público)
CREATE POLICY "leads_insert_anon"
    ON public.leads_onboarding
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Solo el superadmin puede leer/actualizar leads
CREATE POLICY "leads_select_admin"
    ON public.leads_onboarding
    FOR SELECT
    TO authenticated
    USING (public.current_user_is_superadmin());

CREATE POLICY "leads_update_admin"
    ON public.leads_onboarding
    FOR UPDATE
    TO authenticated
    USING (public.current_user_is_superadmin());

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'leads_onboarding'
ORDER BY ordinal_position;
