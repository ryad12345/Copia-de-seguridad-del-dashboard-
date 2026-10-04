-- =====================================================================
-- SQL #61 — TRIGGER AUTO-CREACIÓN DE 8 CATEGORÍAS ESTÁNDAR
-- =====================================================================
-- Cuando se crea un tenant, se insertan automáticamente las 8
-- categorías maestras para que NUNCA esté vacío.
--
-- Además: default 'Otros' para category en products huérfanos.
-- =====================================================================

-- 1. Función trigger que crea categorías por defecto para un tenant nuevo
CREATE OR REPLACE FUNCTION public.fn_create_default_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- ★ ejecuta con permisos del owner, evita recursión RLS
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    default_categories TEXT[] := ARRAY[
        'Entrantes', 'Carnes', 'Pescados',
        'Pizzas', 'Pastas', 'Bebidas',
        'Postres', 'Extras'
    ];
    i INT;
BEGIN
    v_tenant_id := NEW.id;

    FOR i IN 1..array_length(default_categories, 1) LOOP
        INSERT INTO public.categories (tenant_id, name, sort_order, is_active)
        VALUES (v_tenant_id, default_categories[i], i * 10, true)
        ON CONFLICT (tenant_id, name) DO NOTHING;
    END LOOP;

    RETURN NEW;
END;
$$;

-- 2. Trigger AFTER INSERT en tenants
DROP TRIGGER IF EXISTS trg_tenants_create_default_categories ON public.tenants;
CREATE TRIGGER trg_tenants_create_default_categories
    AFTER INSERT ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_create_default_categories();

-- 3. Default 'Otros' para category en products huérfanos
ALTER TABLE public.products
    ALTER COLUMN category SET DEFAULT 'Otros';

-- 4. Verificar constraint NOT NULL en category si no existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products'
          AND column_name = 'category'
          AND is_nullable = 'YES'
    ) THEN
        -- No hacemos NOT NULL porque RLS podría tener rows legacy
        -- Solo dejamos el DEFAULT 'Otros'
        RAISE NOTICE 'products.category DEFAULT aplicado';
    END IF;
END $$;

-- =====================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =====================================================================
-- SELECT trigger_name, event_manipulation, event_object_table
-- FROM information_schema.triggers
-- WHERE event_object_table = 'tenants';
--
-- Debe aparecer: trg_tenants_create_default_categories
-- =====================================================================
