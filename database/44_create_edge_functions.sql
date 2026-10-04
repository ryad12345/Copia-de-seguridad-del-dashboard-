-- =====================================================================
-- MOZONA TPV — SQL #44 v2 (CORREGIDO) — Edge Function Logs + App Settings
-- =====================================================================
-- CORRECCIÓN v2:
--   - app_settings se crea ANTES de edge_function_logs
--   - policies referencian solo tablas existentes
--   - INSERT en edge_function_logs solo para el actor actual
--   - RLS estricto en ambas tablas
--
-- EJECUTAR EN: Supabase Dashboard > SQL Editor > New Query
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. TABLA app_settings (PRIMERO - la referencian otras policies)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_settings (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_app_settings_select ON public.app_settings;
DROP POLICY IF EXISTS pol_app_settings_modify ON public.app_settings;

-- SELECT: solo el dueño (su fila en app_settings) o superadmin
CREATE POLICY pol_app_settings_select
    ON public.app_settings FOR SELECT
    TO authenticated
    USING (
        key IN ('public_business_name', 'public_currency', 'public_locale')
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_superadmin = true
        )
    );

-- INSERT/UPDATE/DELETE: solo superadmin via service_role
CREATE POLICY pol_app_settings_modify
    ON public.app_settings FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_superadmin = true
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_superadmin = true
        )
    );

COMMENT ON TABLE public.app_settings IS
    'Configuración global. Solo superadmins (profiles.is_superadmin=true) pueden modificar.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. INSERTAR CONFIGURACIONES INICIALES (después de crear la tabla)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.app_settings (key, value, description)
VALUES ('superadmin_email', 'rofixinsta@gmail.com', 'Email del superadmin de la plataforma')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES ('vip_emails', 'chalohiahmd1980@gmail.com,rofixinsta@gmail.com', 'Emails VIP con bypass RLS')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES ('public_business_name', 'MOZONA TPV', 'Nombre comercial mostrado en UI')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES ('public_currency', 'EUR', 'Moneda por defecto')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES ('public_locale', 'es-ES', 'Locale por defecto')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ASEGURAR TABLA profiles CON COLUMNA is_superadmin
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT,
    is_superadmin BOOLEAN   NOT NULL DEFAULT false,
    is_vip      BOOLEAN     NOT NULL DEFAULT false,
    display_name TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si la tabla profiles YA existe, añadir columnas si faltan
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_profiles_is_superadmin ON public.profiles(is_superadmin) WHERE is_superadmin = true;
CREATE INDEX IF NOT EXISTS idx_profiles_is_vip ON public.profiles(is_vip) WHERE is_vip = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_profiles_select ON public.profiles;
DROP POLICY IF EXISTS pol_profiles_update ON public.profiles;

-- SELECT: usuario ve su propio perfil, superadmin ve todos
CREATE POLICY pol_profiles_select
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles p2
            WHERE p2.id = auth.uid() AND p2.is_superadmin = true
        )
    );

-- UPDATE: solo el dueño puede actualizar su perfil
CREATE POLICY pol_profiles_update
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Trigger: cuando se crea un auth.users, crear perfil
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, is_superadmin, is_vip)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.email = (SELECT value FROM public.app_settings WHERE key = 'superadmin_email'),
        NEW.email = ANY(string_to_array((SELECT value FROM public.app_settings WHERE key = 'vip_emails'), ','))
    )
    ON CONFLICT (id) DO UPDATE SET email = NEW.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- Sincronizar usuarios existentes (corre una vez)
INSERT INTO public.profiles (id, email, is_superadmin, is_vip)
SELECT
    u.id,
    u.email,
    u.email = (SELECT value FROM public.app_settings WHERE key = 'superadmin_email'),
    u.email = ANY(string_to_array((SELECT value FROM public.app_settings WHERE key = 'vip_emails'), ','))
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    is_superadmin = EXCLUDED.is_superadmin,
    is_vip = EXCLUDED.is_vip;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. TABLA edge_function_logs (DESPUÉS de app_settings y profiles)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.edge_function_logs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT      NOT NULL,
    actor_id    UUID        REFERENCES auth.users(id),
    action      TEXT,
    success     BOOLEAN     NOT NULL DEFAULT true,
    error_msg   TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edge_function_logs_actor
    ON public.edge_function_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_action
    ON public.edge_function_logs(function_name, action, created_at DESC);

ALTER TABLE public.edge_function_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_edge_logs_select ON public.edge_function_logs;
DROP POLICY IF EXISTS pol_edge_logs_insert ON public.edge_function_logs;
DROP POLICY IF EXISTS pol_edge_logs_modify ON public.edge_function_logs;

-- SELECT: solo el actor O superadmin
CREATE POLICY pol_edge_logs_select
    ON public.edge_function_logs FOR SELECT
    TO authenticated
    USING (
        actor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_superadmin = true
        )
    );

-- INSERT: solo el actor puede insertar sus propios logs
-- (las Edge Functions usan service_role que bypass RLS)
CREATE POLICY pol_edge_logs_insert
    ON public.edge_function_logs FOR INSERT
    TO authenticated
    WITH CHECK (actor_id = auth.uid());

-- UPDATE/DELETE: nadie puede modificar logs (inmutable)
CREATE POLICY pol_edge_logs_modify
    ON public.edge_function_logs FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.edge_function_logs IS
    'Log inmutable de invocaciones de Edge Functions. Solo INSERT permitido.';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. GRANT PERMISOS
-- ═══════════════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.app_settings        TO authenticated;
GRANT SELECT ON public.profiles            TO authenticated;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.edge_function_logs TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. VERIFICACIÓN FINAL
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_appsettings INT;
    v_profiles    INT;
    v_eflogs      INT;
    v_super       INT;
BEGIN
    SELECT count(*) INTO v_appsettings FROM public.app_settings;
    SELECT count(*) INTO v_profiles FROM public.profiles;
    SELECT count(*) INTO v_eflogs FROM public.edge_function_logs WHERE false;
    SELECT count(*) INTO v_super FROM public.profiles WHERE is_superadmin = true;

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #44 v2 APLICADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  app_settings: % fila(s)', v_appsettings;
    RAISE NOTICE '  profiles:     % usuario(s)', v_profiles;
    RAISE NOTICE '  superadmin:   % usuario(s)', v_super;
    RAISE NOTICE '  edge_function_logs: tabla creada';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;
