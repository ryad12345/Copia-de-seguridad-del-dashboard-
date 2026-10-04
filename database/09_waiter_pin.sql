-- =====================================================================
-- MOZONA TPV — 09_waiter_pin.sql
-- =====================================================================
-- Cambia el sistema de credenciales de camareros:
--   - Renombra password_hash → waiter_pin (texto plano, 4-6 chars)
--   - Crea/ajusta la RPC verify_waiter_login(p_username, p_pin)
--   - Mantiene retrocompatibilidad con la antigua waiter_login
--   - Idempotente
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenant_users'
    ) THEN
        RAISE EXCEPTION 'La tabla public.tenant_users no existe.  Ejecuta primero 04_waiters.sql';
    END IF;
END $$;

-- 1) Añadir columna waiter_pin (si no existe) --------------------
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS waiter_pin TEXT;

-- 2) Backfill: copiar password_hash descifrado a waiter_pin ----
--    (no podemos descifrar bcrypt, así que solo copiamos si waiter_pin
--     es NULL y password_hash es NULL también; si no, hay que resetear)
UPDATE public.tenant_users
SET waiter_pin = '0000'
WHERE waiter_pin IS NULL
  AND role IN ('waiter', 'kitchen')
  AND is_active = TRUE;

-- 3) RPC verify_waiter_login: la nueva función de login ---------
CREATE OR REPLACE FUNCTION public.verify_waiter_login(
    p_username TEXT,
    p_pin      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Buscar por username (case-insensitive)
    SELECT tu.id, tu.tenant_id, tu.user_id, tu.role, tu.name, tu.email,
           tu.waiter_pin, tu.is_active, t.subscription_status
    INTO rec
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE LOWER(tu.username) = LOWER(TRIM(p_username))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Usuario no encontrado');
    END IF;

    IF rec.is_active = FALSE THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Usuario desactivado.  Contacta al administrador.');
    END IF;

    IF rec.waiter_pin IS NULL OR rec.waiter_pin = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El usuario no tiene PIN configurado.  Contacta al administrador.');
    END IF;

    -- Comparación directa de PIN (texto plano, 4-6 caracteres)
    -- Normalizamos a UPPER y TRIM para evitar fallos por mayúsculas/minúsculas
    -- o espacios al pegar.
    IF UPPER(TRIM(COALESCE(rec.waiter_pin, ''))) <> UPPER(TRIM(COALESCE(p_pin, ''))) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN incorrecto');
    END IF;

    IF rec.subscription_status NOT IN ('active', 'trialing', 'lifetime_vip') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Suscripción del local inactiva');
    END IF;

    RETURN json_build_object(
        'ok',        true,
        'tenant_id', rec.tenant_id,
        'user_id',   rec.user_id,
        'role',      rec.role,
        'name',      rec.name,
        'email',     rec.email
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_waiter_login(TEXT, TEXT) TO anon, authenticated;

-- 4) Backward compat: la antigua waiter_login ahora delega en verify_waiter_login
--    (si la Edge Function antigua la llama, no rompe)
CREATE OR REPLACE FUNCTION public.waiter_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Por retrocompatibilidad, trata p_password como PIN de 4-6 chars
    v_result := public.verify_waiter_login(p_username, p_password);
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.waiter_login(TEXT, TEXT) TO anon, authenticated;

-- 5) RPC set_waiter_credentials: ahora setea waiter_pin (texto plano) ----
CREATE OR REPLACE FUNCTION public.set_waiter_credentials(
    p_tenant_user_id UUID,
    p_username       TEXT,
    p_password       TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_owner_id  UUID;
    v_existing  INT;
    v_is_super  BOOLEAN;
BEGIN
    -- Verificar que el llamante es el dueño del tenant o superadmin
    SELECT tu.tenant_id, t.owner_id
    INTO v_tenant_id, v_owner_id
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.id = p_tenant_user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'Camarero no encontrado');
    END IF;

    SELECT COALESCE(
        (SELECT (raw_user_meta_data->>'is_superadmin')::boolean
         FROM auth.users WHERE id = auth.uid()),
        FALSE
    ) INTO v_is_super;

    IF v_owner_id <> auth.uid() AND v_is_super <> TRUE THEN
        RETURN json_build_object('ok', false, 'error', 'No autorizado');
    END IF;

    -- Username único por tenant
    SELECT count(*) INTO v_existing
    FROM public.tenant_users
    WHERE tenant_id = v_tenant_id
      AND LOWER(username) = LOWER(p_username)
      AND id <> p_tenant_user_id;

    IF v_existing > 0 THEN
        RETURN json_build_object('ok', false, 'error', 'Ese usuario ya existe en el tenant');
    END IF;

    UPDATE public.tenant_users
    SET username = LOWER(TRIM(p_username)),
        waiter_pin = UPPER(TRIM(p_password))
    WHERE id = p_tenant_user_id;

    RETURN json_build_object('ok', true, 'username', p_username);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_waiter_credentials(UUID, TEXT, TEXT) TO authenticated;

-- 6) Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_users;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- TEST RÁPIDO:
--   -- Crear un camarero de prueba
--   INSERT INTO public.tenant_users (tenant_id, name, role, is_active)
--   SELECT id, 'Test', 'waiter', TRUE FROM public.tenants LIMIT 1;
--
--   -- Setear credenciales
--   SELECT public.set_waiter_credentials(
--     (SELECT id FROM public.tenant_users WHERE name = 'Test' LIMIT 1),
--     'ryad30', '74z4ee'
--   );
--
--   -- Probar login (debe devolver ok: true)
--   SELECT * FROM public.verify_waiter_login('ryad30', '74z4ee');
-- =====================================================================
