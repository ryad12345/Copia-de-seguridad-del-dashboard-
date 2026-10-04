-- =====================================================================
-- MOZONA TPV — 04_waiters.sql
-- =====================================================================
-- Habilita camareros "ligeros" (PIN-only, sin cuenta Supabase propia).
-- Esto permite que el dueño del restaurante dé de alta camareros
-- directamente con nombre + PIN, sin que cada camarero necesite email.
--
-- IMPORTANTE: este script es autocontenido.  Si la tabla `tenants`
-- no existe, ABORTA con un error claro (ejecuta antes 02_saas_migration.sql).
--
-- CAMBIOS:
--   1. user_id  → NULL permitido
--   2. email    → NULL permitido
--   3. Añade   name TEXT NOT NULL DEFAULT 'Camarero'
--   4. Quita   UNIQUE(tenant_id, user_id) y lo reemplaza por
--              UNIQUE(tenant_id, COALESCE(user_id::text, ''))  que tolera NULLs
--   5. Añade   UNIQUE(tenant_id, pin_code) — un PIN por tenant
--   6. Define is_tenant_owner() y is_tenant_waiter() (idempotente)
--   7. Mantiene RLS para que el dueño gestione su equipo
-- =====================================================================

-- Pre-check: si no existe la tabla tenants, abortar -------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
    ) THEN
        RAISE EXCEPTION 'La tabla public.tenants no existe.  Ejecuta primero database/02_saas_migration.sql';
    END IF;
END $$;

-- 1) Hacer user_id nullable -------------------------------------
ALTER TABLE public.tenant_users
    ALTER COLUMN user_id DROP NOT NULL;

-- 2) Hacer email nullable ---------------------------------------
ALTER TABLE public.tenant_users
    ALTER COLUMN email DROP NOT NULL;

-- 3) Añadir columna name ----------------------------------------
ALTER TABLE public.tenant_users
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Camarero';

-- 4) Reemplazar UNIQUE(tenant_id, user_id) ----------------------
ALTER TABLE public.tenant_users
    DROP CONSTRAINT IF EXISTS tenant_users_tenant_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_unique_user
    ON public.tenant_users(tenant_id, COALESCE(user_id::text, ''));

-- 5) PIN único por tenant ---------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_unique_pin
    ON public.tenant_users(tenant_id, pin_code)
    WHERE pin_code IS NOT NULL;

-- 6) Funciones helper -----------------------------------------
-- (idempotentes: se incluyen aquí por si se ejecuta este script
--  de forma aislada sin haber corrido 02_saas_migration.sql)

CREATE OR REPLACE FUNCTION public.is_tenant_owner(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id  = tid
          AND owner_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_waiter(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = tid
          AND user_id   = auth.uid()
    );
$$;

-- 7) RLS — refrescar políticas para soportar inserts de camareros
--    "ligeros" (user_id NULL).  Idempotente.
DROP POLICY IF EXISTS "Owners add users to their tenant"     ON public.tenant_users;
DROP POLICY IF EXISTS "Owners update tenant_users"           ON public.tenant_users;
DROP POLICY IF EXISTS "Owners delete tenant_users"           ON public.tenant_users;
DROP POLICY IF EXISTS "Tenant users read same tenant"        ON public.tenant_users;

-- Lectura: cualquier miembro del tenant (incluye camareros)
CREATE POLICY "Tenant users read same tenant"
    ON public.tenant_users FOR SELECT
    USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()));

-- Inserción: el dueño añade camareros al tenant
-- (user_id puede ser NULL = camarero "ligero" sin cuenta Supabase)
CREATE POLICY "Owners add users to their tenant"
    ON public.tenant_users FOR INSERT
    WITH CHECK (public.is_tenant_owner(tenant_id));

-- Update: el dueño puede editar cualquier miembro; el usuario puede
-- actualizarse a sí mismo (cambiar PIN propio).
CREATE POLICY "Owners update tenant_users"
    ON public.tenant_users FOR UPDATE
    USING (
        public.is_tenant_owner(tenant_id)
        OR user_id = auth.uid()
    )
    WITH CHECK (
        public.is_tenant_owner(tenant_id)
        OR user_id = auth.uid()
    );

-- Delete: solo el dueño
CREATE POLICY "Owners delete tenant_users"
    ON public.tenant_users FOR DELETE
    USING (public.is_tenant_owner(tenant_id));

-- 8) Realtime — el dueño debe ver los cambios en tiempo real ----
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_users;
    END IF;
END $$;

-- 9) Backfill: para tenant_users que ya existen con email pero
--    sin name, copiar el pre-@ del email al name.
UPDATE public.tenant_users
SET name = COALESCE(
    NULLIF(split_part(email, '@', 1), ''),
    'Camarero'
)
WHERE (name IS NULL OR name = '' OR name = 'Camarero')
  AND email IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFICACIÓN:
--   SELECT name, email, role, pin_code, user_id IS NULL AS es_ligero
--   FROM public.tenant_users
--   ORDER BY created_at;
-- =====================================================================
