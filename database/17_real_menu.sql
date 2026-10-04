-- =====================================================================
-- MOZONA TPV — 17_real_menu.sql
-- =====================================================================
-- Reemplaza TODO el catálogo del tenant de chalohiahmd1980@gmail.com
-- con la carta real (50+ platos con IVA 10% hostelería ES).
-- Idempotente: detecta si ya están los nuevos y no duplica.
-- =====================================================================

DO $$
DECLARE
    v_tenant_id UUID;
    v_owner_id  UUID;
    v_count     INT;
    v_seed      JSONB;
    v_item      JSONB;
    v_total     INT;
BEGIN
    -- 1) Encontrar el tenant del admin
    SELECT id INTO v_owner_id
    FROM auth.users WHERE email = 'chalohiahmd1980@gmail.com' LIMIT 1;

    IF v_owner_id IS NULL THEN
        -- Fallback: el primer tenant activo
        SELECT id INTO v_tenant_id
        FROM public.tenants
        WHERE subscription_status IN ('active','trialing','lifetime_vip')
        ORDER BY created_at ASC LIMIT 1;
    ELSE
        -- Buscar tenant por owner_id
        SELECT id INTO v_tenant_id
        FROM public.tenants
        WHERE owner_id = v_owner_id
        ORDER BY created_at ASC LIMIT 1;

        -- Si no hay tenant del owner, usar el primero activo
        IF v_tenant_id IS NULL THEN
            SELECT id INTO v_tenant_id
            FROM public.tenants
            WHERE subscription_status IN ('active','trialing','lifetime_vip')
            ORDER BY created_at ASC LIMIT 1;
        END IF;
    END IF;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No hay ningún tenant activo.  Ejecuta primero 99_production_ready.sql';
    END IF;

    RAISE NOTICE 'Tenant objetivo: %', v_tenant_id;

    -- 2) Borrar todos los productos existentes del tenant
    DELETE FROM public.products WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Productos borrados: %', v_count;

    -- 3) Insertar la carta real (52 platos)
    v_seed := '[
        -- ENTRANTES (10)
        {"name":"Ensalada Rusa","description":"Patata, atún, huevo y mayonesa","price":9.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"},
        {"name":"Ensalada Mixta","description":"Lechuga, tomate, cebolla, maíz, atún y aceitunas","price":7.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500"},
        {"name":"Ensalada Griega","description":"Tomate, pepino, cebolla, queso feta, aceitunas negras, pimiento verde","price":7.80,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"},
        {"name":"Ensalada marroquí","description":"Tomate, cebolla, pepino y pimiento","price":6.80,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500"},
        {"name":"Ensalada marroquí de berenjenas","description":"Berenjenas, tomate, pimiento, ajo y perejil","price":6.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1623428187969-5da2dcea5ebf?w=500"},
        {"name":"Gambas al pil pil o al ajillo","description":"Gambas en aceite de oliva con ajo y guindilla","price":10.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1625943553852-781c6dd46faa?w=500"},
        {"name":"Pulpo a la gallega","description":"Pulpo cocido con pimentón y aceite de oliva","price":6.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1559847844-5315695dadae?w=500"},
        {"name":"Almejas al gusto","description":"Almejas preparadas al estilo de la casa","price":7.50,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1565688538185-f3eb48b08e87?w=500"},
        {"name":"Revuelto de ajetes y gambas","description":"Ajetes tiernos salteados con gambas","price":8.00,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500"},
        {"name":"Gambas cocidas o plancha","description":"Gambas frescas cocidas o a la plancha","price":6.95,"category":"Entrantes","image_url":"https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=500"},

        -- CARNE (12)
        {"name":"Tajen de pollo","description":"Piezas de pollo al estilo marroqui","price":8.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500"},
        {"name":"Tajen de ternera","description":"Piezas tiernas de ternera especiadas","price":10.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1600891964092-4316c288032e?w=500"},
        {"name":"Tajen de cordero","description":"Cordero al estilo tradicional marroqui","price":17.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1544025162-d76694265947?w=500"},
        {"name":"Tajen de carne picada (kefta)","description":"Carne picada especiada a la parrilla","price":10.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=500"},
        {"name":"Plato de pinchitos","description":"Con arroz, patatas fritas o ensalada","price":8.50,"category":"Carne","image_url":"https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500"},
        {"name":"Pollo asado con patatas fritas","description":"Pollo entero asado con patatas","price":16.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=500"},
        {"name":"Pollo asado con patatas fritas (1/2)","description":"Medio pollo asado con patatas","price":8.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=500"},
        {"name":"Alitas de pollo","description":"Alitas de pollo fritas o al horno","price":6.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1608039755401-742074f0548d?w=500"},
        {"name":"Menú de kebab","description":"Kebab completo con pan, carne, ensalada y salsa","price":7.50,"category":"Carne","image_url":"https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500"},
        {"name":"Menú de hamburguesa","description":"Hamburguesa completa con patatas","price":8.00,"category":"Carne","image_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500"},
        {"name":"Menú de nuggets de pollo","description":"Nuggets de pollo con patatas fritas","price":6.95,"category":"Carne","image_url":"https://images.unsplash.com/photo-1562967914-608f82629710?w=500"},
        {"name":"Pastela de pollo","description":"Empanada marroqui de pollo y almendras","price":7.50,"category":"Carne","image_url":"https://images.unsplash.com/photo-1601317836144-44d62a3e3df9?w=500"},

        -- PESCADO (5)
        {"name":"Tajen de pescado","description":"Pescado al estilo marroqui","price":11.00,"category":"Pescado","image_url":"https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=500"},
        {"name":"Pastela de pescado","description":"Empanada marroqui de pescado y especias","price":8.80,"category":"Pescado","image_url":"https://images.unsplash.com/photo-1601317836144-44d62a3e3df9?w=500"},
        {"name":"Dorada a la plancha","description":"Dorada fresca a la plancha con guarnición","price":15.00,"category":"Pescado","image_url":"https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=500"},
        {"name":"Calamares fritos","description":"Calamares frescos rebozados y fritos","price":12.00,"category":"Pescado","image_url":"https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500"},
        {"name":"Rosada a la plancha","description":"Filete de rosada a la plancha","price":12.50,"category":"Pescado","image_url":"https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=500"},

        -- PASTA (3)
        {"name":"Espagueti a la boloñesa","description":"Pasta con salsa de carne y tomate","price":13.00,"category":"Pasta","image_url":"https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=500"},
        {"name":"Espagueti salmón","description":"Pasta con salmón fresco y salsa","price":13.00,"category":"Pasta","image_url":"https://images.unsplash.com/photo-1608219992726-0d4b3bd5ce03?w=500"},
        {"name":"Espagueti fruta del mar","description":"Pasta con mariscos variados","price":13.50,"category":"Pasta","image_url":"https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=500"},

        -- PIZZA (4)
        {"name":"Pizza Margarita","description":"Tomate y queso","price":7.00,"category":"Pizza","image_url":"https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=500"},
        {"name":"Pizza Siciliana","description":"Tomate, queso, atún, cebolla y aceituna","price":7.00,"category":"Pizza","image_url":"https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=500"},
        {"name":"Pizza La Casa","description":"Tomate, queso y chawarma","price":8.00,"category":"Pizza","image_url":"https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500"},
        {"name":"Pizza Boloñesa","description":"Tomate, queso y carne picada","price":8.00,"category":"Pizza","image_url":"https://images.unsplash.com/photo-1628840042765-356cda07504e?w=500"},

        -- SÁNDWICHS (2)
        {"name":"Sándwich de atún","description":"Sándwich de atún con lechuga y tomate","price":6.00,"category":"Sándwichs","image_url":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500"},
        {"name":"Sándwich mixto","description":"Sándwich de jamón y queso","price":8.00,"category":"Sándwichs","image_url":"https://images.unsplash.com/photo-1528736235302-52822c5b5edd?w=500"},

        -- EXTRAS (4)
        {"name":"Patatas fritas","description":"Porción de patatas fritas","price":3.00,"category":"Extras","image_url":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500"},
        {"name":"Verduras salteadas","description":"Verduras variadas salteadas al wok","price":2.50,"category":"Extras","image_url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"},
        {"name":"Arroz","description":"Porción de arroz blanco","price":2.50,"category":"Extras","image_url":"https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=500"},
        {"name":"Salsa","description":"Salsa extra (yogur, harissa, tahini…)","price":0.50,"category":"Extras","image_url":"https://images.unsplash.com/photo-1473093226795-af9932fe5856?w=500"},

        -- POSTRES (4)
        {"name":"Flan casero","description":"Flan casero con caramelo","price":3.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1551024506-0bccd5d61ca1?w=500"},
        {"name":"Tarta de queso","description":"Tarta de queso con coulis de frutos rojos","price":7.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=500"},
        {"name":"Dulces árabes","description":"Surtido de dulces tradicionales marroquis","price":1.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1571115764595-644a1f56a55c?w=500"},
        {"name":"Helados","description":"Helado de vainilla, chocolate o fresa","price":5.00,"category":"Postres","image_url":"https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?w=500"},

        -- BEBIDAS (5)
        {"name":"Café","description":"Café espresso","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500"},
        {"name":"Té marroquí","description":"Té verde con menta","price":2.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500"},
        {"name":"Coca-Cola","description":"Coca-Cola lata 330ml","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500"},
        {"name":"Fanta de naranja","description":"Fanta naranja lata 330ml","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1624559381101-c2d1c2c9b3b8?w=500"},
        {"name":"Fanta de limón","description":"Fanta limón lata 330ml","price":1.50,"category":"Bebidas","image_url":"https://images.unsplash.com/photo-1624559381101-c2d1c2c9b3b8?w=500"}
    ]'::jsonb;

    v_total := 0;
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
            10,    -- 10% IVA hostelería ES
            v_item->>'category',
            v_item->>'image_url',
            TRUE
        );
        v_total := v_total + 1;
    END LOOP;

    RAISE NOTICE '✓ Carta real insertada: % platos para tenant %', v_total, v_tenant_id;
END $$;

-- 4) Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- 5) Verificación
SELECT category, count(*) AS platos, sum(price) AS suma_eur
FROM public.products
WHERE tenant_id = (
    SELECT id FROM public.tenants
    WHERE subscription_status IN ('active','trialing','lifetime_vip')
    ORDER BY created_at ASC LIMIT 1
)
GROUP BY category
ORDER BY category;
