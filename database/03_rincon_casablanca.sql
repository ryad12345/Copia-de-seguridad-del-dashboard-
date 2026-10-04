-- =====================================================================
-- MOZONA TPV — Menú "Rincón de Casablanca" (chalohiahmd1980@gmail.com)
-- =====================================================================
-- EJECUTAR DESPUÉS de `02_saas_migration.sql` en el SQL Editor de Supabase.
-- IDEMPOTENTE: borra los productos/categorías anteriores del tenant y los
-- reinserta con sus imágenes.  Seguro de re-ejecutar.
-- =====================================================================

-- 1. Asegurar el tenant y su estado -----------------------------
UPDATE public.tenants
SET name = 'Rincón de Casablanca',
    plan = 'lifetime_vip',
    subscription_status = 'active',
    onboarding_completed = true
WHERE owner_id IN (SELECT id FROM auth.users WHERE email = 'chalohiahmd1980@gmail.com');

-- Si el email ya estaba pero el plan no era VIP, forzarlo también
UPDATE public.tenants
SET plan = 'lifetime_vip',
    subscription_status = 'active',
    onboarding_completed = true
WHERE id = (SELECT id FROM public.tenants LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM public.tenants t2
    JOIN auth.users u ON u.id = t2.owner_id
    WHERE u.email = 'chalohiahmd1980@gmail.com'
  );

-- 2. Insertar / reemplazar categorías y productos --------------
DO $$
DECLARE
    v_tenant_id UUID;
    cat_ent UUID; cat_car UUID; cat_pes UUID; cat_piz UUID; cat_pas UUID; cat_ext UUID; cat_pos UUID;
BEGIN
    -- Encontrar el tenant del dueño
    SELECT t.id INTO v_tenant_id
    FROM public.tenants t
    JOIN auth.users u ON u.id = t.owner_id
    WHERE u.email = 'chalohiahmd1980@gmail.com'
    LIMIT 1;

    -- Fallback: primer tenant (modo demo)
    IF v_tenant_id IS NULL THEN
        SELECT id INTO v_tenant_id FROM public.tenants LIMIT 1;
    END IF;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No hay tenant en la base de datos.  Crea uno primero desde /auth.';
    END IF;

    -- Limpiar productos y categorías previos
    DELETE FROM public.products   WHERE tenant_id = v_tenant_id;
    DELETE FROM public.categories WHERE tenant_id = v_tenant_id;

    -- 3. Crear categorías
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Entrantes',         10) RETURNING id INTO cat_ent;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Carne',             20) RETURNING id INTO cat_car;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Pescado',           30) RETURNING id INTO cat_pes;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Pizza',             40) RETURNING id INTO cat_piz;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Pasta',             50) RETURNING id INTO cat_pas;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Extras',            60) RETURNING id INTO cat_ext;
    INSERT INTO public.categories (tenant_id, name, sort_order) VALUES
        (v_tenant_id, 'Postres y Bebidas', 70) RETURNING id INTO cat_pos;

    -- 4. Insertar productos con imágenes
    -- ENTRANTES -------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_ent, 'Ensalada Rusa', 'Patata, atún, huevo y mayonesa', 9.00, 10, 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Ensalada Mixta', 'Lechuga, tomate, cebolla, maíz, atún y aceitunas', 7.00, 10, 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Ensalada Griega', 'Tomate, pepino, cebolla, queso feta, aceitunas y pimiento', 7.80, 10, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Ensalada Marroquí', 'Tomate, cebolla, pepino y pimiento', 6.80, 10, 'https://images.unsplash.com/photo-1505253716362-afaea1d3d1af?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Ensalada Marroquí de Berenjenas', 'Berenjenas, tomate, pimiento, ajo y perejil', 6.50, 10, 'https://images.unsplash.com/photo-1628294895950-9805252327bc?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Gambas al pil pil o al ajillo', 'Gambas frescas con ajo y guindilla', 10.00, 10, 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Pulpo a la Gallega', 'Pulpo cocido con patata, pimentón y aceite', 6.00, 10, 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Almejas al gusto', 'Almejas preparadas al gusto', 7.50, 10, 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Revuelto de ajetes y gambas', 'Revuelto suave de ajetes y gambas', 8.00, 10, 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ent, 'Gambas cocidas o plancha', 'Gambas frescas cocidas o a la plancha', 6.95, 10, 'https://images.unsplash.com/photo-1559742811-822873691df8?w=600&auto=format&fit=crop&q=80');

    -- CARNE -----------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_car, 'Tajen de Pollo', 'Tradicional tajín marroquí de pollo especiado', 8.00, 10, 'https://images.unsplash.com/photo-1541518763669-27fef04b14ea?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Tajen de Ternera', 'Tajín tierno de ternera con verduras aromáticas', 10.00, 10, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Tajen de Cordero', 'Tajín de cordero especiado', 17.00, 10, 'https://images.unsplash.com/photo-1574484284002-952d92456975?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Tajen de Carne Picada (Kefta)', 'Tajín de kefta con salsa de tomate y huevo', 10.00, 10, 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Plato de Pinchitos', 'Con guarnición: arroz, patatas fritas o ensalada', 8.50, 10, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Pollo Asado con Patatas Fritas (Entero)', 'Pollo entero con patatas', 16.00, 10, 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Pollo Asado con Patatas Fritas (1/2)', 'Medio pollo con patatas', 8.00, 10, 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Alitas de Pollo', 'Ración de alitas crujientes', 6.00, 10, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Menú de Kebab', 'Kebab con patatas fritas y bebida', 7.50, 10, 'https://images.unsplash.com/photo-1561651823-34feb02250e4?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Menú de Hamburguesa', 'Hamburguesa con patatas y refresco', 8.00, 10, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Menú de Nuggets de Pollo', 'Nuggets dorados con patatas', 6.95, 10, 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_car, 'Pastela de Pollo', 'Pastela hojaldrada tradicional marroquí', 7.50, 10, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600&auto=format&fit=crop&q=80');

    -- PESCADO ---------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_pes, 'Tajen de Pescado', 'Tajín de pescado fresco con verduras', 11.00, 10, 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pes, 'Pastela de Pescado', 'Pastela hojaldrada rellena de marisco y pescado', 8.80, 10, 'https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pes, 'Dorada a la Plancha', 'Dorada fresca a la plancha', 15.00, 10, 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pes, 'Calamares Fritos', 'Calamares crujientes a la andaluza', 12.00, 10, 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pes, 'Rosada a la Plancha', 'Filete de rosada dorada a la plancha', 12.50, 10, 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&auto=format&fit=crop&q=80');

    -- PIZZA -----------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_piz, 'Margarita', 'Tomate y queso', 7.00, 10, 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_piz, 'Siciliana', 'Tomate, queso, atún, cebolla y aceituna', 7.00, 10, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_piz, 'La casa', 'Tomate, queso y chawarma', 8.00, 10, 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_piz, 'Boloñesa', 'Tomate, queso y carne picada', 8.00, 10, 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=600&auto=format&fit=crop&q=80');

    -- PASTA -----------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_pas, 'Espagueti a la boloñesa', 'Pasta con boloñesa casera', 13.00, 10, 'https://images.unsplash.com/photo-1621996346565-e3d5d6281691?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pas, 'Espagueti salmón', 'Pasta con dados de salmón fresco', 13.00, 10, 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pas, 'Espagueti fruta del mar', 'Pasta con mariscos variados', 13.50, 10, 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80');

    -- EXTRAS ----------------------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_ext, 'Patatas fritas', 'Ración de patatas fritas', 3.00, 10, 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ext, 'Verduras salteadas', 'Salteado de verduras frescas', 2.50, 10, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ext, 'Arroz', 'Guarnición de arroz', 2.50, 10, 'https://images.unsplash.com/photo-1516684732162-798a0062be99?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_ext, 'Salsa', 'Porción extra de salsa', 0.50, 10, 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=600&auto=format&fit=crop&q=80');

    -- POSTRES Y BEBIDAS -----------------------------------------
    INSERT INTO public.products (tenant_id, category_id, name, description, price, tax_rate, image_url) VALUES
        (v_tenant_id, cat_pos, 'Flan casero', 'Flan tradicional', 3.00, 10, 'https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pos, 'Tarta de queso', 'Tarta de queso horneada', 7.00, 10, 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pos, 'Dulces árabes', 'Unidad de pastelito árabe', 1.00, 10, 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pos, 'Helados', 'Variedad de sabores', 5.00, 10, 'https://images.unsplash.com/photo-1560008581-09826d1de69e?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pos, 'Café', 'Café solo / cortado / con leche', 1.50, 10, 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&auto=format&fit=crop&q=80'),
        (v_tenant_id, cat_pos, 'Té marroquí', 'Té verde con hierbabuena fresca', 2.50, 10, 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600&auto=format&fit=crop&q=80');

    RAISE NOTICE 'Menú Rincón de Casablanca cargado: % productos, % categorías',
        (SELECT COUNT(*) FROM public.products   WHERE tenant_id = v_tenant_id),
        (SELECT COUNT(*) FROM public.categories WHERE tenant_id = v_tenant_id);
END $$;

-- 5. Refrescar la Realtime cache --------------------------------
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- FIN.  Verifica ejecutando:
--   SELECT p.name, c.name, p.price, LEFT(p.image_url, 50)
--   FROM public.products p
--   JOIN public.categories c ON c.id = p.category_id
--   ORDER BY c.sort_order, p.name;
-- =====================================================================
