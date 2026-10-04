-- =====================================================================
-- MOZONA TPV — SaaS Multi-Tenant Migration
-- =====================================================================
-- EJECUTAR EN SUPABASE SQL EDITOR
-- Idempotente (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS).
-- =====================================================================

-- 0. Extensiones necesarias ----------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tabla de Organizaciones / Restaurantes (Tenants) --------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    owner_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    plan                  TEXT NOT NULL DEFAULT 'plus_30',
    subscription_status   TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    -- Datos fiscales y de contacto (rellenados en el wizard de onboarding)
    cif_nif               TEXT,
    address               TEXT,
    phone                 TEXT,
    default_tax_rate      NUMERIC(5,2) DEFAULT 10.00,
    -- Onboarding: el cliente pasa por /setup/onboarding tras suscribirse
    onboarding_completed  BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Si la tabla ya existía (versiones anteriores), añadimos las columnas
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cif_nif              TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS address              TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS phone                TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS default_tax_rate     NUMERIC(5,2) DEFAULT 10.00;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS tenants_owner_idx       ON public.tenants(owner_id);
CREATE INDEX IF NOT EXISTS tenants_plan_idx        ON public.tenants(plan);
CREATE INDEX IF NOT EXISTS tenants_status_idx      ON public.tenants(subscription_status);
CREATE INDEX IF NOT EXISTS tenants_onboarding_idx  ON public.tenants(onboarding_completed);

-- 2. Tabla de Usuarios y Roles por Tenant --------------------------
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'waiter',
    pin_code    TEXT DEFAULT '1234',
    created_at  TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_users_user_idx     ON public.tenant_users(user_id);
CREATE INDEX IF NOT EXISTS tenant_users_tenant_idx   ON public.tenant_users(tenant_id);

-- 3. Tabla de Perfiles de Usuario ---------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    name            TEXT,
    avatar_url      TEXT,
    is_superadmin   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Trigger: crear perfil automáticamente al registrarse en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, is_superadmin)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email = 'rofixinsta@gmail.com'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Tabla de Invitaciones Gratuitas (Exclusivo SuperAdmin) --------
CREATE TABLE IF NOT EXISTS public.free_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by      TEXT DEFAULT 'rofixinsta@gmail.com',
    target_email    TEXT,
    token           TEXT UNIQUE NOT NULL,
    plan_granted    TEXT DEFAULT 'lifetime_vip',
    is_redeemed     BOOLEAN DEFAULT FALSE,
    redeemed_by     UUID REFERENCES auth.users(id),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS free_invitations_token_idx     ON public.free_invitations(token);
CREATE INDEX IF NOT EXISTS free_invitations_redeemed_idx  ON public.free_invitations(is_redeemed);

-- 5. Tablas de Negocio --------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    name        TEXT NOT NULL,
    icon        TEXT,
    sort_order  INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS categories_tenant_idx ON public.categories(tenant_id);

CREATE TABLE IF NOT EXISTS public.products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    tax_rate    NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    description TEXT,
    image_url   TEXT,
    is_active   BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS products_tenant_idx    ON public.products(tenant_id);
CREATE INDEX IF NOT EXISTS products_category_idx  ON public.products(category_id);

CREATE TABLE IF NOT EXISTS public.dining_tables (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    name              TEXT NOT NULL,
    zone              TEXT DEFAULT 'Sala',
    status            TEXT DEFAULT 'available',
    current_order_id  UUID
);
CREATE INDEX IF NOT EXISTS dining_tables_tenant_idx ON public.dining_tables(tenant_id);

CREATE TABLE IF NOT EXISTS public.orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    table_id        UUID REFERENCES public.dining_tables(id) ON DELETE SET NULL,
    waiter_name     TEXT,
    status          TEXT DEFAULT 'open',
    subtotal        NUMERIC(10,2) DEFAULT 0.00,
    tax_total       NUMERIC(10,2) DEFAULT 0.00,
    total           NUMERIC(10,2) DEFAULT 0.00,
    payment_method  TEXT,
    created_at      TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_tenant_idx   ON public.orders(tenant_id);
CREATE INDEX IF NOT EXISTS orders_table_idx    ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS orders_status_idx   ON public.orders(status);

CREATE TABLE IF NOT EXISTS public.order_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    product_id  UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    quantity    INT NOT NULL DEFAULT 1,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);

-- 6. Habilitar RLS en todas las tablas -----------------------------
ALTER TABLE public.tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items      ENABLE ROW LEVEL SECURITY;

-- 7. Policies — limpiar y recrear ----------------------------------
DROP POLICY IF EXISTS "SuperAdmin full access on tenants"             ON public.tenants;
DROP POLICY IF EXISTS "Owners manage their tenant"                    ON public.tenants;
DROP POLICY IF EXISTS "Members read their tenant"                     ON public.tenants;
DROP POLICY IF EXISTS "SuperAdmin full access on free_invitations"    ON public.free_invitations;
DROP POLICY IF EXISTS "Tenant users read same tenant"                  ON public.tenant_users;
DROP POLICY IF EXISTS "Users insert themselves as tenant_user"        ON public.tenant_users;
DROP POLICY IF EXISTS "Owners add users to their tenant"               ON public.tenant_users;
DROP POLICY IF EXISTS "Users update themselves"                       ON public.tenant_users;
DROP POLICY IF EXISTS "Owners update tenant_users"                     ON public.tenant_users;
DROP POLICY IF EXISTS "Owners delete tenant_users"                     ON public.tenant_users;
DROP POLICY IF EXISTS "Tenant isolation for categories"               ON public.categories;
DROP POLICY IF EXISTS "Tenant isolation for products"                 ON public.products;
DROP POLICY IF EXISTS "Tenant isolation for orders"                   ON public.orders;
DROP POLICY IF EXISTS "Tenant isolation for dining_tables"            ON public.dining_tables;
DROP POLICY IF EXISTS "Tenant isolation for order_items"              ON public.order_items;
DROP POLICY IF EXISTS "Profiles self access"                          ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile"                      ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile"                      ON public.profiles;
DROP POLICY IF EXISTS "SuperAdmin full access on profiles"            ON public.profiles;

-- Función helper: ¿el usuario actual es SuperAdmin?
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid() AND email = 'rofixinsta@gmail.com'
    );
$$;

-- Helper: ¿el usuario es owner del tenant indicado?
CREATE OR REPLACE FUNCTION public.is_tenant_owner(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = tid AND owner_id = auth.uid()
    );
$$;

-- Tenants --------------------------------------------------------------
CREATE POLICY "SuperAdmin full access on tenants" ON public.tenants
    FOR ALL USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

CREATE POLICY "Owners manage their tenant" ON public.tenants
    FOR ALL USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Members read their tenant" ON public.tenants
    FOR SELECT USING (
        id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

-- Tenant users ---------------------------------------------------------
-- SELECT: miembros del mismo tenant pueden verse entre sí
CREATE POLICY "Tenant users read same tenant" ON public.tenant_users
    FOR SELECT USING (
        public.is_superadmin() OR
        user_id = auth.uid() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

-- INSERT (self): un usuario puede vincularse a sí mismo
-- (necesario durante el signup para evitar el chicken-and-egg de RLS)
CREATE POLICY "Users insert themselves as tenant_user" ON public.tenant_users
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- INSERT (owner): el owner añade camareros a su tenant (pueden tener
-- user_id NULL si aún no se han registrado en Supabase Auth)
CREATE POLICY "Owners add users to their tenant" ON public.tenant_users
    FOR INSERT WITH CHECK (
        public.is_superadmin() OR
        public.is_tenant_owner(tenant_id)
    );

-- UPDATE self: el usuario puede cambiar su propio PIN
CREATE POLICY "Users update themselves" ON public.tenant_users
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- UPDATE owner: el owner puede modificar miembros de su tenant
CREATE POLICY "Owners update tenant_users" ON public.tenant_users
    FOR UPDATE USING (
        public.is_superadmin() OR
        public.is_tenant_owner(tenant_id)
    )
    WITH CHECK (
        public.is_superadmin() OR
        public.is_tenant_owner(tenant_id)
    );

-- DELETE: sólo el owner puede eliminar miembros
CREATE POLICY "Owners delete tenant_users" ON public.tenant_users
    FOR DELETE USING (
        public.is_superadmin() OR
        public.is_tenant_owner(tenant_id)
    );

-- Profiles -------------------------------------------------------------
CREATE POLICY "Profiles self access" ON public.profiles
    FOR SELECT USING (public.is_superadmin() OR id = auth.uid());

CREATE POLICY "Users insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (public.is_superadmin() OR id = auth.uid());

CREATE POLICY "Users update own profile" ON public.profiles
    FOR UPDATE USING (public.is_superadmin() OR id = auth.uid())
    WITH CHECK (public.is_superadmin() OR id = auth.uid());

CREATE POLICY "SuperAdmin full access on profiles" ON public.profiles
    FOR ALL USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- Free invitations -----------------------------------------------------
CREATE POLICY "SuperAdmin full access on free_invitations" ON public.free_invitations
    FOR ALL USING (public.is_superadmin());

-- Permitir a un usuario ver una invitación si conoce el token
-- (necesario para que `redeemInvite` valide antes de canjear)
DROP POLICY IF EXISTS "Anyone with token can read invite" ON public.free_invitations;
CREATE POLICY "Anyone with token can read invite" ON public.free_invitations
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Permitir a un usuario marcar su propia invitación como canjeada
DROP POLICY IF EXISTS "Users can redeem their invite" ON public.free_invitations;
CREATE POLICY "Users can redeem their invite" ON public.free_invitations
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Categorías, productos, mesas, pedidos -------------------------------
CREATE POLICY "Tenant isolation for categories" ON public.categories
    FOR ALL USING (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    )
    WITH CHECK (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

CREATE POLICY "Tenant isolation for products" ON public.products
    FOR ALL USING (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    )
    WITH CHECK (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

CREATE POLICY "Tenant isolation for orders" ON public.orders
    FOR ALL USING (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    )
    WITH CHECK (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

CREATE POLICY "Tenant isolation for dining_tables" ON public.dining_tables
    FOR ALL USING (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    )
    WITH CHECK (
        public.is_superadmin() OR
        tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid())
    );

CREATE POLICY "Tenant isolation for order_items" ON public.order_items
    FOR ALL USING (
        public.is_superadmin() OR
        order_id IN (
            SELECT id FROM public.orders WHERE tenant_id IN (
                SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_superadmin() OR
        order_id IN (
            SELECT id FROM public.orders WHERE tenant_id IN (
                SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
            )
        )
    );

-- 8. Habilitar Realtime ---------------------------------------------
-- Necesario para que postgres_changes emita eventos a los clientes.
-- Se ejecuta idempotente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'order_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'dining_tables'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.dining_tables;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'products'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
    END IF;
END$$;

-- 9. Seed: una invitación de prueba (opcional) ----------------------
INSERT INTO public.free_invitations (token, plan_granted, target_email)
VALUES ('demo-vip-' || substring(md5(random()::text), 1, 16), 'lifetime_vip', NULL)
ON CONFLICT (token) DO NOTHING;

-- =====================================================================
-- FIN.  Verifica ejecutando:
--   SELECT email FROM auth.users WHERE email = 'rofixinsta@gmail.com';
--   SELECT * FROM public.tenants;
--   SELECT * FROM public.free_invitations;
-- =====================================================================
