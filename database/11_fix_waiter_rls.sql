-- =====================================================================
-- MOZONA TPV — 11_fix_waiter_rls.sql  (SCRIPT "TODO-EN-UNO")
-- =====================================================================
-- Solución definitiva para los errores 400/404 al crear camareros.
-- Ejecutar en Supabase SQL Editor.
--
-- Este script:
--   1. Asegura que las columnas existen (username, waiter_pin, etc.)
--   2. Repara las políticas RLS para que el dueño del tenant pueda
--      hacer SELECT / INSERT / UPDATE / DELETE sobre sus camareros
--   3. Recarga la caché de PostgREST (NOTIFY pgrst)
--   4. Crea/actualiza el RPC verify_waiter_login
--   5. Backfill: pone usernames y PINs a los camareros existentes
-- =====================================================================

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='tenants') THEN
        RAISE EXCEPTION 'No existe public.tenants.  Ejecuta primero 02_saas_migration.sql';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='tenant_users') THEN
        RAISE EXCEPTION 'No existe public.tenant_users.  Ejecuta primero 04_waiters.sql';
    END IF;
END $$;

-- ============================================================
-- 1. Asegurar columnas necesarias
-- ============================================================

-- Habilitar pgcrypto para bcrypt (por si no se hizo)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Columnas de la 04_waiters.sql (idempotente)
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Camarero';
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS pin_code TEXT;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Columnas nuevas de la 05/09 (username + waiter_pin)
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS waiter_pin TEXT;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'waiter';

-- Índices únicos (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_unique_username
    ON public.tenant_users(tenant_id, LOWER(username))
    WHERE username IS NOT NULL;

-- Backfill: username para camareros existentes
DO $$
DECLARE
    rec RECORD;
    base TEXT;
    candidate TEXT;
    tries INT;
BEGIN
    FOR rec IN
        SELECT id, name, tenant_id FROM public.tenant_users
        WHERE username IS NULL AND name IS NOT NULL
    LOOP
        base := lower(regexp_replace(rec.name, '[^a-zA-Z0-9]', '', 'g'));
        IF length(base) = 0 THEN base := 'camarero'; END IF;
        base := substring(base, 1, 12);
        tries := 0;
        candidate := base || lpad((floor(random() * 100))::text, 2, '0');
        WHILE EXISTS (
            SELECT 1 FROM public.tenant_users
            WHERE tenant_id = rec.tenant_id
              AND LOWER(username) = LOWER(candidate)
              AND id <> rec.id
        ) AND tries < 50 LOOP
            tries := tries + 1;
            candidate := base || lpad((floor(random() * 100))::text, 2, '0');
        END LOOP;
        UPDATE public.tenant_users
        SET username = LOWER(candidate)
        WHERE id = rec.id;
    END LOOP;
END $$;

-- Backfill: waiter_pin para camareros existentes (4 chars uppercase)
UPDATE public.tenant_users
SET waiter_pin = UPPER(COALESCE(pin_code, '0000'))
WHERE waiter_pin IS NULL
  AND role IN ('waiter', 'kitchen')
  AND is_active = TRUE;

-- ============================================================
-- 2. RLS — Política única que permite al dueño gestionar camareros
-- ============================================================

ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- Borrar policies antiguas
DROP POLICY IF EXISTS "Owners add users to their tenant"      ON public.tenant_users;
DROP POLICY IF EXISTS "Owners update tenant_users"            ON public.tenant_users;
DROP POLICY IF EXISTS "Owners delete tenant_users"            ON public.tenant_users;
DROP POLICY IF EXISTS "Tenant users read same tenant"         ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_manage_owner"             ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_select"                   ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_insert"                   ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_update"                   ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_delete"                   ON public.tenant_users;

-- Helper: ¿es owner del tenant?
CREATE OR REPLACE FUNCTION public.is_tenant_owner(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = tid AND owner_id = auth.uid()
    );
$$;

-- Helper: ¿es superadmin?
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        (SELECT (raw_user_meta_data->>'is_superadmin')::boolean
         FROM auth.users WHERE id = auth.uid()),
        FALSE
    );
$$;

-- SELECT: el dueño ve sus camareros, los camareros se ven a sí mismos,
-- y superadmin ve todo.
CREATE POLICY "tenant_users_select"
ON public.tenant_users FOR SELECT
TO authenticated
USING (
    is_tenant_owner(tenant_id)
    OR user_id = auth.uid()
    OR is_superadmin()
);

-- INSERT: el dueño añade camareros a su tenant, superadmin en cualquier tenant
CREATE POLICY "tenant_users_insert"
ON public.tenant_users FOR INSERT
TO authenticated
WITH CHECK (
    is_tenant_owner(tenant_id)
    OR is_superadmin()
);

-- UPDATE: el dueño puede editar, el usuario puede editarse a sí mismo
CREATE POLICY "tenant_users_update"
ON public.tenant_users FOR UPDATE
TO authenticated
USING (
    is_tenant_owner(tenant_id)
    OR user_id = auth.uid()
    OR is_superadmin()
)
WITH CHECK (
    is_tenant_owner(tenant_id)
    OR user_id = auth.uid()
    OR is_superadmin()
);

-- DELETE: solo el dueño del tenant o superadmin
CREATE POLICY "tenant_users_delete"
ON public.tenant_users FOR DELETE
TO authenticated
USING (
    is_tenant_owner(tenant_id)
    OR is_superadmin()
);

-- ============================================================
-- 3. RPC: verify_waiter_login (re-crear idempotente)
-- ============================================================
DROP FUNCTION IF EXISTS public.verify_waiter_login(TEXT, TEXT);
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
        RETURN jsonb_build_object('ok', false, 'error', 'Usuario desactivado');
    END IF;

    IF rec.waiter_pin IS NULL OR rec.waiter_pin = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El usuario no tiene PIN configurado');
    END IF;

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

-- RPC set_waiter_credentials (por si el frontend aún la usa)
DROP FUNCTION IF EXISTS public.set_waiter_credentials(UUID, TEXT, TEXT);
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
BEGIN
    SELECT tu.tenant_id, t.owner_id
    INTO v_tenant_id, v_owner_id
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.id = p_tenant_user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'Camarero no encontrado');
    END IF;

    IF v_owner_id <> auth.uid() AND NOT is_superadmin() THEN
        RETURN json_build_object('ok', false, 'error', 'No autorizado');
    END IF;

    SELECT count(*) INTO v_existing
    FROM public.tenant_users
    WHERE tenant_id = v_tenant_id
      AND LOWER(username) = LOWER(p_username)
      AND id <> p_tenant_user_id;

    IF v_existing > 0 THEN
        RETURN json_build_object('ok', false, 'error', 'Ese usuario ya existe');
    END IF;

    UPDATE public.tenant_users
    SET username = LOWER(TRIM(p_username)),
        waiter_pin = UPPER(TRIM(p_password)),
        pin_code = UPPER(TRIM(p_password))
    WHERE id = p_tenant_user_id;

    RETURN json_build_object('ok', true, 'username', p_username);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_waiter_credentials(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 4. Realtime
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_users;
    END IF;
END $$;

-- ============================================================
-- 5. Recargar caché PostgREST (CLAVE para evitar 400/404)
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT
    'tenants'         AS tabla,
    count(*)::text     AS filas
FROM public.tenants
UNION ALL
SELECT
    'tenant_users',
    count(*)::text
FROM public.tenant_users
UNION ALL
SELECT
    'camareros_con_username',
    count(*)::text
FROM public.tenant_users
WHERE username IS NOT NULL
UNION ALL
SELECT
    'camareros_con_pin',
    count(*)::text
FROM public.tenant_users
WHERE waiter_pin IS NOT NULL;

-- Test rápido del RPC
SELECT * FROM public.verify_waiter_login('test28', 'FJCHID');
-- (probablemente devuelva ok=false con 'Usuario no encontrado' si test28 no existe)

-- ============================================================
-- INSTRUCCIONES POST-INSTALACIÓN
-- ============================================================
-- 1. Ve a Settings → Camareros
-- 2. Borra camareros antiguos (los que no tengan username/waiter_pin)
-- 3. Crea uno nuevo: nombre "Test", rol waiter
-- 4. Anota el username y PIN que se generan
-- 5. Ve a /waiter/login, mete las credenciales → debe entrar
-- ============================================================
