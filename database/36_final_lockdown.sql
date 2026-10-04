-- =====================================================================
-- MOZONA TPV — database/36_final_lockdown.sql (v3.4.12)
-- =====================================================================
-- SQL UNICO DEFINITIVO: Reactiva RLS con TODAS las politicas estrictas
-- + bypass quirúrgico para VIP chalohiahmd1980@gmail.com.
--
-- EJECUTAR EN SUPABASE SQL EDITOR (1 sola vez, tarda ~3 segundos)
-- ES IDEMPOTENTE: puede ejecutarse varias veces sin romper nada.
--
-- ANTES: cliente desactivó RLS temporalmente para que chalohiahmd
--        pudiera ver sus productos.
-- AHORA: reactivamos RLS con whitelist especifica para el VIP.
--        El chalohiahmd sigue viendo TODO sin interruption.
--        El resto sigue protegido.
-- =====================================================================

-- ★ 1) HELPERS DE SEGURIDAD (necesarios antes que las policies)
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

-- ★ v3.4.12: Helper principal con whitelist VIP
CREATE OR REPLACE FUNCTION public.has_tenant_access(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    -- Acceso si:
    --   1) Es superadmin
    --   2) Es owner del tenant
    --   3) Es staff (tenant_users)
    --   4) Es VIP autorizado (lista blanca explicita)
    SELECT
        public.is_superadmin()
        OR public.is_tenant_owner(p_tenant_id)
        OR public.is_tenant_member(p_tenant_id)
        OR EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND email IN ('chalohiahmd1980@gmail.com')
        );
$$;

-- ★ 2) REACTIVAR RLS EN TODAS LAS TABLAS
ALTER TABLE public.tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_invitations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_onboarding    ENABLE ROW LEVEL SECURITY;

-- ★ 3) POLITICAS PARA TABLAS OPERACIONALES (drop + create idempotente)

-- PRODUCTS
DROP POLICY IF EXISTS "products_all" ON public.products;
DROP POLICY IF EXISTS "products_select_all" ON public.products;
DROP POLICY IF EXISTS "products_insert_auth" ON public.products;
DROP POLICY IF EXISTS "products_update_auth" ON public.products;
DROP POLICY IF EXISTS "products_delete_owner" ON public.products;
DROP POLICY IF EXISTS "products_select_own" ON public.products;
DROP POLICY IF EXISTS "products_modify_own" ON public.products;
CREATE POLICY "products_select_own" ON public.products FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "products_modify_own" ON public.products FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- CATEGORIES
DROP POLICY IF EXISTS "categories_all" ON public.categories;
DROP POLICY IF EXISTS "categories_select_all" ON public.categories;
DROP POLICY IF EXISTS "categories_insert_auth" ON public.categories;
DROP POLICY IF EXISTS "categories_select_own" ON public.categories;
DROP POLICY IF EXISTS "categories_modify_own" ON public.categories;
CREATE POLICY "categories_select_own" ON public.categories FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "categories_modify_own" ON public.categories FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- DINING_TABLES
DROP POLICY IF EXISTS "dining_tables_all" ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_select_own" ON public.dining_tables;
DROP POLICY IF EXISTS "dining_tables_modify_own" ON public.dining_tables;
CREATE POLICY "dining_tables_select_own" ON public.dining_tables FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "dining_tables_modify_own" ON public.dining_tables FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- ORDERS
DROP POLICY IF EXISTS "orders_all" ON public.orders;
DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
DROP POLICY IF EXISTS "orders_modify_own" ON public.orders;
CREATE POLICY "orders_select_own" ON public.orders FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "orders_modify_own" ON public.orders FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- ORDER_ITEMS (sin tenant_id físico: via orders.tenant_id)
DROP POLICY IF EXISTS "order_items_all" ON public.order_items;
DROP POLICY IF EXISTS "order_items_select_own" ON public.order_items;
DROP POLICY IF EXISTS "order_items_modify_own" ON public.order_items;
CREATE POLICY "order_items_select_own" ON public.order_items FOR SELECT TO authenticated
    USING (
        public.has_tenant_access(tenant_id)
        OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND public.has_tenant_access(o.tenant_id)
        )
    );
CREATE POLICY "order_items_modify_own" ON public.order_items FOR ALL TO authenticated
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

-- OPEN_ORDERS
DROP POLICY IF EXISTS "open_orders_all" ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_select_own" ON public.open_orders;
DROP POLICY IF EXISTS "open_orders_modify_own" ON public.open_orders;
CREATE POLICY "open_orders_select_own" ON public.open_orders FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "open_orders_modify_own" ON public.open_orders FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- TENANT_SETTINGS
DROP POLICY IF EXISTS "tenant_settings_all" ON public.tenant_settings;
DROP POLICY IF EXISTS "tenant_settings_select_own" ON public.tenant_settings;
DROP POLICY IF EXISTS "tenant_settings_modify_own" ON public.tenant_settings;
CREATE POLICY "tenant_settings_select_own" ON public.tenant_settings FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "tenant_settings_modify_own" ON public.tenant_settings FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- TICKET_SETTINGS (legacy)
DROP POLICY IF EXISTS "ticket_settings_all" ON public.ticket_settings;
DROP POLICY IF EXISTS "ticket_settings_select_own" ON public.ticket_settings;
DROP POLICY IF EXISTS "ticket_settings_modify_own" ON public.ticket_settings;
CREATE POLICY "ticket_settings_select_own" ON public.ticket_settings FOR SELECT TO authenticated
    USING (public.has_tenant_access(tenant_id));
CREATE POLICY "ticket_settings_modify_own" ON public.ticket_settings FOR ALL TO authenticated
    USING (public.has_tenant_access(tenant_id))
    WITH CHECK (public.has_tenant_access(tenant_id));

-- TENANTS
DROP POLICY IF EXISTS "tenants_all" ON public.tenants;
DROP POLICY IF EXISTS "tenants_select_own" ON public.tenants;
DROP POLICY IF EXISTS "tenants_modify_own" ON public.tenants;
CREATE POLICY "tenants_select_own" ON public.tenants FOR SELECT TO authenticated
    USING (
        owner_id = auth.uid()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND email IN ('chalohiahmd1980@gmail.com')
        )
        OR EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.tenant_id = tenants.id
            AND tu.user_id = auth.uid()
        )
    );
CREATE POLICY "tenants_modify_own" ON public.tenants FOR ALL TO authenticated
    USING (owner_id = auth.uid() OR public.is_superadmin())
    WITH CHECK (owner_id = auth.uid() OR public.is_superadmin());

-- TENANT_USERS
DROP POLICY IF EXISTS "tenant_users_all" ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_select_own" ON public.tenant_users;
DROP POLICY IF EXISTS "tenant_users_modify_own" ON public.tenant_users;
CREATE POLICY "tenant_users_select_own" ON public.tenant_users FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = tenant_users.tenant_id
            AND t.owner_id = auth.uid()
        )
    );
CREATE POLICY "tenant_users_modify_own" ON public.tenant_users FOR ALL TO authenticated
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

-- PROFILES
DROP POLICY IF EXISTS "profiles_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_modify_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_superadmin());
CREATE POLICY "profiles_modify_own" ON public.profiles FOR ALL TO authenticated
    USING (id = auth.uid() OR public.is_superadmin())
    WITH CHECK (id = auth.uid() OR public.is_superadmin());

-- INVITATION_CODES
DROP POLICY IF EXISTS "invitation_codes_all" ON public.invitation_codes;
DROP POLICY IF EXISTS "invitation_codes_select_active" ON public.invitation_codes;
DROP POLICY IF EXISTS "invitation_codes_modify_admin" ON public.invitation_codes;
CREATE POLICY "invitation_codes_select_active" ON public.invitation_codes FOR SELECT TO authenticated
    USING (
        is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR current_uses < max_uses)
    );
CREATE POLICY "invitation_codes_modify_admin" ON public.invitation_codes FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- ADMIN_NOTIFICATIONS (solo superadmin)
DROP POLICY IF EXISTS "admin_notifications_all" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_select_admin" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_modify_admin" ON public.admin_notifications;
CREATE POLICY "admin_notifications_select_admin" ON public.admin_notifications FOR SELECT TO authenticated
    USING (public.is_superadmin());
CREATE POLICY "admin_notifications_modify_admin" ON public.admin_notifications FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- FREE_INVITATIONS
DROP POLICY IF EXISTS "free_invitations_all" ON public.free_invitations;
DROP POLICY IF EXISTS "free_invitations_select" ON public.free_invitations;
DROP POLICY IF EXISTS "free_invitations_modify" ON public.free_invitations;
CREATE POLICY "free_invitations_select" ON public.free_invitations FOR SELECT TO authenticated
    USING (is_active = TRUE AND expires_at > NOW());
CREATE POLICY "free_invitations_modify" ON public.free_invitations FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- LEADS_ONBOARDING (formulario publico)
DROP POLICY IF EXISTS "leads_onboarding_all" ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_insert" ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_select" ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_modify" ON public.leads_onboarding;
CREATE POLICY "leads_onboarding_insert" ON public.leads_onboarding FOR INSERT TO anon, authenticated
    WITH CHECK (TRUE);
CREATE POLICY "leads_onboarding_select" ON public.leads_onboarding FOR SELECT TO authenticated
    USING (public.is_superadmin());
CREATE POLICY "leads_onboarding_modify" ON public.leads_onboarding FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

COMMENT ON FUNCTION public.has_tenant_access(UUID) IS
    'Verifica acceso: superadmin, owner, staff, o VIP autorizado (chalohiahmd1980@gmail.com)';
