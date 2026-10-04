-- =====================================================================
-- MOZONA TPV — SQL #73: AUDITORÍA — BLOQUE 1 COMPLETO
-- =====================================================================
-- Plan completo del pentester (02/10/2026, PDF 23 páginas).
-- Cubre H-01, H-02, H-03, H-06, H-07 (parte BD), H-09.
--
-- ESTRUCTURA (cada sección es idempotente y se puede ejecutar sola):
--   1.0  Preparación: pgcrypto
--   1.1  Funciones helper: get_my_tenant(), is_admin()
--   1.2  Habilitar RLS + políticas aislamiento tenant
--        1.2.a Drop policies rotas
--        1.2.b Habilitar RLS
--        1.2.c Políticas genéricas tenant_isolation
--        1.2.d profiles (lectura tenant, self-update limitado)
--        1.2.e waiters (lectura staff, escritura solo admin)
--        1.2.f tenants (solo tu tenant)
--        1.2.g tenant_users (bootstrap + aislamiento)
--   1.3  H-01/H-02: REVOKE ALL FROM anon + default privileges
--   1.4  H-03: DROP get_first_active_tenant
--   1.5  H-07: hash PINs con bcrypt + rate-limiting + verify_waiter_pin
--   1.6  Trigger handle_new_user para crear profiles
--
-- ORDEN DE EJECUCIÓN RECOMENDADO:
--   1. Hacer BACKUP en Supabase Dashboard → Database → Backups
--   2. Aplicar 1.0 → 1.2 (NO rompe nada, añade policies)
--   3. Probar login chalohiahmd → /app sigue OK
--   4. Aplicar 1.3 (REVOKE anon) — momento delicado
--   5. Aplicar 1.4 (DROP RPC)
--   6. Aplicar 1.5 (hash + verify_waiter_pin) — frontend debe estar listo
--   7. Aplicar 1.6 (trigger profiles)
-- =====================================================================

-- ============================================================
-- 1.0 PREPARACIÓN
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1.1 FUNCIONES HELPER (resuelven 42P17 recursion en profiles)
-- ============================================================

-- Tenant del usuario autenticado (lee profiles/tenant_users con
-- privilegios elevados, por eso NO hay recursión cuando una política
-- la invoca).
-- v4.5.17: usamos tenant_users (NO profiles) porque profiles
-- no tiene tenant_id en este schema.
CREATE OR REPLACE FUNCTION public.get_my_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = '', extensions, public
AS $$
  SELECT tu.tenant_id
  FROM public.tenant_users tu
  WHERE tu.user_id = (SELECT auth.uid())
  ORDER BY tu.created_at DESC NULLS LAST
  LIMIT 1
$$;

-- ¿Es admin/owner del tenant?
-- v4.5.17: leemos de tenant_users.role (NO profiles.role, no existe).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = '', extensions, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_users tu
    WHERE tu.user_id = (SELECT auth.uid())
    AND tu.role IN ('owner', 'admin')
  )
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

COMMENT ON FUNCTION public.get_my_tenant() IS
  'v4.5.17: SECURITY DEFINER. Lee tenant_users con bypass RLS.
   Devuelve tenant_id del usuario autenticado.
   NULL si el usuario no tiene tenant (admin puro).';
COMMENT ON FUNCTION public.is_admin() IS
  'v4.5.17: SECURITY DEFINER. Lee tenant_users.role IN (owner,admin).';

-- ============================================================
-- 1.2 HABILITAR RLS + AISLAMIENTO POR TENANT
-- ============================================================

-- 1.2.a Eliminar policies rotas / abiertas actuales
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
        AND ('anon' = ANY(roles) OR tablename IN ('profiles', 'tenant_users'))
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       r.policyname, r.tablename);
        RAISE NOTICE 'Dropped policy % on %', r.policyname, r.tablename;
    END LOOP;
END $$;

-- 1.2.b Habilitar RLS en TODAS las tablas del esquema public
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity = false
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
                       r.tablename);
        RAISE NOTICE 'RLS enabled on %', r.tablename;
    END LOOP;
END $$;

-- 1.2.c Políticas genéricas tenant_isolation para tablas con tenant_id
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT DISTINCT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
        AND c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN (
            'profiles',     -- política específica abajo
            'tenants',       -- política específica abajo
            'tenant_users',  -- política específica abajo
            'waiters'       -- política específica abajo (gestión admins)
        )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I',
                       r.table_name);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON public.%I
              FOR ALL TO authenticated
              USING (tenant_id = (SELECT public.get_my_tenant()))
              WITH CHECK (tenant_id = (SELECT public.get_my_tenant()))
        $f$, r.table_name);
        RAISE NOTICE 'tenant_isolation aplicada a %', r.table_name;
    END LOOP;
END $$;

-- 1.2.d profiles: SELECT mismo tenant, UPDATE solo a sí mismo
DROP POLICY IF EXISTS profiles_select_same_tenant ON public.profiles;
CREATE POLICY profiles_select_same_tenant ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR TRUE);  -- v4.5.17: profiles no tiene tenant_id, solo permitimos ver el propio

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Sin INSERT/DELETE para usuarios normales: altas/bajas de staff
-- se gestionan por invitación (service_role / Edge Function).
-- Blindar columnas sensibles
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, display_name) ON public.profiles TO authenticated;

-- 1.2.e waiters: lectura para staff, escritura SOLO admins del tenant
DROP POLICY IF EXISTS waiters_select_same_tenant ON public.waiters;
CREATE POLICY waiters_select_same_tenant ON public.waiters
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_my_tenant()));

DROP POLICY IF EXISTS waiters_manage_admins_only ON public.waiters;
CREATE POLICY waiters_manage_admins_only ON public.waiters
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_admin()) AND tenant_id = (SELECT public.get_my_tenant())
  )
  WITH CHECK (
    (SELECT public.is_admin()) AND tenant_id = (SELECT public.get_my_tenant())
  );

-- Ocultar el hash del PIN a nivel de columnas (ver 1.5)
REVOKE SELECT ON public.waiters FROM authenticated;
GRANT SELECT (id, tenant_id, name, role, is_active, created_at)
  ON public.waiters TO authenticated;

-- 1.2.f tenants: un miembro solo ve su tenant
DROP POLICY IF EXISTS tenants_read_own ON public.tenants;
CREATE POLICY tenants_read_own ON public.tenants
  FOR SELECT TO authenticated
  USING (id = (SELECT public.get_my_tenant()));

DROP POLICY IF EXISTS tenants_update_own ON public.tenants;
CREATE POLICY tenants_update_own ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = (SELECT public.get_my_tenant()))
  WITH CHECK (id = (SELECT public.get_my_tenant()));

-- 1.2.g tenant_users: bootstrap + aislamiento
-- Esta tabla es la que une user↔tenant, sin ella get_my_tenant() falla.
DROP POLICY IF EXISTS tenant_users_self_or_same_tenant ON public.tenant_users;
CREATE POLICY tenant_users_self_or_same_tenant ON public.tenant_users
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR tenant_id = (SELECT public.get_my_tenant())
  )
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================
-- 1.3 REVOKE ALL FROM anon (H-01 / H-02) — sección crítica
-- ============================================================
-- ANTES DE EJECUTAR:
--   • Frontend debe tolerar BD cerrada (callRpc fallback legacy con JWT)
--   • waiters con sesión auth (no anon) deben poder leer carta
--   • La RPC verify_waiter_pin debe estar desplegada (ver 1.5)
--
-- Si todo lo anterior está listo, ejecuta esta sección.

BEGIN;

-- Quitar TODO acceso de anon a tablas y secuencias
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Quitar ejecución de TODAS las funciones RPC a anon
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Evitar que tablas/funciones FUTURAS hereden permisos abiertos
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;

-- Si tu BD tiene otros roles creando objetos (supabase_admin),
-- repite las 3 sentencias conectado con ese rol.

COMMIT;

-- ============================================================
-- 1.4 H-03: ELIMINAR RPC get_first_active_tenant
-- ============================================================
-- Esta RPC filtraba el primer tenant activo a cualquier anon.
-- El tenant ahora se resuelve post-login via get_my_tenant().

DROP FUNCTION IF EXISTS public.get_first_active_tenant();

-- Si necesitas selector público de sedes, crea tabla tenant_directory:
-- (no la creamos por defecto — habilita solo si la necesitas)
--
-- create table if not exists public.tenant_directory (
--   tenant_id uuid primary key,
--   slug text unique not null,
--   display_name text not null
-- );
-- alter table public.tenant_directory enable row level security;
-- create policy "tenant_directory_public_read"
--   on public.tenant_directory for select to anon using (true);
-- grant select on public.tenant_directory to anon;

-- ============================================================
-- 1.5 H-07: HASHEAR PINs + RATE-LIMITING + verify_waiter_pin
-- ============================================================
-- ANTES DE EJECUTAR:
--   • El frontend debe llamar SOLO a verify_waiter_pin (NO comparar
--     PIN en cliente)
--   • Esta sección altera waiters.pin → waiters.pin_hash. Tras
--     ejecutar, todos los PINs antiguos quedan obsoletos. Los camareros
--     siguen usando el MISMO PIN (se hashea el valor actual).
--
--   1.5.a Migrar pin plano -> bcrypt
--   1.5.b Tabla waiter_pin_attempts (anti fuerza bruta)
--   1.5.c RPC verify_waiter_pin (nunca devuelve el PIN)
--   1.5.d Reset PINs (recomendado, opcional — descomentar si quieres)

BEGIN;

-- 1.5.a Añadir columna pin_hash y migrar valores
ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS pin_hash text;

UPDATE public.waiters
SET pin_hash = extensions.crypt(
  COALESCE(pin, ''),
  extensions.gen_salt('bf', 12)
)
WHERE pin_hash IS NULL AND pin IS NOT NULL;

-- Verificar antes de borrar la columna plana:
-- select count(*) from public.waiters where pin_hash is null; -- debe ser 0

ALTER TABLE public.waiters
  ALTER COLUMN pin_hash SET NOT NULL;

-- DROP solo después de verificar que pin_hash está poblada
-- (si algún pin no se migró, esto fallará y sabrás que fila es)
ALTER TABLE public.waiters
  DROP COLUMN IF EXISTS pin;

-- 1.5.b Tabla control intentos (anti fuerza bruta)
CREATE TABLE IF NOT EXISTS public.waiter_pin_attempts (
  waiter_id      uuid PRIMARY KEY REFERENCES public.waiters(id) ON DELETE CASCADE,
  failed_attempts int  NOT NULL DEFAULT 0,
  locked_until   timestamptz
);
ALTER TABLE public.waiter_pin_attempts ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo accesible por funciones security definer

-- 1.5.c RPC verify_waiter_pin
CREATE OR REPLACE FUNCTION public.verify_waiter_pin(
  p_waiter_id uuid,
  p_pin       text
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = '', extensions, public
AS $$
DECLARE
  v_tenant   uuid := public.get_my_tenant();
  v_ok       boolean;
  v_attempts int;
  v_locked   timestamptz;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_session');
  END IF;

  SELECT a.failed_attempts, a.locked_until
    INTO v_attempts, v_locked
    FROM public.waiter_pin_attempts a
    WHERE a.waiter_id = p_waiter_id;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN json_build_object('ok', false, 'error', 'locked', 'until', v_locked);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.waiters w
    WHERE w.id = p_waiter_id
      AND w.tenant_id = v_tenant
      AND w.pin_hash = extensions.crypt(p_pin, w.pin_hash)
  ) INTO v_ok;

  IF v_ok THEN
    DELETE FROM public.waiter_pin_attempts WHERE waiter_id = p_waiter_id;
    RETURN json_build_object('ok', true);
  END IF;

  INSERT INTO public.waiter_pin_attempts (waiter_id, failed_attempts)
    VALUES (p_waiter_id, 1)
    ON CONFLICT (waiter_id) DO UPDATE
    SET failed_attempts = waiter_pin_attempts.failed_attempts + 1,
        locked_until = CASE
          WHEN waiter_pin_attempts.failed_attempts + 1 >= 5
          THEN now() + interval '15 minutes'
          ELSE waiter_pin_attempts.locked_until
        END;

  RETURN json_build_object('ok', false, 'error', 'bad_pin');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_waiter_pin(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.verify_waiter_pin(uuid, text) TO authenticated;

-- 1.5.d Reset PINs (recomendado post-despliegue, opcional)
--   Tras ejecutar esto, todos los camareros deben re-establecer su PIN.
--   Descomentar solo si quieres forzar reset:
--
-- UPDATE public.waiters SET pin_hash = NULL;

COMMIT;

-- ============================================================
-- 1.6 TRIGGER handle_new_user — crear profile al registrarse
-- ============================================================
-- Para que el alta no dependa de escrituras anon en profiles.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '', public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',
             split_part(NEW.email, '@', 1)),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Importante: el tenant_id real se asigna por invitación desde Edge
-- Function con service_role. NO confiar en raw_user_meta_data para rol.

-- ============================================================
-- RECARGA CACHE POSTGRST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '==================================================================';
  RAISE NOTICE '✓ BLOQUE 1 aplicado (1.0 → 1.6)';
  RAISE NOTICE '  ✓ 1.1 funciones get_my_tenant() + is_admin() con search_path seguro';
  RAISE NOTICE '  ✓ 1.2 RLS habilitado + políticas aislamiento tenant';
  RAISE NOTICE '  ✓ 1.3 anon REVOKE ALL (H-01, H-02 cerrados)';
  RAISE NOTICE '  ✓ 1.4 DROP get_first_active_tenant (H-03)';
  RAISE NOTICE '  ✓ 1.5 PINs hasheados + verify_waiter_pin (H-07)';
  RAISE NOTICE '  ✓ 1.6 handle_new_user trigger';
  RAISE NOTICE '==================================================================';
  RAISE NOTICE 'PRUEBA INMEDIATA:';
  RAISE NOTICE '  1. chalohiahmd1980@gmail.com → /app debe seguir funcionando';
  RAISE NOTICE '  2. rofixinsta@gmail.com → /admin debe seguir funcionando';
  RAISE NOTICE '  3. anon → SELECT * FROM products debe dar 42501';
  RAISE NOTICE '  4. Login email no confirmado → debe mostrar mensaje';
  RAISE NOTICE '==================================================================';
END $$;