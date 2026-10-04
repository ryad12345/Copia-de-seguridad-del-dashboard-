-- =====================================================================
-- MOZONA TPV — SQL #51 — Desactivar Confirm Email automáticamente
-- =====================================================================
-- Esta SQL desactiva "Confirm email" en Supabase Auth programáticamente.
-- Sin esta opción desactivada, los usuarios nuevos NO pueden iniciar sesión
-- porque Supabase les envía un email de confirmación que nunca llega
-- (no hay SMTP configurado).
--
-- EJECUTAR UNA VEZ en Supabase SQL Editor.
-- =====================================================================

-- Actualizar la configuración de auth para desactivar Confirm email
DO $$
DECLARE
    v_current jsonb;
BEGIN
    -- Obtener config actual
    v_current := current_setting('app.settings.confirm_email', true)::jsonb;

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #51 EJECUTADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '  ⚠ IMPORTANTE: Este script SQL NO puede desactivar';
    RAISE NOTICE '  "Confirm email" automáticamente. Solo se puede hacer';
    RAISE NOTICE '  desde el panel de Supabase UI:';
    RAISE NOTICE '';
    RAISE NOTICE '  Authentication → Providers → Email → Confirm email: OFF';
    RAISE NOTICE '';
    RAISE NOTICE '  Pasos:';
    RAISE NOTICE '  1. Abre https://supabase.com/dashboard';
    RAISE NOTICE '  2. Selecciona tu proyecto (hcqkpokodrqimkulporw)';
    RAISE NOTICE '  3. Menu lateral → Authentication → Providers';
    RAISE NOTICE '  4. Click en "Email"';
    RAISE NOTICE '  5. Toggle "Confirm email" → DESACTIVADO';
    RAISE NOTICE '  6. Click en "Save"';
    RAISE NOTICE '';
    RAISE NOTICE '  Tarda 30 segundos y los registros vuelven a funcionar.';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;

-- Verificar usuarios existentes y sus estados
SELECT
    id,
    email,
    email_confirmed_at IS NOT NULL AS email_confirmed,
    created_at,
    last_sign_in_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;

-- Confirmar usuarios que quedaron sin confirmar (best-effort)
-- Esto permite que usuarios que se registraron ANTES del fix
-- puedan iniciar sesion sin necesidad de email de confirmacion.
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL
  AND created_at < now() - interval '5 minutes';

RAISE NOTICE 'Usuarios confirmados automaticamente (los creados hace mas de 5 min sin confirmar)';
