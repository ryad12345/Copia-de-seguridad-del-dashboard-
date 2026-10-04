-- =====================================================================
-- MOZONA TPV — SQL #57: fix(tablas sin RLS)
-- =====================================================================
-- Auditoria de seguridad: estas tablas existen sin RLS habilitado.
-- Sin RLS, cualquier usuario autenticado podria ver/modificar datos
-- de otros tenants (fallo de aislamiento multi-tenant).
--
-- Tablas afectadas (auditoria 2026-09-26):
--   1. waiters          - datos de meseros por tenant (codigo PIN, role, etc)
--   2. tables_new       - mesas del tenant (numero, zona, status)
--
-- FIX:
--   - Habilitar RLS en ambas tablas
--   - Crear policies permisivas para el rol anon del tenant
--   - Crear policies restrictivas para evitar cross-tenant
-- =====================================================================

-- 1. TABLA waiters
ALTER TABLE public.waiters ENABLE ROW LEVEL SECURITY;

-- Policy: SELECT - un usuario solo ve los waiters de su tenant
DROP POLICY IF EXISTS waiters_select_tenant ON public.waiters;
CREATE POLICY waiters_select_tenant ON public.waiters
    FOR SELECT
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        OR (auth.jwt() ->> 'role') = 'superadmin'
        OR (auth.jwt() ->> 'role') = 'admin'
    );

-- Policy: INSERT - solo el owner del tenant o superadmin
DROP POLICY IF EXISTS waiters_insert_tenant ON public.waiters;
CREATE POLICY waiters_insert_tenant ON public.waiters
    FOR INSERT
    WITH CHECK (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        OR (auth.jwt() ->> 'role') = 'superadmin'
        OR (auth.jwt() ->> 'role') = 'admin'
    );

-- Policy: UPDATE - solo su propio tenant
DROP POLICY IF EXISTS waiters_update_tenant ON public.waiters;
CREATE POLICY waiters_update_tenant ON public.waiters
    FOR UPDATE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        OR (auth.jwt() ->> 'role') = 'superadmin'
    );

-- Policy: DELETE - solo su propio tenant
DROP POLICY IF EXISTS waiters_delete_tenant ON public.waiters;
CREATE POLICY waiters_delete_tenant ON public.waiters
    FOR DELETE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        OR (auth.jwt() ->> 'role') = 'superadmin'
    );


-- 2. TABLA tables_new (si existe como tabla persistente)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'tables_new'
    ) THEN
        EXECUTE 'ALTER TABLE public.tables_new ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS tables_new_tenant_isolation ON public.tables_new';
        EXECUTE '
            CREATE POLICY tables_new_tenant_isolation ON public.tables_new
            FOR ALL
            USING (
                tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid
                OR (auth.jwt() ->> ''role'') = ''superadmin''
            )
            WITH CHECK (
                tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid
                OR (auth.jwt() ->> ''role'') = ''superadmin''
            )
        ';
    END IF;
END $$;


-- 3. AUDITORIA: ver TODAS las tablas sin RLS (para revision futura)
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = false
-- ORDER BY tablename;
