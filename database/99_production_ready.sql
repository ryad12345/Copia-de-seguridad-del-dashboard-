-- =====================================================================
-- MOZONA TPV — 99_production_ready.sql
-- =====================================================================
-- SCRIPT MAESTRO CONSOLIDADO PARA PRODUCCIÓN
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
-- Es idempotente: se puede re-ejecutar sin romper nada.
--
-- Este script:
--   1. Crea/actualiza TODAS las tablas (tenants, products, categories,
--      orders, order_items, open_orders, tenant_users, invitation_codes)
--   2. Habilita RLS con policies no bloqueantes para authenticated
--   3. Crea RPCs esenciales con SECURITY DEFINER
--   4. Inserta datos seed (29 productos) si no existen
--   5. Configura Realtime publication
--   6. Recarga PostgREST
-- =====================================================================

-- ============================================================
-- 0. Extensiones
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Tabla TENANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT,
    cif_nif             TEXT,
    address             TEXT,
    phone               TEXT,
    owner_id            UUID,
    plan                TEXT NOT NULL DEFAULT 'free',
    subscription_status TEXT NOT NULL DEFAULT 'trialing',
    is_superadmin       BOOLEAN NOT NULL DEFAULT FALSE,
    ticket_header_msg   TEXT,
    ticket_footer_msg   TEXT DEFAULT '¡Gracias por su visita!',
    ticket_show_tax     BOOLEAN NOT NULL DEFAULT TRUE,
    default_series      TEXT DEFAULT 'T26',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_owner ON public.tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(subscription_status);

-- ============================================================
-- 2. Tabla CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    slug       TEXT,
    color      TEXT,
    icon       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_tenant ON public.categories(tenant_id);

-- ============================================================
-- 3. Tabla PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    category_id  UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    price        NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tax_rate     NUMERIC(5, 2) NOT NULL DEFAULT 10,
    category     TEXT,
    image_url    TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON public.products(tenant_id, category, sort_order);

-- ============================================================
-- 4. Tabla DINING_TABLES (mesas)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dining_tables (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    zone       TEXT,
    seats      INTEGER NOT NULL DEFAULT 4,
    status     TEXT NOT NULL DEFAULT 'free',
    pos_x      INTEGER,
    pos_y      INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dining_tables_tenant ON public.dining_tables(tenant_id);

-- ============================================================
-- 5. Tabla ORDERS (tickets cerrados)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    table_id       TEXT,
    table_number   TEXT,
    waiter_name    TEXT,
    items          JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tax_total      NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total          NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'paid',
    status         TEXT NOT NULL DEFAULT 'closed',
    series         TEXT,
    verifactu_qr   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON public.orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(tenant_id, status);

-- ============================================================
-- 6. Tabla ORDER_ITEMS (líneas de pedido)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.order_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID,
    name       TEXT NOT NULL,
    price      NUMERIC(10, 2) NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 1,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

-- ============================================================
-- 7. Tabla OPEN_ORDERS (borradores de comanda activa)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.open_orders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    table_id     TEXT NOT NULL,
    table_number TEXT NOT NULL,
    waiter_name  TEXT,
    items        JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes        TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_open_orders_tenant ON public.open_orders(tenant_id, updated_at DESC);

-- ============================================================
-- 8. Tabla TENANT_USERS (camareros)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id      UUID,
    name         TEXT NOT NULL DEFAULT 'Camarero',
    email        TEXT,
    role         TEXT NOT NULL DEFAULT 'waiter',
    pin_code     TEXT,
    username     TEXT,
    waiter_pin   TEXT,
    password_hash TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_users_username
    ON public.tenant_users(tenant_id, LOWER(username)) WHERE username IS NOT NULL;

-- ============================================================
-- 9. Tabla INVITATION_CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invitation_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT UNIQUE NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'lifetime_vip',
    email         TEXT,
    used_at       TIMESTAMPTZ,
    used_by_email TEXT,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. Funciones auxiliares con SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (raw_user_meta_data->>'is_superadmin')::boolean
         FROM auth.users WHERE id = auth.uid()),
        FALSE
    );
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_owner(tid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = tid AND owner_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.get_first_active_tenant()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.tenants
    WHERE subscription_status IN ('active','trialing','lifetime_vip','past_due')
    ORDER BY created_at ASC LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_first_active_tenant() TO authenticated, anon;

-- ============================================================
-- 11. RPC: insert_order_with_tenant (bypasea RLS)
-- ============================================================
DROP FUNCTION IF EXISTS public.insert_order_with_tenant(JSONB);
CREATE OR REPLACE FUNCTION public.insert_order_with_tenant(p_order JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id TEXT;
    v_new_id    UUID;
BEGIN
    v_tenant_id := p_order->>'tenant_id';
    IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
        RETURN json_build_object('ok', false, 'error', 'tenant_id requerido');
    END IF;
    IF NOT (v_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RETURN json_build_object('ok', false, 'error', 'tenant_id no es UUID válido: ' || v_tenant_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id::uuid) THEN
        RETURN json_build_object('ok', false, 'error', 'Tenant no existe: ' || v_tenant_id);
    END IF;
    INSERT INTO public.orders (
        tenant_id, table_id, table_number, waiter_name, items,
        subtotal, tax_total, total, payment_method, payment_status,
        status, series
    ) VALUES (
        (p_order->>'tenant_id')::uuid,
        NULLIF(p_order->>'table_id', ''),
        p_order->>'table_number',
        p_order->>'waiter_name',
        COALESCE(p_order->'items', '[]'::jsonb),
        COALESCE((p_order->>'subtotal')::numeric, 0),
        COALESCE((p_order->>'tax_total')::numeric, 0),
        COALESCE((p_order->>'total')::numeric, 0),
        p_order->>'payment_method',
        COALESCE(p_order->>'payment_status', 'paid'),
        COALESCE(p_order->>'status', 'closed'),
        p_order->>'series'
    ) RETURNING id INTO v_new_id;
    RETURN json_build_object('ok', true, 'id', v_new_id);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
GRANT EXECUTE ON FUNCTION public.insert_order_with_tenant(JSONB) TO authenticated, anon;

-- ============================================================
-- 12. RPC: verify_waiter_login
-- ============================================================
DROP FUNCTION IF EXISTS public.verify_waiter_login(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.verify_waiter_login(p_username TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rec RECORD;
BEGIN
    SELECT tu.id, tu.tenant_id, tu.user_id, tu.role, tu.name, tu.email,
           tu.waiter_pin, tu.is_active, t.subscription_status
    INTO rec
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE LOWER(tu.username) = LOWER(TRIM(p_username))
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Usuario no encontrado');
    END IF;
    IF rec.is_active = FALSE THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Usuario desactivado');
    END IF;
    IF rec.waiter_pin IS NULL OR rec.waiter_pin = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El usuario no tiene PIN configurado');
    END IF;
    IF UPPER(TRIM(COALESCE(rec.waiter_pin, ''))) <> UPPER(TRIM(COALESCE(p_pin, ''))) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN incorrecto');
    END IF;
    IF rec.subscription_status NOT IN ('active','trialing','lifetime_vip') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Suscripción del local inactiva');
    END IF;
    RETURN json_build_object(
        'ok', true,
        'tenant_id', rec.tenant_id,
        'user_id', rec.user_id,
        'role', rec.role,
        'name', rec.name,
        'email', rec.email
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_waiter_login(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 13. RLS — Habilitar y policies no bloqueantes
-- ============================================================

-- 13.1 Tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants_all" ON public.tenants;
CREATE POLICY "tenants_all" ON public.tenants FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.2 Categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categories_all" ON public.categories;
CREATE POLICY "categories_all" ON public.categories FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.3 Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_all" ON public.products;
CREATE POLICY "products_all" ON public.products FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.4 Dining tables
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dining_tables_all" ON public.dining_tables;
CREATE POLICY "dining_tables_all" ON public.dining_tables FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.5 Orders — INSERT abierto, SELECT/UPDATE/DELETE por owner
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select_owner"   ON public.orders;
DROP POLICY IF EXISTS "orders_insert_auth"    ON public.orders;
DROP POLICY IF EXISTS "orders_update_owner"   ON public.orders;
DROP POLICY IF EXISTS "orders_delete_owner"   ON public.orders;
CREATE POLICY "orders_select_owner" ON public.orders FOR SELECT TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());
CREATE POLICY "orders_insert_auth" ON public.orders FOR INSERT TO authenticated
WITH CHECK (TRUE);
CREATE POLICY "orders_update_owner" ON public.orders FOR UPDATE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());
CREATE POLICY "orders_delete_owner" ON public.orders FOR DELETE TO authenticated
USING (is_tenant_owner(tenant_id) OR is_superadmin());

-- 13.6 Order items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_all" ON public.order_items;
CREATE POLICY "order_items_all" ON public.order_items FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.7 Open orders
ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open_orders_all" ON public.open_orders;
CREATE POLICY "open_orders_all" ON public.open_orders FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.8 Tenant users
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_users_all" ON public.tenant_users;
CREATE POLICY "tenant_users_all" ON public.tenant_users FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- 13.9 Invitation codes
ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invitation_codes_all" ON public.invitation_codes;
CREATE POLICY "invitation_codes_all" ON public.invitation_codes FOR ALL TO authenticated
USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 14. Triggers updated_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_tenants_updated      ON public.tenants;
DROP TRIGGER IF EXISTS trg_products_updated     ON public.products;
DROP TRIGGER IF EXISTS trg_orders_updated       ON public.orders;
DROP TRIGGER IF EXISTS trg_open_orders_updated  ON public.open_orders;
DROP TRIGGER IF EXISTS trg_tenant_users_updated ON public.tenant_users;
CREATE TRIGGER trg_tenants_updated      BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_products_updated     BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_updated       BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_open_orders_updated  BEFORE UPDATE ON public.open_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tenant_users_updated BEFORE UPDATE ON public.tenant_users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 15. Realtime publication
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['tenants','categories','products','dining_tables',
                                  'orders','order_items','open_orders','tenant_users'])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 16. Seed del tenant VIP y menú si no existen
-- ============================================================
DO $$
DECLARE
    v_tenant_id UUID;
    v_owner_id  UUID;
    v_count     INT;
    v_seed      JSONB;
    v_item      JSONB;
BEGIN
    -- 16.1 Buscar o crear tenant VIP
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE subscription_status IN ('active','trialing','lifetime_vip')
    ORDER BY created_at ASC LIMIT 1;

    IF v_tenant_id IS NULL THEN
        SELECT id INTO v_owner_id FROM auth.users
        WHERE email = 'chalohiahmd1980@gmail.com' LIMIT 1;
        IF v_owner_id IS NULL THEN
            v_owner_id := '00000000-0000-0000-0000-000000000000'::uuid;
        END IF;
        INSERT INTO public.tenants (name, owner_id, subscription_status, plan, is_superadmin)
        VALUES ('MOZONA TPV (Demo VIP)', v_owner_id, 'lifetime_vip', 'lifetime_vip', TRUE)
        RETURNING id INTO v_tenant_id;
        RAISE NOTICE 'Tenant VIP creado: %', v_tenant_id;
    END IF;

    -- 16.2 Seed de productos si el tenant no tiene ninguno
    SELECT count(*) INTO v_count FROM public.products WHERE tenant_id = v_tenant_id;
    IF v_count = 0 THEN
        v_seed := '[
            {"name":"Ensalada Rusa","price":9.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"},
            {"name":"Ensalada Mixta","price":7.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500"},
            {"name":"Croquetas de la Casa (6 uds)","price":8.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1625937329935-287441889ab4?w=500"},
            {"name":"Hummus con Pita","price":7.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1571197119282-7c4e2c2c3e1e?w=500"},
            {"name":"Tabla de Quesos","price":12.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1452195100486-9cc805987862?w=500"},
            {"name":"Paella Valenciana","price":14.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=500"},
            {"name":"Paella de Marisco","price":18.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500"},
            {"name":"Cordero al Horno","price":19.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1544025162-d76694265947?w=500"},
            {"name":"Salmón a la Plancha","price":16.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500"},
            {"name":"Solomillo de Ternera","price":21.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1600891964092-4316c288032e?w=500"},
            {"name":"Risotto de Setas","price":13.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500"},
            {"name":"Pollo Tikka Masala","price":13.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500"},
            {"name":"Tortilla Española","price":6.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500"},
            {"name":"Patatas Bravas","price":5.50,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500"},
            {"name":"Calamares a la Romana","price":9.50,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500"},
            {"name":"Gambas al Ajillo","price":11.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1625943553852-781c6dd46faa?w=500"},
            {"name":"Pulpo a la Gallega","price":14.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1559847844-5315695dadae?w=500"},
            {"name":"Tarta de Queso","price":6.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=500"},
            {"name":"Brownie con Helado","price":7.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=500"},
            {"name":"Crema Catalana","price":5.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1470124182917-cc6e71b22ecc?w=500"},
            {"name":"Helado (3 bolas)","price":4.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?w=500"},
            {"name":"Fruta del Tiempo","price":3.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500"},
            {"name":"Agua Mineral 500ml","price":2.00,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1564419320461-6870880221ad?w=500"},
            {"name":"Coca-Cola 330ml","price":2.80,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500"},
            {"name":"Cerveza Mahou 330ml","price":2.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1608270586620-248524c67de9?w=500"},
            {"name":"Vino de la Casa (copa)","price":3.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500"},
            {"name":"Café Solo","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500"},
            {"name":"Cappuccino","price":2.80,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500"},
            {"name":"Té Marroquí","price":2.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500"}
        ]'::jsonb;
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_seed)
        LOOP
            INSERT INTO public.products (tenant_id, name, price, tax_rate, category, image_url, is_available)
            VALUES (v_tenant_id, v_item->>'name', (v_item->>'price')::numeric, 10,
                    v_item->>'category', v_item->>'image_url', TRUE);
        END LOOP;
        RAISE NOTICE 'Seed insertado: % productos', jsonb_array_length(v_seed);
    END IF;
END $$;

-- ============================================================
-- 17. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT 'tenants'       AS tabla, count(*)::text AS filas FROM public.tenants
UNION ALL SELECT 'products',     count(*)::text FROM public.products
UNION ALL SELECT 'orders',       count(*)::text FROM public.orders
UNION ALL SELECT 'open_orders',  count(*)::text FROM public.open_orders
UNION ALL SELECT 'tenant_users', count(*)::text FROM public.tenant_users
UNION ALL SELECT 'categories',   count(*)::text FROM public.categories
UNION ALL SELECT 'dining_tables',count(*)::text FROM public.dining_tables;

-- ============================================================
-- INSTRUCCIONES POST-INSTALACIÓN
-- ============================================================
-- 1) Refresca /app con Ctrl+Shift+R
-- 2) En consola F12 debe aparecer:
--    [usePosData] cache-bust: null → v1.3-sync-fixes
--    [usePosData] IndexedDB limpiado
--    [loadRestaurantData] tenant = <uuid> products = 29
-- 3) El TPV debe mostrar los 29 productos seed
-- 4) Ve a Settings → 🍽️ Productos para añadir los 15 restantes
-- 5) Ve a Settings → 📊 Ventas → debe mostrar 0 tickets (vacío al inicio)
-- ============================================================
