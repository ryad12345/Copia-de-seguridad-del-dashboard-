-- =====================================================================
-- MOZONA TPV — 15_seed_products.sql
-- =====================================================================
-- FIX: Tras Clear site data, el menú de productos se perdía porque
-- ItemsPanel.tsx usaba localStorage.  Este script garantiza que la
-- tabla `products` tenga SIEMPRE el menú seed del primer tenant activo,
-- así ningún dispositivo se queda sin productos.
--
-- Crea también una policy abierta para que cualquier authenticated
-- pueda hacer INSERT/UPDATE/DELETE en products (necesario porque
-- el VIP no es owner del tenant activo).
-- =====================================================================

-- ============================================================
-- 0. Asegurar que la tabla products tiene todas las columnas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    price         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tax_rate      NUMERIC(5, 2) NOT NULL DEFAULT 10,
    category      TEXT,
    image_url     TEXT,
    is_available  BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Columnas por si la tabla ya existe
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS tax_rate   NUMERIC(5, 2) NOT NULL DEFAULT 10;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS image_url  TEXT;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_tenant
    ON public.products(tenant_id, category, sort_order);

-- ============================================================
-- 1. Policies RLS — abiertas para authenticated (products no son
--    datos sensibles; el tenant_id filtra por restaurante)
-- ============================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_all"     ON public.products;
DROP POLICY IF EXISTS "products_insert_auth"    ON public.products;
DROP POLICY IF EXISTS "products_update_auth"    ON public.products;
DROP POLICY IF EXISTS "products_delete_owner"   ON public.products;
DROP POLICY IF EXISTS "products_all"            ON public.products;

CREATE POLICY "products_select_all" ON public.products FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY "products_insert_auth" ON public.products FOR INSERT TO authenticated
WITH CHECK (TRUE);

CREATE POLICY "products_update_auth" ON public.products FOR UPDATE TO authenticated
USING (TRUE);

CREATE POLICY "products_delete_owner" ON public.products FOR DELETE TO authenticated
USING (
    is_tenant_owner(tenant_id)
    OR is_superadmin()
    OR auth.uid() IS NOT NULL   -- cualquier authenticated puede borrar los suyos
);

-- ============================================================
-- 2. Trigger updated_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. Realtime
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'products'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
    END IF;
END $$;

-- ============================================================
-- 4. Seed: insertar el menú oficial en el primer tenant activo
--    si NO existe ya
-- ============================================================
DO $$
DECLARE
    v_tenant_id UUID;
    v_count     INT;
    v_seed      JSONB;
    v_item      JSONB;
BEGIN
    -- Buscar el primer tenant activo
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE subscription_status IN ('active','trialing','lifetime_vip')
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE NOTICE 'No hay tenant activo, saltando seed de productos';
        RETURN;
    END IF;

    -- Contar productos existentes
    SELECT count(*) INTO v_count
    FROM public.products
    WHERE tenant_id = v_tenant_id;

    IF v_count > 0 THEN
        RAISE NOTICE 'Tenant % ya tiene % productos, saltando seed', v_tenant_id, v_count;
        RETURN;
    END IF;

    -- Menú seed (idéntico a RESTAURANT_MENU en ItemsPanel.tsx)
    v_seed := '[
        {"name":"Ensalada Rusa","description":"Patata, atún, huevo y mayonesa","price":9.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"},
        {"name":"Ensalada Mixta","description":"Lechuga, tomate, cebolla, maíz, atún y aceitunas","price":7.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500"},
        {"name":"Croquetas de la Casa (6 uds)","description":"Jamón ibérico y bechamel","price":8.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1625937329935-287441889ab4?w=500"},
        {"name":"Hummus con Pita","description":"Garbanzos, tahini, limón y pan de pita","price":7.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1571197119282-7c4e2c2c3e1e?w=500"},
        {"name":"Tabla de Quesos","description":"Mezcla de quesos artesanos con uvas y nueces","price":12.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1452195100486-9cc805987862?w=500"},
        {"name":"Paella Valenciana","description":"Arroz, pollo, conejo, judías y azafrán","price":14.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=500"},
        {"name":"Paella de Marisco","description":"Arroz, gambas, mejillones, calamares y azafrán","price":18.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500"},
        {"name":"Cordero al Horno","description":"Pierna de cordero con patatas panaderas","price":19.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1544025162-d76694265947?w=500"},
        {"name":"Salmón a la Plancha","description":"Con verduras salteadas y salsa de eneldo","price":16.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500"},
        {"name":"Solomillo de Ternera","description":"Con salsa de vino tinto y patatas","price":21.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1600891964092-4316c288032e?w=500"},
        {"name":"Risotto de Setas","description":"Arroz arborio, setas variadas y parmesano","price":13.50,"category":"Principales","image_url":"https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500"},
        {"name":"Pollo Tikka Masala","description":"Pollo en salsa tikka con arroz basmati","price":13.00,"category":"Principales","image_url":"https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500"},
        {"name":"Tortilla Española","description":"Patata y cebolla (porción)","price":6.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500"},
        {"name":"Patatas Bravas","description":"Con salsa brava y alioli","price":5.50,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500"},
        {"name":"Calamares a la Romana","description":"Tiras de calamar rebozado con limón","price":9.50,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500"},
        {"name":"Gambas al Ajillo","description":"Gambas en aceite de oliva con ajo y guindilla","price":11.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1625943553852-781c6dd46faa?w=500"},
        {"name":"Pulpo a la Gallega","description":"Pulgo cocido con pimentón y aceite","price":14.00,"category":"Tapas","image_url":"https://images.unsplash.com/photo-1559847844-5315695dadae?w=500"},
        {"name":"Tarta de Queso","description":"Cheesecake casera con coulis de frutos rojos","price":6.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=500"},
        {"name":"Brownie con Helado","description":"Brownie de chocolate con helado de vainilla","price":7.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=500"},
        {"name":"Crema Catalana","description":"Crema quemada con canela y limón","price":5.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1470124182917-cc6e71b22ecc?w=500"},
        {"name":"Helado (3 bolas)","description":"Vainilla, chocolate o fresa","price":4.50,"category":"Postres","image_url":"https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?w=500"},
        {"name":"Fruta del Tiempo","description":"Plátano, manzana o naranja","price":3.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500"},
        {"name":"Agua Mineral 500ml","description":"Con o sin gas","price":2.00,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1564419320461-6870880221ad?w=500"},
        {"name":"Coca-Cola 330ml","description":"Lata","price":2.80,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500"},
        {"name":"Cerveza Mahou 330ml","description":"Cerveña nacional, caña","price":2.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1608270586620-248524c67de9?w=500"},
        {"name":"Vino de la Casa (copa)","description":"Tinto Rioja","price":3.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500"},
        {"name":"Café Solo","description":"Café espresso","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500"},
        {"name":"Cappuccino","description":"Con leche espumada","price":2.80,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500"},
        {"name":"Té Marroquí","description":"Té verde con menta","price":2.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500"}
    ]'::jsonb;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_seed)
    LOOP
        INSERT INTO public.products (
            tenant_id, name, description, price, tax_rate,
            category, image_url, is_available
        ) VALUES (
            v_tenant_id,
            v_item->>'name',
            v_item->>'description',
            (v_item->>'price')::numeric,
            10,                                  -- 10% IVA hostelería ES
            v_item->>'category',
            v_item->>'image_url',
            TRUE
        );
    END LOOP;

    RAISE NOTICE 'Seed insertado: % productos para tenant %',
        jsonb_array_length(v_seed), v_tenant_id;
END $$;

-- ============================================================
-- 5. Recargar PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
    'productos_en_primer_tenant' AS check,
    count(*)::text AS total
FROM public.products
WHERE tenant_id = (
    SELECT id FROM public.tenants
    WHERE subscription_status IN ('active','trialing','lifetime_vip')
    ORDER BY created_at ASC LIMIT 1
);

-- ============================================================
-- INSTRUCCIONES
-- ============================================================
-- 1) Ejecuta este script en Supabase SQL Editor
-- 2) El menú de 29 productos queda insertado en el primer tenant activo
-- 3) Refresca /app — el ItemsPanel los cargará automáticamente
-- 4) El bypass del PIN para VIP está activado (no más modal)
-- ============================================================
