-- =====================================================================
-- MOZONA TPV — database/29_cleanup_phantom_data.sql
-- =====================================================================
-- Limpieza de datos fantasma (clientes de prueba que no deben estar).
-- ANTES de ejecutar, hacer backup:
--   1) Ve a Supabase Dashboard → Database → Backups → Create backup
--   2) O ejecuta: pg_dump (si tienes acceso)
--
-- INSTRUCCIONES:
-- 1) Revisa cada SELECT antes de DELETE para confirmar
-- 2) Si hay datos legitimos, ajusta los WHERE
-- 3) Ejecuta en SQL Editor de Supabase
-- =====================================================================

-- ★ Ver tenants "fantasma" (sin email válido, sin owner_id, etc.)
SELECT id, name, contact_email, plan_selected, activation_status, created_at
FROM tenants
WHERE
    -- Sin email de contacto
    contact_email IS NULL
    -- O email de prueba conocido
    OR contact_email IN ('sshtravel22@gmail.com', 'nassimouzouna50@gmail.com', 'test@test.com', 'admin@admin.com', 'demo@demo.com')
    -- O email con patrones sospechosos
    OR contact_email LIKE '%@test.%'
    OR contact_email LIKE '%@example.%'
    OR contact_email LIKE '%@mailinator.%'
    OR contact_email LIKE '%@tempmail.%'
    -- O sin owner_id
    OR owner_id IS NULL
ORDER BY created_at DESC;

-- ★ Ver auth.users "fantasma" (sin confirmar, sin uso)
SELECT id, email, created_at, email_confirmed_at, last_sign_in_at
FROM auth.users
WHERE
    -- Sin confirmar Y sin uso en 30 días
    (email_confirmed_at IS NULL AND last_sign_in_at IS NULL AND created_at < NOW() - INTERVAL '30 days')
    -- O emails de prueba
    OR email IN ('test@test.com', 'admin@admin.com', 'demo@demo.com')
ORDER BY created_at DESC;

-- ════════════════════════════════════════════════════
-- ★ ELIMINAR (descomenta solo cuando estes seguro)
-- ════════════════════════════════════════════════════

-- ★ Eliminar tenants fantasma
-- DELETE FROM tenants
-- WHERE
--     contact_email IS NULL
--     OR contact_email IN ('sshtravel22@gmail.com', 'nassimouzouna50@gmail.com', 'test@test.com', 'admin@admin.com', 'demo@demo.com')
--     OR contact_email LIKE '%@test.%'
--     OR contact_email LIKE '%@example.%'
--     OR contact_email LIKE '%@mailinator.%'
--     OR contact_email LIKE '%@tempmail.%'
--     OR owner_id IS NULL;

-- ★ Eliminar auth.users fantasma (CUIDADO: irreversible)
-- DELETE FROM auth.users
-- WHERE
--     (email_confirmed_at IS NULL AND last_sign_in_at IS NULL AND created_at < NOW() - INTERVAL '30 days')
--     OR email IN ('test@test.com', 'admin@admin.com', 'demo@demo.com');

-- ════════════════════════════════════════════════════
-- ★ DESPUÉS de eliminar tenants, recrear admin_notifications limpia
-- ════════════════════════════════════════════════════

-- TRUNCATE admin_notifications;
-- ALTER SEQUENCE admin_notifications_id_seq RESTART WITH 1;

-- ════════════════════════════════════════════════════
-- ★ Verificación final
-- ════════════════════════════════════════════════════

-- SELECT COUNT(*) AS total_tenants FROM tenants;
-- SELECT COUNT(*) AS total_users FROM auth.users;
-- SELECT COUNT(*) AS total_notifications FROM admin_notifications;
