-- =====================================================================
-- MOZONA TPV — SQL #72: AUDIT FIX — Fases 0 y 1 (H-01, H-06, H-09)
-- =====================================================================
-- Auditoría externa caja negra (02/10/2026) detectó 4 hallazgos CRÍTICOS.
-- Plan por Fases. ESTE SCRIPT aplica SOLO Fase 0 + Fase 1:
--
--   ✓ Fase 0: función get_my_tenant() + fix policy profiles (H-06)
--   ✓ Fase 1: aislamiento por tenant para authenticated (H-01, H-09)
--   ✗ Fase 2: edge function waiter-api con JWT (H-07) — PENDIENTE
--   ✗ Fase 3: REVOKE ALL FROM anon — NO APLICAR hasta validar Fase 2
--
-- RIESGO DE FASE 3 SIN FASE 2:
--   El flujo de camareros sin sesión (modo limitado) usa anon como fallback.
--   Si ejecutamos REVOKE ALL FROM anon sin waiter-api operativo, los
--   camareros NO podrán ni leer carta ni crear comandas.
--
-- INSTRUCCIONES:
--   1. BACKUP en Supabase Dashboard → Database → Backups (antes de aplicar)
--   2. SQL Editor → New query → pegar este script → Run
--   3. Verificar que la app sigue funcionando con sesión
--   4. Cuando confirmes, se te indica cómo desplegar waiter-api
-- =====================================================================

-- ============================================================
-- FASE 0: función base de aislamiento por tenant (H-06 fix)
-- ============================================================
-- v4.5.15: usa tenant_users (NO profiles) porque profiles
--   no tiene columna tenant_id en este schema.
--   Si el usuario es superadmin sin tenant_users → retorna NULL
--   (las políticas NULL = FALSE → superadmin NO ve datos de tenants,
--    coherente con que solo va a /admin).

CREATE OR REPLACE FUNCTION public.get_my_tenant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT tenant_id
  FROM public.tenant_users
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
$$;

COMMENT ON FUNCTION public.get_my_tenant() IS
  'v4.5.15: SECURITY DEFINER helper. Devuelve tenant_id del usuario
   autenticado leyendo de tenant_users (con bypass RLS).
   NULL si el usuario no está asociado a ningún tenant (ej: admin puro).';

-- Elimina las políticas rotas/actuales de profiles (las recreamos limpias)
DO $$
DECLARE p text;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE tablename = 'profiles' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', p);
    END LOOP;
END $$;

-- Política sana para profiles (sin recursion):
-- cada usuario ve su propio perfil.
-- (No filtramos por tenant_id porque profiles no tiene esa columna;
--  el aislamiento por tenant ya está cubierto en las tablas de negocio)
CREATE POLICY "profiles_self_access" ON public.profiles
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- FASE 1: aislamiento por tenant para authenticated (H-01, H-09)
-- ============================================================
-- Cierra la fuga: cada usuario autenticado solo ve/edita SU tenant.
-- anon sigue igual temporalmente (Fase 3 lo cierra cuando waiter-api esté listo).

-- Helper: dropea TODAS las políticas de una tabla
CREATE OR REPLACE FUNCTION public._drop_all_policies_for_table(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE p text;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE tablename = p_table AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, p_table);
    END LOOP;
END $$;

-- Aplica tenant_isolation en todas las tablas de negocio
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'products','orders','order_items','categories',
        'dining_tables','tenant_settings','waiters',
        'open_orders','payments'
    ]
    LOOP
        PERFORM public._drop_all_policies_for_table(t);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON public.%I
              FOR ALL TO authenticated
              USING (tenant_id = public.get_my_tenant())
              WITH CHECK (tenant_id = public.get_my_tenant())
        $f$, t);
        RAISE NOTICE 'Policy tenant_isolation aplicada a %', t;
    END LOOP;
END $$;

-- tenant_users: política especial porque ES la tabla que vincula
-- user con tenant. Sin ella no podríamos saber a qué tenant pertenece
-- cada usuario. Permitimos:
--   - Ver tu propio registro (user_id = auth.uid())
--   - Ver registros de tu mismo tenant (tenant_id = get_my_tenant())
--   - Insertar solo tu propio registro (user_id = auth.uid())
-- (usamos SELECT en lugar de PERFORM porque PERFORM solo funciona
--  dentro de PL/pgSQL, no como statement standalone)
SELECT public._drop_all_policies_for_table('tenant_users');
CREATE POLICY tenant_users_isolation ON public.tenant_users
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR tenant_id = public.get_my_tenant()
  )
  WITH CHECK (user_id = auth.uid());

-- tenants: el dueño ve solo su tenant (cierra H-09 fuga metadatos)
SELECT public._drop_all_policies_for_table('tenants');
CREATE POLICY tenant_isolation ON public.tenants
  FOR SELECT TO authenticated
  USING (id = public.get_my_tenant() OR owner_id = auth.uid());

CREATE POLICY tenant_update_isolation ON public.tenants
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR id = public.get_my_tenant())
  WITH CHECK (owner_id = auth.uid() OR id = public.get_my_tenant());

-- profiles: INSERT/UPDATE solo para uno mismo (defense in depth)
-- SELECT ya cubierto arriba. Añadimos DELETE solo para sí mismo.
CREATE POLICY profiles_delete_self ON public.profiles
  FOR DELETE TO authenticated
  USING (id = auth.uid());

-- ============================================================
-- (Fase 3 NO incluida — NO EJECUTAR hasta que waiter-api esté listo)
-- ============================================================

-- Recarga caché de PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificación
DO $$
BEGIN
    RAISE NOTICE '==================================================================';
    RAISE NOTICE '✓ FASE 0 aplicada: get_my_tenant() + fix profiles (H-06)';
    RAISE NOTICE '✓ FASE 1 aplicada: tenant_isolation en 10 tablas (H-01, H-09)';
    RAISE NOTICE '✗ FASE 2 PENDIENTE: desplegar edge function waiter-api';
    RAISE NOTICE '✗ FASE 3 NO APLICADA: REVOKE anon — esperar a Fase 2';
    RAISE NOTICE '==================================================================';
    RAISE NOTICE 'PRUEBA: haz login con chalohiahmd1980@gmail.com y abre /app.';
    RAISE NOTICE 'PRUEBA: haz login con rofixinsta@gmail.com y abre /admin.';
    RAISE NOTICE 'Si ambos funcionan, sigue con Fase 2 (waiter-api).';
    RAISE NOTICE '==================================================================';
END $$;