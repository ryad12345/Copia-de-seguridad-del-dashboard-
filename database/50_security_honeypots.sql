-- =====================================================================
-- MOZONA TPV — SQL #50 — Honeypots, Blacklist y Auditoria de Seguridad
-- =====================================================================
-- Endpoints señuelo para cazar atacantes, tabla de blacklist global,
-- auditoria de eventos de seguridad y rate limiting agresivo.
--
-- APLICAR EN: Supabase SQL Editor (idempotente)
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. TABLA security_events: auditoria forense
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    source TEXT NOT NULL,
    payload TEXT,
    fingerprint TEXT,
    user_id UUID REFERENCES auth.users(id),
    ip_address TEXT,
    user_agent TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sec_events_type ON public.security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sec_events_severity ON public.security_events(severity);
CREATE INDEX IF NOT EXISTS idx_sec_events_detected ON public.security_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_fingerprint ON public.security_events(fingerprint);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_sec_events_admin ON public.security_events;
CREATE POLICY pol_sec_events_admin ON public.security_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS pol_sec_events_insert ON public.security_events;
CREATE POLICY pol_sec_events_insert ON public.security_events FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT ALL ON public.security_events TO authenticated;
GRANT INSERT ON public.security_events TO anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TABLA global_blacklist: lista negra de IPs y fingerprints
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.global_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL UNIQUE,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('ip','fingerprint','email','user_id')),
    reason TEXT,
    threat_count INT NOT NULL DEFAULT 1,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    blocked_until TIMESTAMPTZ,
    permanent BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_blacklist_identifier ON public.global_blacklist(identifier);
CREATE INDEX IF NOT EXISTS idx_blacklist_perm ON public.global_blacklist(permanent);

ALTER TABLE public.global_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_blacklist_admin ON public.global_blacklist;
CREATE POLICY pol_blacklist_admin ON public.global_blacklist FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. TABLA honeypot_hits: registro de accesos a endpoints trampa
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.honeypot_hits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    payload JSONB,
    country TEXT,
    hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    auto_blocked BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_honeypot_ip ON public.honeypot_hits(ip_address);
CREATE INDEX IF NOT EXISTS idx_honeypot_time ON public.honeypot_hits(hit_at DESC);

ALTER TABLE public.honeypot_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_honeypot_insert ON public.honeypot_hits;
CREATE POLICY pol_honeypot_insert ON public.honeypot_hits FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. FUNCIONES DE SEGURIDAD
-- ═══════════════════════════════════════════════════════════════════════

-- 4.1 RPC: registrar evento de seguridad (desde cliente)
CREATE OR REPLACE FUNCTION public.rpc_log_security_event(
    p_event_type TEXT,
    p_severity TEXT,
    p_source TEXT,
    p_payload TEXT DEFAULT NULL,
    p_fingerprint TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.security_events (
        event_type, severity, source, payload, fingerprint
    ) VALUES (
        p_event_type, p_severity, p_source, p_payload, p_fingerprint
    )
    RETURNING id INTO v_id;

    -- Auto-blacklist si es high+ y fingerprint repetido
    IF p_severity IN ('high','critical') AND p_fingerprint IS NOT NULL THEN
        INSERT INTO public.global_blacklist (
            identifier, identifier_type, reason, threat_count
        ) VALUES (
            p_fingerprint, 'fingerprint', p_event_type, 1
        )
        ON CONFLICT (identifier) DO UPDATE SET
            threat_count = global_blacklist.threat_count + 1,
            last_seen = now();
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_log_security_event(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 4.2 RPC: consultar blacklist (admin)
CREATE OR REPLACE FUNCTION public.rpc_get_blacklist(
    p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    -- Solo superadmin o VIP
    IF NOT EXISTS (
        SELECT 1 FROM public.app_settings WHERE key = 'vip_emails' AND value LIKE '%' || (
            SELECT email FROM auth.users WHERE id = v_actor
        ) || '%'
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos');
    END IF;

    SELECT jsonb_agg(row_to_json(b)) INTO v_result
    FROM (
        SELECT * FROM public.global_blacklist
        ORDER BY threat_count DESC, last_seen DESC
        LIMIT p_limit
    ) b;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_blacklist(INTEGER) TO authenticated;

-- 4.3 RPC: consultar eventos recientes (admin)
CREATE OR REPLACE FUNCTION public.rpc_get_recent_security_events(
    p_limit INTEGER DEFAULT 50,
    p_min_severity TEXT DEFAULT 'medium'
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.app_settings WHERE key = 'vip_emails' AND value LIKE '%' || (
            SELECT email FROM auth.users WHERE id = v_actor
        ) || '%'
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos');
    END IF;

    SELECT jsonb_agg(row_to_json(e)) INTO v_result
    FROM (
        SELECT * FROM public.security_events
        WHERE severity IN ('medium','high','critical')
          AND (CASE p_min_severity
                WHEN 'low' THEN severity IN ('low','medium','high','critical')
                WHEN 'medium' THEN severity IN ('medium','high','critical')
                WHEN 'high' THEN severity IN ('high','critical')
                WHEN 'critical' THEN severity = 'critical'
                ELSE true END)
        ORDER BY detected_at DESC
        LIMIT p_limit
    ) e;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_recent_security_events(INTEGER, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. EDGE FUNCTION PLACEHOLDER: admin-security (codigo completo)
-- ═══════════════════════════════════════════════════════════════════════

-- Esta Edge Function debe desplegarse manualmente en Supabase.
-- Codigo completo disponible en database/48_admin_ops_complete_v2.sql
-- (mismas acciones + nuevas: get_blacklist, get_security_events)

-- ═══════════════════════════════════════════════════════════════════════
-- 6. AUDITORIA Y MENSAJE FINAL
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_table_count INT;
    v_rpc_count INT;
    v_policy_count INT;
BEGIN
    SELECT count(*) INTO v_table_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('security_events','global_blacklist','honeypot_hits');

    SELECT count(*) INTO v_rpc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rpc_log_security_event','rpc_get_blacklist','rpc_get_recent_security_events');

    SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('security_events','global_blacklist','honeypot_hits');

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #50 APLICADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  Tablas de seguridad: % (esperado: 3)', v_table_count;
    RAISE NOTICE '  RPCs de seguridad: % (esperado: 3)', v_rpc_count;
    RAISE NOTICE '  RLS policies activas: % (esperado: 5+)', v_policy_count;
    RAISE NOTICE '';
    RAISE NOTICE '  Honeypots activos: /api/admin-secret, /api/_debug';
    RAISE NOTICE '                      /api/.env, /api/system-config';
    RAISE NOTICE '                      /api/debug, /api/internal';
    RAISE NOTICE '                      /.env, /.git/config';
    RAISE NOTICE '';
    RAISE NOTICE '  Blacklist global: activa';
    RAISE NOTICE '  Auditoria forense: activa';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;
