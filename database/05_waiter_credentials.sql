-- =====================================================================
-- MOZONA TPV — 05_waiter_credentials.sql
-- =====================================================================
-- Añade sistema de credenciales (usuario + contraseña) para camareros
-- que NO requieren email.  Complementa a 04_waiters.sql.
--
-- CAMBIOS:
--   1. Añade username TEXT UNIQUE por tenant
--   2. Añade password_hash TEXT (bcrypt vía pgcrypto)
--   3. Mantiene pin_code como opcional (retrocompatibilidad)
--   4. RPC waiter_login(username, password) → tenant_id, user_id, role
--   5. Índices únicos
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenant_users'
    ) THEN
        RAISE EXCEPTION 'La tabla public.tenant_users no existe.  Ejecuta primero database/04_waiters.sql';
    END IF;
END $$;

-- 1) Username
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS username TEXT;

-- 2) Password hash (bcrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 3) Username único por tenant (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_unique_username
    ON public.tenant_users(tenant_id, LOWER(username))
    WHERE username IS NOT NULL;

-- 4) Backfill username: a partir de name + 2 dígitos aleatorios
--    Sólo aplica a filas sin username que tengan name.
DO $$
DECLARE
    rec RECORD;
    base TEXT;
    candidate TEXT;
    tries INT;
    suffix TEXT;
BEGIN
    FOR rec IN
        SELECT id, name FROM public.tenant_users
        WHERE username IS NULL AND name IS NOT NULL
    LOOP
        base := lower(regexp_replace(rec.name, '[^a-zA-Z0-9]', '', 'g'));
        IF length(base) = 0 THEN base := 'camarero'; END IF;
        base := substring(base, 1, 12);
        tries := 0;
        LOOP
            suffix := lpad((floor(random() * 100))::text, 2, '0');
            candidate := base || suffix;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.tenant_users
                WHERE tenant_id = (SELECT tenant_id FROM public.tenant_users WHERE id = rec.id)
                  AND LOWER(username) = LOWER(candidate)
            );
            tries := tries + 1;
            EXIT WHEN tries > 50;
        END LOOP;
        UPDATE public.tenant_users SET username = candidate WHERE id = rec.id;
    END LOOP;
END $$;

-- 5) Función waiter_login: valida credenciales y devuelve sesión
--    Devuelve JSON con: { ok, tenant_id, user_id, role, name, email }
CREATE OR REPLACE FUNCTION public.waiter_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
    v_result JSON;
BEGIN
    -- Buscar por username (case-insensitive)
    SELECT tu.id, tu.tenant_id, tu.user_id, tu.role, tu.name, tu.email,
           tu.password_hash, t.subscription_status
    INTO rec
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE LOWER(tu.username) = LOWER(p_username)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'Usuario no encontrado');
    END IF;

    IF rec.password_hash IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'El usuario no tiene contraseña configurada');
    END IF;

    IF rec.password_hash <> crypt(p_password, rec.password_hash) THEN
        RETURN json_build_object('ok', false, 'error', 'Contraseña incorrecta');
    END IF;

    IF rec.subscription_status NOT IN ('active', 'trialing', 'lifetime_vip') THEN
        RETURN json_build_object('ok', false, 'error', 'Suscripción inactiva');
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

GRANT EXECUTE ON FUNCTION public.waiter_login(TEXT, TEXT) TO anon, authenticated;

-- 6) Helper para crear/resetear credenciales de un camarero
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
    v_hash      TEXT;
BEGIN
    -- Verificar que el llamante es el dueño del tenant
    SELECT tu.tenant_id, t.owner_id
    INTO v_tenant_id, v_owner_id
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.id = p_tenant_user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'Camarero no encontrado');
    END IF;

    IF v_owner_id <> auth.uid()
       AND COALESCE((SELECT (raw_user_meta_data->>'is_superadmin')::boolean
                     FROM auth.users WHERE id = auth.uid()), FALSE) <> TRUE THEN
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

    v_hash := crypt(p_password, gen_salt('bf', 8));

    UPDATE public.tenant_users
    SET username = p_username, password_hash = v_hash
    WHERE id = p_tenant_user_id;

    RETURN json_build_object('ok', true, 'username', p_username);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_waiter_credentials(UUID, TEXT, TEXT) TO authenticated;

-- 7) Realtime
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
-- VERIFICACIÓN:
--   SELECT name, username, role, password_hash IS NOT NULL AS has_pwd
--   FROM public.tenant_users
--   ORDER BY created_at;
--
--   SELECT * FROM public.waiter_login('usuario_test', 'password_test');
-- =====================================================================
