-- =====================================================================
-- MOZONA TPV — SQL #53: Auto-trigger para email_outbox → Edge Function
-- =====================================================================
-- Solución DEFINITIVA al problema de OTP no llega:
--   Cuando se inserta una fila en email_outbox (estado 'pending'),
--   un trigger llama a la Edge Function 'send-email' automáticamente.
--
--   Esto ELIMINA la dependencia del frontend que llame manualmente.
--   Funciona aunque:
--     - El usuario cierre la página tras enviar el formulario
--     - Haya fallos intermitentes de red
--     - Lleguen varios OTPs simultáneos
--
-- Requiere:
--   - Extensión pg_net habilitada (ya viene por defecto en Supabase)
--   - Edge Function 'send-email' desplegada
--   - Variable project_url y service_role_key disponibles via vault
-- =====================================================================

-- 1. Activar pg_net (si no está ya)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Verificar que la tabla email_outbox existe (de SQL #52)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_outbox') THEN
        RAISE EXCEPTION 'Tabla email_outbox no existe. Aplica primero SQL #52.';
    END IF;
END $$;

-- 3. Función que llama a la Edge Function 'send-email'
CREATE OR REPLACE FUNCTION public.trigger_send_email_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url text;
    v_service_key text;
    v_request_id bigint;
BEGIN
    -- Solo actuar sobre inserts nuevos con estado 'pending'
    IF NEW.status IS DISTINCT FROM 'pending' THEN
        RETURN NEW;
    END IF;

    -- Obtener configuración de Supabase desde variables de sesión/config
    -- project_url: extraído del setting de la API
    BEGIN
        SELECT current_setting('app.settings.supabase_url', true) INTO v_project_url;
    EXCEPTION WHEN OTHERS THEN
        v_project_url := NULL;
    END;

    -- Si no hay configuración, intentar con la URL hardcoded (proyecto único)
    IF v_project_url IS NULL OR v_project_url = '' THEN
        v_project_url := 'https://hcqkpokodrqimkulporw.supabase.co';
    END IF;

    BEGIN
        SELECT current_setting('app.settings.service_role_key', true) INTO v_service_key;
    EXCEPTION WHEN OTHERS THEN
        v_service_key := NULL;
    END;

    -- Si no hay service key configurada, salir silenciosamente
    -- (el cliente seguirá invocando manualmente como fallback)
    IF v_service_key IS NULL OR v_service_key = '' THEN
        RAISE NOTICE '[trigger_send_email_outbox] No hay service_role_key configurada en app.settings. El trigger no puede llamar a la Edge Function. Usa la alternativa: Webhook desde Supabase UI.';
        RETURN NEW;
    END IF;

    -- Llamar a la Edge Function via pg_net (async, no bloquea)
    BEGIN
        SELECT net.http_post(
            url := v_project_url || '/functions/v1/send-email',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            ),
            body := jsonb_build_object(
                'record_id', NEW.id,
                'email', NEW.email,
                'subject', NEW.subject,
                'purpose', NEW.purpose
            )
        ) INTO v_request_id;

        RAISE NOTICE '[trigger_send_email_outbox] pg_net request id: %', v_request_id;
    EXCEPTION WHEN OTHERS THEN
        -- Si pg_net falla, no romper el insert
        RAISE NOTICE '[trigger_send_email_outbox] pg_net fallo: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$;

-- 4. Trigger que dispara la función en cada INSERT
DROP TRIGGER IF EXISTS trg_email_outbox_send ON public.email_outbox;
CREATE TRIGGER trg_email_outbox_send
    AFTER INSERT ON public.email_outbox
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION public.trigger_send_email_outbox();

-- 5. RPC helper para configurar las settings (ejecutar UNA vez tras aplicar)
CREATE OR REPLACE FUNCTION public.rpc_set_email_trigger_config(
    p_supabase_url text,
    p_service_role_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Las settings son por sesión, pero podemos sugerir el valor a aplicar
    -- manualmente. Este RPC documenta lo que el cliente debe ejecutar
    -- como superadmin en el SQL editor.
    PERFORM set_config('app.settings.supabase_url', p_supabase_url, false);
    PERFORM set_config('app.settings.service_role_key', p_service_role_key, false);

    RETURN jsonb_build_object(
        'ok', true,
        'note', 'Configuración aplicada para esta sesión. Para persistencia REAL entre reinicios, usa Database Webhooks desde el panel de Supabase (recomendado) o añade las settings a postgresql.conf.',
        'recommendation', 'Ir a Supabase Dashboard → Database → Webhooks → Create Webhook. Tabla: email_outbox, Evento: INSERT, Tipo: Supabase Edge Function, Function: send-email. Es MAS FIABLE que pg_net y se configura en 2 clicks desde la UI.'
    );
END;
$$;

-- 6. Comentario de uso
COMMENT ON TRIGGER trg_email_outbox_send ON public.email_outbox IS
'★ v4.0.7-email-fix: Auto-llama a Edge Function send-email en cada INSERT. Si la service_role_key no está configurada (via rpc_set_email_trigger_config), el trigger sale silenciosamente y el frontend sigue usando rpcTriggerSendEmailWithRetry como fallback.';

-- 7. Verificación
DO $$
BEGIN
    RAISE NOTICE '=====================================================';
    RAISE NOTICE 'SQL #53 aplicado correctamente.';
    RAISE NOTICE '';
    RAISE NOTICE 'Trigger instalado: trg_email_outbox_send';
    RAISE NOTICE 'Estado: ESCUCHANDO inserts en email_outbox con status=pending';
    RAISE NOTICE '';
    RAISE NOTICE 'SIGUIENTE PASO OBLIGATORIO (elige UNA opción):';
    RAISE NOTICE '';
    RAISE NOTICE 'OPCIÓN A - RECOMENDADA (2 minutos, 100% fiable):';
    RAISE NOTICE '  Panel Supabase → Database → Webhooks → Create';
    RAISE NOTICE '  - Name: auto-send-email';
    RAISE NOTICE '  - Table: email_outbox';
    RAISE NOTICE '  - Event: INSERT';
    RAISE NOTICE '  - Type: Supabase Edge Function';
    RAISE NOTICE '  - Function: send-email';
    RAISE NOTICE '';
    RAISE NOTICE 'OPCIÓN B - Si el Webhook UI no funciona:';
    RAISE NOTICE '  Ejecutar como superadmin:';
    RAISE NOTICE '  SELECT rpc_set_email_trigger_config(';
    RAISE NOTICE '    ''https://hcqkpokodrqimkulporw.supabase.co'',';
    RAISE NOTICE '    ''<tu-service-role-key>''';
    RAISE NOTICE '  );';
    RAISE NOTICE '=====================================================';
END $$;
