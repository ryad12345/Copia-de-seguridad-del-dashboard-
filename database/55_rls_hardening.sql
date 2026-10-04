-- =====================================================================
-- MOZONA TPV — SQL #55: Endurecimiento RLS Total (CRÍTICO)
-- =====================================================================
-- Auditoría de seguridad 2026-09-25 detectó fugas masivas de datos:
-- • tenants, products, categories, dining_tables → accesibles sin auth
-- • email_verification_codes, invitation_codes, free_invitations → visibles
--   (¡incluso códigos OTP usados!)
--
-- Este script aplica Row Level Security estricto a las 7 tablas afectadas.
-- ANTES de aplicar, leer todo. Si alguna query falla, revertir con:
--   ALTER TABLE xxx DISABLE ROW LEVEL SECURITY;
-- =====================================================================

-- =====================================================================
-- 1. tenants — solo el owner puede leer SU tenant
-- =====================================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenants_public_read" ON tenants;
DROP POLICY IF EXISTS "tenants_authenticated_read" ON tenants;
DROP POLICY IF EXISTS "tenants_self_read" ON tenants;
DROP POLICY IF EXISTS "tenants_self_update" ON tenants;
DROP POLICY IF EXISTS "tenants_insert" ON tenants;
DROP POLICY IF EXISTS "tenants_delete" ON tenants;

-- Solo el owner del tenant puede VER su propio tenant
-- service_role bypass RLS automáticamente
CREATE POLICY "tenants_self_read" ON tenants
    FOR SELECT
    USING (
        owner_id = auth.uid()
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

-- Solo el owner puede modificar SU tenant
CREATE POLICY "tenants_self_update" ON tenants
    FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Insert lo hace el backend (service_role) durante signup
-- No permitimos INSERT desde cliente anónimo
-- (la política de SELECT cubre auth.uid() por seguridad)

-- =====================================================================
-- 2. products — solo el dueño del tenant puede leer
-- =====================================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_public_read" ON products;
DROP POLICY IF EXISTS "products_authenticated_read" ON products;
DROP POLICY IF EXISTS "products_owner_read" ON products;
DROP POLICY IF EXISTS "products_owner_write" ON products;

CREATE POLICY "products_owner_read" ON products
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "products_owner_write" ON products
    FOR ALL
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    );

-- =====================================================================
-- 3. categories — solo el dueño del tenant puede leer
-- =====================================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_public_read" ON categories;
DROP POLICY IF EXISTS "categories_owner_read" ON categories;
DROP POLICY IF EXISTS "categories_owner_write" ON categories;

CREATE POLICY "categories_owner_read" ON categories
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "categories_owner_write" ON categories
    FOR ALL
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    );

-- =====================================================================
-- 4. dining_tables — solo el dueño del tenant puede leer
-- =====================================================================
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dining_tables_public_read" ON dining_tables;
DROP POLICY IF EXISTS "dining_tables_owner_read" ON dining_tables;
DROP POLICY IF EXISTS "dining_tables_owner_write" ON dining_tables;

CREATE POLICY "dining_tables_owner_read" ON dining_tables
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
        OR auth.jwt() ->> 'email' = 'rofixinsta@gmail.com'
    );

CREATE POLICY "dining_tables_owner_write" ON dining_tables
    FOR ALL
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    );

-- =====================================================================
-- 5. email_verification_codes — BLOQUEO TOTAL (solo service_role)
-- =====================================================================
-- Esta tabla es CRÍTICA. Contiene códigos OTP activos y USADOS.
-- Un atacante NO debe poder ver ni siquiera códigos usados.
-- service_role bypasea RLS, así que las Edge Functions siguen funcionando.

ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evc_block_all" ON email_verification_codes;
DROP POLICY IF EXISTS "evc_owner_read" ON email_verification_codes;

-- Política: denegar TODO acceso desde cliente autenticado o anónimo
-- service_role (usado por auth-otp Edge Function) bypasea RLS automáticamente
CREATE POLICY "evc_block_all" ON email_verification_codes
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- =====================================================================
-- 6. invitation_codes — BLOQUEO TOTAL (solo service_role)
-- =====================================================================
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ic_block_all" ON invitation_codes;
DROP POLICY IF EXISTS "ic_public_read" ON invitation_codes;

CREATE POLICY "ic_block_all" ON invitation_codes
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- =====================================================================
-- 7. free_invitations — BLOQUEO TOTAL (solo service_role)
-- =====================================================================
ALTER TABLE free_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fi_block_all" ON free_invitations;
DROP POLICY IF EXISTS "fi_public_read" ON free_invitations;

CREATE POLICY "fi_block_all" ON free_invitations
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- =====================================================================
-- Verificación post-aplicación
-- =====================================================================

DO $$
DECLARE
    rec RECORD;
    missing_rls TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR rec IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            'tenants', 'products', 'categories', 'dining_tables',
            'email_verification_codes', 'invitation_codes', 'free_invitations'
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = rec.tablename
            AND c.relrowsecurity = true
        ) THEN
            missing_rls := array_append(missing_rls, rec.tablename);
        END IF;
    END LOOP;

    IF array_length(missing_rls, 1) > 0 THEN
        RAISE WARNING 'Tablas SIN RLS habilitado: %', array_to_string(missing_rls, ', ');
    ELSE
        RAISE NOTICE '✅ RLS habilitado en las 7 tablas críticas';
    END IF;
END $$;

-- =====================================================================
-- TEST POST-DEPLOY (ejecutar manualmente desde SQL Editor)
-- =====================================================================
-- Esto debería devolver VACÍO (no hay datos filtrados):
--
-- SELECT * FROM tenants;
-- SELECT * FROM products;
-- SELECT * FROM categories;
-- SELECT * FROM dining_tables;
-- SELECT * FROM email_verification_codes;
-- SELECT * FROM invitation_codes;
-- SELECT * FROM free_invitations;
--
-- Si todo está vacío, RLS funciona correctamente con anon key.
-- Las Edge Functions (con service_role) siguen accediendo normalmente.
-- =====================================================================
