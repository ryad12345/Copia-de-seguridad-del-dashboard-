-- =====================================================================
-- MOZONA TPV — SQL #66 (DROP LIMPIEZA DE FUNCIONES DUPLICADAS)
-- =====================================================================
-- EJECUTAR ESTE SCRIPT PRIMERO si ves el error:
--   ERROR: 42725: function name "public.fn_atomic_checkout" is not unique
--
-- Este script elimina TODAS las versiones (sobrecargas) de las
-- funciones fn_* en el schema public. Es seguro ejecutarlo aunque
-- no existan.
--
-- DESPUÉS de ejecutar este script:
--   1. Re-ejecutar SQL #65 (65_RPC_SECURITY_DEFINER.sql)
--   2. Eso crea las versiones limpias
-- =====================================================================

DO $$
DECLARE fn record;
    v_dropped INT := 0;
BEGIN
    FOR fn IN (
        SELECT DISTINCT proname FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname LIKE 'fn_%'
    ) LOOP
        BEGIN
            EXECUTE format('DROP FUNCTION IF EXISTS public.%I CASCADE', fn.proname);
            v_dropped := v_dropped + 1;
            RAISE NOTICE 'DROP public.%() OK', fn.proname;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'DROP public.%() skip: %', fn.proname, SQLERRM;
        END;
    END LOOP;
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Funciones eliminadas: %', v_dropped;
    RAISE NOTICE '========================================';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Bloque DO fallo: %', SQLERRM;
END $$;

-- Verificar que NO quedan funciones fn_*
SELECT 'post_drop_count' AS check, COUNT(*) AS cnt FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname LIKE 'fn_%';

NOTIFY pgrst, 'reload schema';
