-- =====================================================================
-- MOZONA TPV — Políticas RLS restrictivas (v4.0.7-rls-strict)
-- =====================================================================
-- Activar RLS en todas las tablas críticas + políticas que solo permiten
-- escritura a usuarios autenticados y propietarios del tenant.
--
-- EJECUTAR EN: Supabase Dashboard → SQL Editor → New query
-- Pegar TODO este contenido y ejecutar (Ctrl+Enter o botón RUN)
-- =====================================================================

-- ★ Activar RLS en todas las tablas
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ★ Eliminar políticas antiguas si existen (idempotente)
DROP POLICY IF EXISTS "Public read tenants" ON tenants;
DROP POLICY IF EXISTS "Owner manage tenants" ON tenants;
DROP POLICY IF EXISTS "Public read categories" ON categories;
DROP POLICY IF EXISTS "Owner manage categories" ON categories;
DROP POLICY IF EXISTS "Public read products" ON products;
DROP POLICY IF EXISTS "Owner manage products" ON products;
DROP POLICY IF EXISTS "Public read dining_tables" ON dining_tables;
DROP POLICY IF EXISTS "Owner manage dining_tables" ON dining_tables;
DROP POLICY IF EXISTS "Self read tenant_users" ON tenant_users;
DROP POLICY IF EXISTS "Owner manage tenant_users" ON tenant_users;
DROP POLICY IF EXISTS "Owner manage orders" ON orders;
DROP POLICY IF EXISTS "Owner read orders" ON orders;
DROP POLICY IF EXISTS "Owner manage order_items" ON order_items;
DROP POLICY IF EXISTS "Owner read order_items" ON order_items;

-- ★ Whitelist de emails VIP que tienen bypass total
-- (chalohiahmd y rofixinsta pueden leer/escribir TODOS los tenants)
CREATE OR REPLACE FUNCTION is_vip_email() RETURNS BOOLEAN AS $$
BEGIN
    RETURN (
        auth.jwt() ->> 'email' IN (
            'chalohiahmd1980@gmail.com',
            'rofixinsta@gmail.com'
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ★ Whitelist por owner_id (los VIP son owners de sus tenants)
CREATE OR REPLACE FUNCTION is_tenant_owner(p_tenant_id UUID) RETURNS BOOLEAN AS $$
BEGIN
    IF is_vip_email() THEN RETURN TRUE; END IF;

    RETURN EXISTS (
        SELECT 1 FROM tenants
        WHERE id = p_tenant_id
        AND owner_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================================================
-- POLÍTICAS: tenants
-- =====================================================================
-- Lectura publica (anon puede ver todos los tenants, necesario para login)
CREATE POLICY "Public read tenants" ON tenants
    FOR SELECT
    USING (true);

-- Solo el owner del tenant o VIP puede modificar
CREATE POLICY "Owner manage tenants" ON tenants
    FOR ALL
    USING (is_vip_email() OR owner_id = auth.uid())
    WITH CHECK (is_vip_email() OR owner_id = auth.uid());

-- =====================================================================
-- POLÍTICAS: categories
-- =====================================================================
-- Lectura publica (necesario para mostrar productos en la carta)
CREATE POLICY "Public read categories" ON categories
    FOR SELECT
    USING (true);

-- Solo owner del tenant o VIP puede modificar categorias
CREATE POLICY "Owner manage categories" ON categories
    FOR ALL
    USING (is_vip_email() OR is_tenant_owner(tenant_id))
    WITH CHECK (is_vip_email() OR is_tenant_owner(tenant_id));

-- =====================================================================
-- POLÍTICAS: products
-- =====================================================================
-- Lectura publica (la carta es visible para camareros)
CREATE POLICY "Public read products" ON products
    FOR SELECT
    USING (true);

-- Solo owner del tenant o VIP puede modificar productos
CREATE POLICY "Owner manage products" ON products
    FOR ALL
    USING (is_vip_email() OR is_tenant_owner(tenant_id))
    WITH CHECK (is_vip_email() OR is_tenant_owner(tenant_id));

-- =====================================================================
-- POLÍTICAS: dining_tables
-- =====================================================================
-- Lectura publica
CREATE POLICY "Public read dining_tables" ON dining_tables
    FOR SELECT
    USING (true);

-- Solo owner del tenant o VIP puede modificar mesas
CREATE POLICY "Owner manage dining_tables" ON dining_tables
    FOR ALL
    USING (is_vip_email() OR is_tenant_owner(tenant_id))
    WITH CHECK (is_vip_email() OR is_tenant_owner(tenant_id));

-- =====================================================================
-- POLÍTICAS: tenant_users
-- =====================================================================
-- Solo el propio user o el owner del tenant puede ver staff
CREATE POLICY "Self read tenant_users" ON tenant_users
    FOR SELECT
    USING (is_vip_email() OR user_id = auth.uid() OR is_tenant_owner(tenant_id));

-- Solo owner del tenant o VIP puede gestionar staff
CREATE POLICY "Owner manage tenant_users" ON tenant_users
    FOR ALL
    USING (is_vip_email() OR is_tenant_owner(tenant_id))
    WITH CHECK (is_vip_email() OR is_tenant_owner(tenant_id));

-- =====================================================================
-- POLÍTICAS: orders
-- =====================================================================
-- Lectura: solo owner del tenant o VIP
CREATE POLICY "Owner read orders" ON orders
    FOR SELECT
    USING (is_vip_email() OR is_tenant_owner(tenant_id));

-- Escritura: solo owner del tenant o VIP
CREATE POLICY "Owner manage orders" ON orders
    FOR ALL
    USING (is_vip_email() OR is_tenant_owner(tenant_id))
    WITH CHECK (is_vip_email() OR is_tenant_owner(tenant_id));

-- =====================================================================
-- POLÍTICAS: order_items
-- =====================================================================
-- Lectura: solo owner del tenant o VIP (vía orders.tenant_id)
CREATE POLICY "Owner read order_items" ON order_items
    FOR SELECT
    USING (
        is_vip_email() OR EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_items.order_id
            AND is_tenant_owner(orders.tenant_id)
        )
    );

-- Escritura: solo owner del tenant o VIP
CREATE POLICY "Owner manage order_items" ON order_items
    FOR ALL
    USING (
        is_vip_email() OR EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_items.order_id
            AND is_tenant_owner(orders.tenant_id)
        )
    )
    WITH CHECK (
        is_vip_email() OR EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_items.order_id
            AND is_tenant_owner(orders.tenant_id)
        )
    );

-- =====================================================================
-- VERIFICACIÓN
-- =====================================================================
-- Las políticas permiten:
--   ✓ ANON puede LEER (SELECT) todas las tablas (necesario para login)
--   ✓ ANON NO puede ESCRIBIR (INSERT/UPDATE/DELETE) sin ser VIP o owner
--   ✓ VIP (chalohiahmd, rofixinsta) bypass total via JWT email
--   ✓ Owner del tenant puede gestionar SU tenant
--
-- Test rápido después de aplicar:
--   DELETE FROM products WHERE id = 'test'    -- debe fallar (anon)
--   SELECT * FROM products LIMIT 1            -- debe funcionar
-- =====================================================================
