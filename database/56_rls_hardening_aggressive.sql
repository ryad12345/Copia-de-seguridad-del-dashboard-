-- =====================================================================
-- MOZONA TPV — SQL #56: Endurecimiento RLS AGRESIVO
-- =====================================================================
-- El SQL #55 NO fue suficiente porque había políticas pre-existentes
-- con USING: true que permitían acceso público. Este script las
-- ELIMINA TODAS antes de reaplicar las nuevas.
-- =====================================================================

DO $$
DECLARE
    r RECORD;
    tables_to_lock TEXT[] := ARRAY[
        'tenants', 'products', 'categories', 'dining_tables',
        'email_verification_codes', 'invitation_codes', 'free_invitations'
    ];
BEGIN
    -- 1. Deshabilitar RLS temporalmente
    FOR r IN SELECT unnest(tables_to_lock) AS tbl LOOP
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.tbl);
    END LOOP;

    RAISE NOTICE '✓ RLS deshabilitado temporalmente en las 7 tablas';

    -- 2. Eliminar TODAS las políticas existentes
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = ANY(tables_to_lock)
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
            r.policyname, r.schemaname, r.tablename);
    END LOOP;

    RAISE NOTICE '✓ Todas las políticas antiguas eliminadas';

    -- 3. Reactivar RLS
    FOR r IN SELECT unnest(tables_to_lock) AS tbl LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    END LOOP;

    RAISE NOTICE '✓ RLS reactivado en las 7 tablas';
END $$;

-- =====================================================================
-- 4. CREAR POLÍTICAS ESTRICTAS (las únicas que deben existir)
-- =====================================================================

-- tenants
CREATE POLICY "tenants_self_read" ON tenants
    FOR SELECT USING (
        owner_id = auth.uid()
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "tenants_self_update" ON tenants
    FOR UPDATE USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- products
CREATE POLICY "products_owner_read" ON products
    FOR SELECT USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "products_owner_write" ON products
    FOR ALL USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    ) WITH CHECK (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- categories
CREATE POLICY "categories_owner_read" ON categories
    FOR SELECT USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "categories_owner_write" ON categories
    FOR ALL USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    ) WITH CHECK (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- dining_tables
CREATE POLICY "dining_tables_owner_read" ON dining_tables
    FOR SELECT USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "dining_tables_owner_write" ON dining_tables
    FOR ALL USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    ) WITH CHECK (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- email_verification_codes: BLOQUEO TOTAL
CREATE POLICY "evc_block_all" ON email_verification_codes
    FOR ALL USING (false) WITH CHECK (false);

-- invitation_codes: BLOQUEO TOTAL
CREATE POLICY "ic_block_all" ON invitation_codes
    FOR ALL USING (false) WITH CHECK (false);

-- free_invitations: BLOQUEO TOTAL
CREATE POLICY "fi_block_all" ON free_invitations
    FOR ALL USING (false) WITH CHECK (false);

-- =====================================================================
-- VERIFICACIÓN FINAL
-- =====================================================================

DO $$
DECLARE
    r RECORD;
    counts INT;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            'tenants', 'products', 'categories', 'dining_tables',
            'email_verification_codes', 'invitation_codes', 'free_invitations'
        )
    LOOP
        EXECUTE format('SELECT count(*) FROM pg_policies WHERE tablename = %L', r.tablename)
        INTO counts;
        RAISE NOTICE 'Tabla %: % políticas', r.tablename, counts;
    END LOOP;
END $$;
