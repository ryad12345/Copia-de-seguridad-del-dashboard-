-- =====================================================================
-- MOZONA TPV — 08_test_e2e.sql
-- =====================================================================
-- Test end-to-end del flujo de camareros.
-- Ejecútalo en Supabase SQL Editor y verifica que cada bloque
-- devuelve los resultados esperados.
-- =====================================================================

-- =============================================================
-- 1. VERIFICAR ESTRUCTURA
-- =============================================================

-- ¿Existe la tabla tenant_users con las columnas necesarias?
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenant_users'
  AND column_name IN ('username', 'password_hash', 'pin_code', 'name', 'role', 'tenant_id')
ORDER BY column_name;

-- Esperado:
--   name          | text    | NO | 'Camarero'
--   password_hash | text    | YES| NULL
--   pin_code      | text    | YES| NULL
--   role          | text    | YES| NULL
--   tenant_id     | uuid    | NO | NULL
--   username      | text    | YES| NULL

-- =============================================================
-- 2. VERIFICAR RPC waiter_login
-- =============================================================

-- La función existe?
SELECT proname, prosecdef, provolatile
FROM pg_proc
WHERE proname = 'waiter_login' AND pronamespace = 'public'::regnamespace;

-- Esperado: 1 fila con proname = 'waiter_login', prosecdef = true

-- =============================================================
-- 3. CREAR UN CAMARERO DE PRUEBA
-- =============================================================

-- Asumimos que chalohiahmd1980@gmail.com existe en auth.users
-- y tiene un tenant.  Si no, ejecuta primero 07_vip_unlock.sql.

DO $$
DECLARE
    v_user_id   UUID;
    v_tenant_id UUID;
    v_test_username TEXT := 'testcam1';
    v_test_password TEXT := 'abc123';
    v_result     JSON;
BEGIN
    -- Buscar tenant del admin VIP
    SELECT id INTO v_tenant_id FROM public.tenants
    WHERE name LIKE '%Casablanca%' OR name LIKE '%Rincón%'
    ORDER BY created_at LIMIT 1;

    IF v_tenant_id IS NULL THEN
        -- Fallback: primer tenant activo
        SELECT id INTO v_tenant_id FROM public.tenants
        WHERE subscription_status = 'active'
        ORDER BY created_at LIMIT 1;
    END IF;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No hay tenant.  Ejecuta primero 07_vip_unlock.sql';
    END IF;

    RAISE NOTICE 'Tenant de prueba: %', v_tenant_id;

    -- Insertar camarero de prueba
    INSERT INTO public.tenant_users (tenant_id, name, role, is_active, pin_code)
    VALUES (v_tenant_id, 'Camarero Test', 'waiter', TRUE, '0000')
    RETURNING id INTO v_user_id;

    RAISE NOTICE 'Camarero creado: %', v_user_id;

    -- Asignar credenciales
    SELECT public.set_waiter_credentials(v_user_id, v_test_username, v_test_password) INTO v_result;
    RAISE NOTICE 'Resultado set_waiter_credentials: %', v_result;

    -- Probar login
    SELECT public.waiter_login(v_test_username, v_test_password) INTO v_result;
    RAISE NOTICE 'Resultado waiter_login: %', v_result;
END $$;

-- =============================================================
-- 4. VERIFICAR QUE EL LOGIN FUNCIONA
-- =============================================================

SELECT * FROM public.waiter_login('testcam1', 'abc123');

-- Esperado: { ok: true, tenant_id: ..., role: "waiter", name: "Camarero Test" }

-- =============================================================
-- 5. VERIFICAR QUE CONTRASEÑA INCORRECTA FALLA
-- =============================================================

SELECT * FROM public.waiter_login('testcam1', 'wrongpass');

-- Esperado: { ok: false, error: "Contraseña incorrecta" }

-- =============================================================
-- 6. VERIFICAR QUE USUARIO INEXISTENTE FALLA
-- =============================================================

SELECT * FROM public.waiter_login('noexiste', 'abc123');

-- Esperado: { ok: false, error: "Usuario no encontrado" }

-- =============================================================
-- 7. LIMPIAR: borrar el camarero de prueba
-- =============================================================

DELETE FROM public.tenant_users WHERE username = 'testcam1';

-- =============================================================
-- 8. VERIFICAR TABLAS orders Y order_items
-- =============================================================

SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders'
) AS has_orders,
EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'order_items'
) AS has_order_items;

-- Esperado: has_orders = true, has_order_items = true

-- =============================================================
-- 9. VERIFICAR POLÍTICAS RLS
-- =============================================================

SELECT
    tablename,
    policyname,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'order_items', 'tenant_users', 'products', 'dining_tables')
ORDER BY tablename, policyname;

-- Debe haber políticas para SELECT/INSERT/UPDATE/DELETE

-- =============================================================
-- 10. VERIFICAR REALTIME
-- =============================================================

SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('orders', 'order_items', 'tenant_users');

-- Esperado: rows para 'orders', 'order_items' (al menos)

-- =============================================================
-- RESULTADO ESPERADO
-- =============================================================
-- Si todos los bloques devuelven los resultados esperados,
-- el sistema está listo para la presentación.
-- =============================================================
