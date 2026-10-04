-- =====================================================================
-- MOZONA TPV — database/33_strict_rls.sql (v3.4.9)
-- =====================================================================
-- RLS ESTRICTO: Cada fila debe pertenecer al tenant del usuario.
-- Cero confianza en el frontend. Solo Supabase valida.
-- =====================================================================

-- ★ Helper: ¿el usuario es superadmin? (rofixinsta@gmail.com)
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND email = 'rofixinsta@gmail.com'
    );
$$;

-- ★ Helper: ¿el usuario es owner de este tenant?
CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_tenant_id
        AND owner_id = auth.uid()
    );
$$;

-- ★ Helper: ¿el usuario pertenece a este tenant (es staff)?
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = p_tenant_id
        AND user_id = auth.uid()
    );
$$;

-- ★ Helper combinado: ¿el usuario tiene acceso al tenant?
CREATE OR REPLACE FUNCTION public.has_tenant_access(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT public.is_superadmin()
        OR public.is_tenant_owner(p_tenant_id)
        OR public.is_tenant_member(p_tenant_id);
$$;

-- =====================================================================
-- PRODUCTS
-- =====================================================================
DROP POLICY IF EXISTS "products_all"           ON public.products;
DROP POLICY IF EXISTS "products_select_all"    ON public.products;
DROP POLICY IF EXISTS "products_insert_auth"   ON public.products;
DROP POLICY IF EXISTS "products_update_auth"   ON public.products;
DROP POLICY IF EXISTS "products_delete_owner"  ON public.products;
DROP POLICY IF EXISTS "products_select_own"    ON public.products;
DROP POLICY IF EXISTS "products_modify_own"    ON public.products;

CREATE POLICY "products_select_own" ON public.products
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "products_modify_own" ON public.products
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- CATEGORIES
-- =====================================================================
DROP POLICY IF EXISTS "categories_all"           ON public.categories;
DROP POLICY IF EXISTS "categories_select_all"    ON public.categories;
DROP POLICY IF EXISTS "categories_insert_auth"   ON public.categories;
DROP POLICY IF EXISTS "categories_update_auth"   ON public.categories;
DROP POLICY IF EXISTS "categories_delete_owner"  ON public.categories;
DROP POLICY IF EXISTS "categories_select_own"    ON public.categories;
DROP POLICY IF EXISTS "categories_modify_own"    ON public.categories;

CREATE POLICY "categories_select_own" ON public.categories
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "categories_modify_own" ON public.categories
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- DINING TABLES
-- =====================================================================
DROP POLICY IF EXISTS "dining_tables_all"           ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_all"    ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_insert_auth"   ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_update_auth"   ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_own"    ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_modify_own"    ON public.dining_tables;

CREATE POLICY "dining_tables_select_own" ON public.dining_tables
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "dining_tables_modify_own" ON public.dining_tables
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- ORDERS
-- =====================================================================
DROP POLICY IF EXISTS "orders_all"           ON public.orders;
DROP POLICY IF EXISTS "orders_select_all"    ON public.orders;
DROP POLICY IF EXISTS "orders_insert_auth"   ON public.orders;
DROP POLICY IF EXISTS "orders_update_auth"   ON public.orders;
DROP POLICY IF EXISTS "orders_select_own"    ON public.orders;
DROP POLICY IF EXISTS "orders_modify_own"    ON public.orders;

CREATE POLICY "orders_select_own" ON public.orders
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "orders_modify_own" ON public.orders
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- ORDER ITEMS
-- =====================================================================
DROP POLICY IF EXISTS "order_items_all"           ON public.order_items;
DROP POLICY IF EXISTS "order_items_select_all"    ON public.order_items;
DROP POLICY IF EXISTS "order_items_insert_auth"   ON public.order_items;
DROP POLICY IF EXISTS "order_items_update_auth"   ON public.order_items;
DROP POLICY IF EXISTS "order_items_select_own"    ON public.order_items;
DROP POLICY IF EXISTS "order_items_modify_own"    ON public.order_items;

CREATE POLICY "order_items_select_own" ON public.order_items
    FOR SELECT TO authenticated
    USING (
        public.has_tenant_access(tenant_id)
        OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND public.has_tenant_access(o.tenant_id)
        )
    );

CREATE POLICY "order_items_modify_own" ON public.order_items
    FOR ALL TO authenticated
    USING (
        public.has_tenant_access(tenant_id)
        OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND public.has_tenant_access(o.tenant_id)
        )
    )
    WITH CHECK (
        public.has_tenant_access(tenant_id)
        OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND public.has_tenant_access(o.tenant_id)
        )
    );

-- =====================================================================
-- OPEN ORDERS (tickets en curso)
-- =====================================================================
DROP POLICY IF EXISTS "open_orders_all"           ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_select_all"    ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_insert_auth"   ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_update_auth"   ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_select_own"    ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_modify_own"    ON public.open_orders;

CREATE POLICY "open_orders_select_own" ON public.open_orders
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "open_orders_modify_own" ON public.open_orders
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- TENANT SETTINGS
-- =====================================================================
DROP POLICY IF EXISTS "tenant_settings_all"           ON public.tenant_settings;
DROP POLICY IF EXISTS "tenant_settings_select_own"    ON public.tenant_settings;
DROP POLICY IF EXISTS "tenant_settings_modify_own"    ON public.tenant_settings;

CREATE POLICY "tenant_settings_select_own" ON public.tenant_settings
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "tenant_settings_modify_own" ON public.tenant_settings
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- TICKET SETTINGS (legacy)
-- =====================================================================
DROP POLICY IF EXISTS "ticket_settings_all"           ON public.ticket_settings;
DROP POLICY IF EXISTS "ticket_settings_select_own"    ON public.ticket_settings;
DROP POLICY IF EXISTS "ticket_settings_modify_own"    ON public.ticket_settings;

CREATE POLICY "ticket_settings_select_own" ON public.ticket_settings
    FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));

CREATE POLICY "ticket_settings_modify_own" ON public.ticket_settings
    FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- =====================================================================
-- TENANTS (solo owner puede ver/modificar)
-- =====================================================================
DROP POLICY IF EXISTS "tenants_all"           ON public.tenants;
DROP POLICY IF EXISTS "tenants_select_own"    ON public.tenants;
DROP POLICY IF EXISTS "tenants_modify_own"    ON public.tenants;

CREATE POLICY "tenants_select_own" ON public.tenants
    FOR SELECT TO authenticated
    USING (
        owner_id = auth.uid()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.tenant_id = tenants.id
            AND tu.user_id = auth.uid()
        )
    );

CREATE POLICY "tenants_modify_own" ON public.tenants
    FOR ALL TO authenticated
    USING (owner_id = auth.uid() OR public.is_superadmin())
    WITH CHECK (owner_id = auth.uid() OR public.is_superadmin());

-- =====================================================================
-- TENANT USERS (staff del tenant)
-- =====================================================================
DROP POLICY IF EXISTS "tenant_users_all"           ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_select_own"    ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_modify_own"    ON public.tenant_users;

CREATE POLICY "tenant_users_select_own" ON public.tenant_users
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_users.tenant_id
            AND t.owner_id = auth.uid()
        )
    );

CREATE POLICY "tenant_users_modify_own" ON public.tenant_users
    FOR ALL TO authenticated
    USING (
        public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_users.tenant_id
            AND t.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_users.tenant_id
            AND t.owner_id = auth.uid()
        )
    );

-- =====================================================================
-- PROFILES (perfil público del usuario)
-- =====================================================================
DROP POLICY IF EXISTS "profiles_all"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own"    ON public.profiles;
DROP POLICY IF EXISTS "profiles_modify_own"    ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_superadmin());

CREATE POLICY "profiles_modify_own" ON public.profiles
    FOR ALL TO authenticated
    USING (id = auth.uid() OR public.is_superadmin())
    WITH CHECK (id = auth.uid() OR public.is_superadmin());

COMMENT ON FUNCTION public.has_tenant_access(UUID) IS
    'Verifica si el usuario actual tiene acceso al tenant (owner, staff o superadmin)';
