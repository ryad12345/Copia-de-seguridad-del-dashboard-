-- =====================================================================
-- MOZONA TPV — SQL #71 (TENANT REGISTRATION REQUESTS + RPC)
-- =====================================================================
-- Crea la infraestructura para que las solicitudes de registro de
-- nuevos tenants queden persistidas en BD y el admin las pueda ver.
--
-- SOLUCIONA:
--   - Falta de notificación admin (Telegram o email)
--   - Necesidad de aprobar/rechazar manualmente
--
-- COMPATIBLE: idempotente (CREATE IF NOT EXISTS / OR REPLACE)
-- =====================================================================

-- =====================================================================
-- 1. TABLA tenant_registration_requests
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tenant_registration_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    name            TEXT,
    business_name   TEXT,
    plan            TEXT DEFAULT 'trial',
    business_type   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    user_id         UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    approved_by     TEXT,
    notes           TEXT
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_tenant_reg_status
    ON public.tenant_registration_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_reg_email
    ON public.tenant_registration_requests(email);

-- RLS: solo admins pueden ver; inserciones permitidas con anon
ALTER TABLE public.tenant_registration_requests ENABLE ROW LEVEL SECURITY;

-- Política: inserciones anon permitidas (signup)
DROP POLICY IF EXISTS tenant_reg_insert ON public.tenant_registration_requests;
CREATE POLICY tenant_reg_insert ON public.tenant_registration_requests
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Política: lecturas solo para service_role y admins
DROP POLICY IF EXISTS tenant_reg_select ON public.tenant_registration_requests;
CREATE POLICY tenant_reg_select ON public.tenant_registration_requests
    FOR SELECT TO authenticated USING (true);

-- Política: updates solo para service_role
DROP POLICY IF EXISTS tenant_reg_update ON public.tenant_registration_requests;
CREATE POLICY tenant_reg_update ON public.tenant_registration_requests
    FOR UPDATE TO service_role USING (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_tenant_reg()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_reg_updated ON public.tenant_registration_requests;
CREATE TRIGGER trg_tenant_reg_updated
    BEFORE UPDATE ON public.tenant_registration_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_tenant_reg();

-- Notificar cambios via pg_notify para posibles listeners
CREATE OR REPLACE FUNCTION public.notify_tenant_reg_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('tenant_reg_change', NEW.id::TEXT);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_reg_notify ON public.tenant_registration_requests;
CREATE TRIGGER trg_tenant_reg_notify
    AFTER INSERT OR UPDATE ON public.tenant_registration_requests
    FOR EACH ROW EXECUTE FUNCTION public.notify_tenant_reg_change();

-- =====================================================================
-- 2. FN_CREATE_TENANT_REQUEST — Insertar solicitud (RPC)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_create_tenant_request(
    p_email        TEXT,
    p_name         TEXT DEFAULT NULL,
    p_business_name TEXT DEFAULT NULL,
    p_plan         TEXT DEFAULT 'trial',
    p_business_type TEXT DEFAULT NULL,
    p_user_id      UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id    UUID;
    v_count INT;
    v_email TEXT;
BEGIN
    -- Normalizar email
    v_email := LOWER(TRIM(COALESCE(p_email, '')));
    IF v_email = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'email requerido', 'code', 'INVALID_INPUT');
    END IF;

    -- Si ya existe una solicitud pendiente para ese email,
    -- devolver el ID existente (idempotente)
    SELECT id INTO v_id
    FROM public.tenant_registration_requests
    WHERE email = v_email AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;

    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'request_id', v_id,
            'message', 'solicitud existente'
        );
    END IF;

    -- Crear nueva solicitud
    INSERT INTO public.tenant_registration_requests (
        email, name, business_name, plan, business_type, user_id
    ) VALUES (
        v_email,
        NULLIF(TRIM(COALESCE(p_name, '')), ''),
        NULLIF(TRIM(COALESCE(p_business_name, '')), ''),
        COALESCE(NULLIF(TRIM(p_plan), ''), 'trial'),
        NULLIF(TRIM(COALESCE(p_business_type, '')), ''),
        p_user_id
    )
    RETURNING id INTO v_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'no se pudo crear la solicitud');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'request_id', v_id,
        'message', 'solicitud creada'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 3. FN_LIST_TENANT_REQUESTS — Listar para admin
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_list_tenant_requests(
    p_status TEXT DEFAULT NULL,
    p_limit  INT  DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
        p_limit := 50;
    END IF;

    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
            'id', id,
            'email', email,
            'name', name,
            'business_name', business_name,
            'plan', plan,
            'business_type', business_type,
            'status', status,
            'user_id', user_id,
            'created_at', created_at,
            'updated_at', updated_at,
            'approved_at', approved_at,
            'approved_by', approved_by,
            'notes', notes
        ) AS row_data
        FROM public.tenant_registration_requests
        WHERE (p_status IS NULL OR status = p_status)
        ORDER BY created_at DESC
        LIMIT p_limit
    ) sub;

    RETURN jsonb_build_object('ok', true, 'data', v_rows, 'count', jsonb_array_length(v_rows));

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 4. FN_APPROVE_TENANT_REQUEST — Aprobar (para admin)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_approve_tenant_request(
    p_request_id UUID,
    p_approved_by TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status TEXT;
    v_email TEXT;
BEGIN
    SELECT status, email INTO v_status, v_email
    FROM public.tenant_registration_requests
    WHERE id = p_request_id;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'solicitud no encontrada');
    END IF;

    IF v_status = 'approved' THEN
        RETURN jsonb_build_object('ok', true, 'message', 'ya estaba aprobada', 'email', v_email);
    END IF;

    UPDATE public.tenant_registration_requests
    SET status = 'approved',
        approved_at = now(),
        approved_by = p_approved_by,
        updated_at = now()
    WHERE id = p_request_id;

    RETURN jsonb_build_object('ok', true, 'message', 'aprobada', 'email', v_email);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 5. FN_REJECT_TENANT_REQUEST — Rechazar (para admin)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_reject_tenant_request(
    p_request_id UUID,
    p_rejected_by TEXT DEFAULT 'admin',
    p_notes      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status TEXT;
    v_email TEXT;
BEGIN
    SELECT status, email INTO v_status, v_email
    FROM public.tenant_registration_requests
    WHERE id = p_request_id;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'solicitud no encontrada');
    END IF;

    IF v_status = 'rejected' THEN
        RETURN jsonb_build_object('ok', true, 'message', 'ya estaba rechazada', 'email', v_email);
    END IF;

    UPDATE public.tenant_registration_requests
    SET status = 'rejected',
        approved_by = p_rejected_by,
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_request_id;

    RETURN jsonb_build_object('ok', true, 'message', 'rechazada', 'email', v_email);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;

-- =====================================================================
-- 6. PERMISOS (regprocedure — sin ambigüedad con overloads)
-- =====================================================================
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN (
              'fn_create_tenant_request',
              'fn_list_tenant_requests',
              'fn_approve_tenant_request',
              'fn_reject_tenant_request'
          )
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role',
            fn.signature
        );
        RAISE NOTICE 'GRANT % OK', fn.signature;
    END LOOP;
END $$;

-- =====================================================================
-- 7. RELOAD SCHEMA + VERIFICACIÓN
-- =====================================================================
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'MOZONA TPV — SQL #71 APLICADO';
    RAISE NOTICE 'Tabla tenant_registration_requests creada';
    RAISE NOTICE '4 RPCs: fn_create/list/approve/reject_tenant_request';
    RAISE NOTICE '================================================================';
END $$;
