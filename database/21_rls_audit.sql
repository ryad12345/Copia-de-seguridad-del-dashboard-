-- =====================================================================
-- MOZONA TPV — 21_rls_audit.sql
-- =====================================================================
-- AUDITORÍA DE POLÍTICAS RLS (Row Level Security)
-- Diagnóstico NO destructivo. NO modifica nada.
-- Ejecutar en Supabase SQL Editor y leer los resultados.
-- =====================================================================

-- ============================================================
-- 1. TABLAS PÚBLICAS Y ESTADO DE RLS
-- ============================================================
SELECT
    '1_TABLAS_RLS' AS seccion,
    tablename,
    rowsecurity                              AS rls_habilitado,
    forcerowsecurity                         AS rls_forzado,
    CASE
        WHEN rowsecurity THEN '🟢 RLS activo'
        ELSE                '🔴 RLS INACTIVO (cualquiera lee/escribe)'
    END                                      AS estado
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY
    CASE WHEN rowsecurity THEN 1 ELSE 0 END,  -- primero las que NO tienen RLS
    tablename;

-- ============================================================
-- 2. POLÍTICAS RLS ACTIVAS POR TABLA
-- ============================================================
SELECT
    '2_POLITICAS' AS seccion,
    tablename,
    policyname                                AS politica,
    cmd                                       AS operacion,    -- SELECT/INSERT/UPDATE/DELETE/ALL
    roles                                     AS aplica_a,
    permissive                                AS tipo,
    CASE WHEN length(qual) > 80
         THEN substring(qual, 1, 80) || '...'
         ELSE qual END                        AS using_expr,
    CASE WHEN length(with_check) > 80
         THEN substring(with_check, 1, 80) || '...'
         ELSE with_check END                  AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ============================================================
-- 3. TABLAS SIN NINGUNA POLÍTICA (HUÉRFANAS)
-- ============================================================
SELECT
    '3_HUERFANAS' AS seccion,
    t.tablename,
    '⚠️  ' || t.tablename
        || ' existe pero NO tiene políticas. '
        || CASE WHEN t.rowsecurity
                THEN 'RLS activo pero nadie pasa el filtro = 0 filas visibles.'
                ELSE 'RLS INACTIVO = acceso total.'
           END AS aviso
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename  = t.tablename
  )
ORDER BY t.tablename;

-- ============================================================
-- 4. PERMISOS A NIVEL DE TABLA (GRANTs)
-- ============================================================
SELECT
    '4_GRANTS' AS seccion,
    table_name                                AS tabla,
    grantee                                   AS rol,
    privilege_type                            AS permiso
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- ============================================================
-- 5. FUNCIONES RPC EXISTENTES (¿usamos SECURITY DEFINER?)
-- ============================================================
SELECT
    '5_RPC' AS seccion,
    p.proname                                 AS funcion,
    pg_get_function_arguments(p.oid)          AS args,
    CASE p.prosecdef
        WHEN true THEN '🛡️  SECURITY DEFINER (bypasa RLS)'
        ELSE                  '⚙️  SECURITY INVOKER (respeta RLS)'
    END                                      AS modo,
    array_to_string(p.proacl, ', ')           AS grants
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind  = 'f'
ORDER BY p.proname;

-- ============================================================
-- 6. TRIGGERS PELIGROSOSOS (los que rompen UPDATE)
-- ============================================================
SELECT
    '6_TRIGGERS' AS seccion,
    trigger_name                              AS trigger,
    event_object_table                        AS tabla,
    action_timing || ' ' || event_manipulation AS cuando,
    SUBSTRING(action_statement, 1, 120)
        || CASE WHEN length(action_statement) > 120 THEN '...' ELSE '' END
                                              AS codigo
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ============================================================
-- 7. COLUMNAS CLAVE PRESENTES (sanity check de esquema)
-- ============================================================
SELECT
    '7_ESQUEMA' AS seccion,
    table_name                                AS tabla,
    column_name                               AS columna,
    data_type                                 AS tipo
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'orders', 'order_items', 'products', 'categories',
      'dining_tables', 'tenants', 'tenant_users', 'waiters'
  )
  AND column_name IN (
      'id', 'tenant_id', 'status', 'is_active',
      'created_at', 'updated_at', 'deleted_at', 'owner_id'
  )
ORDER BY table_name, column_name;

-- ============================================================
-- 8. RESUMEN EJECUTIVO (1 línea por tabla crítica)
-- ============================================================
SELECT
    '8_RESUMEN' AS seccion,
    t.tablename,
    CASE WHEN t.rowsecurity THEN '🟢 ON ' ELSE '🔴 OFF' END AS rls,
    COALESCE(p.cnt, 0) AS politicas,
    CASE
        WHEN NOT t.rowsecurity AND COALESCE(p.cnt, 0) = 0
            THEN '🚨 CRÍTICO — sin RLS y sin políticas. Acceso público total.'
        WHEN t.rowsecurity AND COALESCE(p.cnt, 0) = 0
            THEN '⚠️  RLS activo pero 0 políticas = nadie ve nada.'
        WHEN t.rowsecurity AND COALESCE(p.cnt, 0) BETWEEN 1 AND 3
            THEN '🟡 RLS parcial — faltan políticas para algunas operaciones.'
        WHEN t.rowsecurity AND COALESCE(p.cnt, 0) >= 4
            THEN '🟢 RLS completo.'
        ELSE '?'
    END AS veredicto
FROM pg_tables t
LEFT JOIN (
    SELECT tablename, count(*) AS cnt
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY tablename
) p ON p.tablename = t.tablename
WHERE t.schemaname = 'public'
  AND t.tablename IN (
      'orders', 'order_items', 'products', 'categories',
      'dining_tables', 'tenants', 'tenant_users', 'waiters'
  )
ORDER BY veredicto, t.tablename;

-- =====================================================================
-- FIN DEL DIAGNÓSTICO
-- =====================================================================
-- CÓMO INTERPRETAR:
-- • Sección 1 → qué tablas tienen RLS físico activo
-- • Sección 2 → qué políticas concretas hay
-- • Sección 3 → tablas que SÍ deberían tener políticas y no las tienen
-- • Sección 4 → permisos GRANT a nivel SQL (separado de RLS)
-- • Sección 5 → qué funciones usan SECURITY DEFINER (saltan RLS)
-- • Sección 6 → triggers que pueden romper operaciones (ej. updated_at)
-- • Sección 7 → columnas reales para validar esquema defensivo
-- • Sección 8 → resumen ejecutivo con semáforo
-- =====================================================================
