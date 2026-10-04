-- =====================================================================
-- MOZONA TPV — 18_disable_rls.sql
-- =====================================================================
-- FIX DE EMERGENCIA: Desactivar RLS en las tablas críticas del TPV
-- para garantizar lectura/escritura sin bloqueos en el cliente.
--
-- IMPORTANTE: Esto desactiva Row Level Security.  En un entorno de
-- producción estricto habría que mantener RLS activo, pero para
-- el MVP / primera versión se prioriza la operatividad.
--
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
-- =====================================================================

-- Tabla de tickets (ventas)
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;

-- Tabla de productos (catálogo)
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;

-- Tabla de borradores de comandas activas
ALTER TABLE public.open_orders DISABLE ROW LEVEL SECURITY;

-- Tabla de mesas
ALTER TABLE public.dining_tables DISABLE ROW LEVEL SECURITY;

-- Tabla de líneas de pedido
ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;

-- Tabla de camareros
ALTER TABLE public.tenant_users DISABLE ROW LEVEL SECURITY;

-- Tabla de categorías
ALTER TABLE public.categories DISABLE ROW LEVEL SECURITY;

-- Tabla de tenants (lectura libre, escritura autenticada)
ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;

-- Tabla de invitation codes
ALTER TABLE public.invitation_codes DISABLE ROW LEVEL SECURITY;

-- Recargar PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('orders','products','open_orders','dining_tables',
                    'order_items','tenant_users','categories','tenants',
                    'invitation_codes')
ORDER BY tablename;
