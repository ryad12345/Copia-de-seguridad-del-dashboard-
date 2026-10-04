-- =====================================================================
-- MOZONA TPV — 16_open_orders_by_table_number.sql
-- =====================================================================
-- FIX: sincronización camarero -> caja
--
-- El problema era que open_orders.UNIQUE(tenant_id, table_id) creaba
-- conflicto cuando:
--   - camarero envía con table_id = "local-table-16" (string)
--   - TPV consulta con table_id = UUID de dining_tables (e3de9b3c-...)
-- El UPSERT fallaba con 23505 (unique_violation) o creaba duplicados.
--
-- Solución: usar table_number (entero 1-16, común a ambos)
-- como clave de búsqueda.
-- =====================================================================

-- 1) Asegurar que table_number no es NULL en filas existentes
UPDATE public.open_orders
SET table_number = COALESCE(table_number,
    CASE
        WHEN table_id ~ '^local-table-(\d+)$' THEN (regexp_matches(table_id, 'local-table-(\d+)'))[1]
        WHEN table_id ~ '^[0-9]+$' THEN table_id
        ELSE '0'
    END
)
WHERE table_number IS NULL OR table_number = '';

-- 2) Eliminar duplicados previos (mantener el más reciente)
DELETE FROM public.open_orders o1
USING public.open_orders o2
WHERE o1.tenant_id = o2.tenant_id
  AND o1.table_number = o2.table_number
  AND o1.id <> o2.id
  AND o1.updated_at < o2.updated_at;

-- 3) Reemplazar la UNIQUE constraint
ALTER TABLE public.open_orders DROP CONSTRAINT IF EXISTS open_orders_tenant_id_table_id_key;
ALTER TABLE public.open_orders DROP CONSTRAINT IF EXISTS open_orders_tenant_id_table_number_key;
ALTER TABLE public.open_orders
    ADD CONSTRAINT open_orders_tenant_id_table_number_key
    UNIQUE (tenant_id, table_number);

-- 4) Hacer table_number NOT NULL (ahora todos tienen valor)
ALTER TABLE public.open_orders
    ALTER COLUMN table_number SET NOT NULL;

-- 5) Añadir índice
DROP INDEX IF EXISTS idx_open_orders_tenant_table;
CREATE INDEX idx_open_orders_tenant_table
    ON public.open_orders(tenant_id, table_number);

-- 6) Recargar
NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT table_number, count(*)
FROM public.open_orders
GROUP BY table_number
ORDER BY table_number;
