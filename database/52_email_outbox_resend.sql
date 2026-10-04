-- =====================================================================
-- MOZONA TPV — SQL #52 — Email Outbox + Resend Integration
-- =====================================================================
-- Sistema completo de envío de emails transaccionales sin depender del
-- SMTP nativo de Supabase.
--
-- ARQUITECTURA:
--   1. Frontend llama rpc_send_otp_code(email) → genera código 6 dígitos,
--      lo guarda en email_verification_codes, y crea un registro en
--      email_outbox con el template HTML renderizado.
--   2. Edge Function `send-email` (Deno) hace polling de email_outbox y
--      envía via Resend API (https://api.resend.com/emails).
--   3. Tras envío exitoso, marca status='sent' y sent_at=now().
--   4. Si falla, status='failed' con error_message, retry_count++.
--
-- CLIENTE DEBE CONFIGURAR:
--   - Crear cuenta en https://resend.com (free tier: 100 emails/día)
--   - Obtener API key
--   - Añadir a Supabase Edge Function Secrets como RESEND_API_KEY
--   - (Opcional) Verificar dominio mozonatpv.com para FROM=hello@mozonatpv.com
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. TABLA email_outbox (cola de emails pendientes)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    html_body TEXT NOT NULL,
    text_body TEXT,
    from_email TEXT NOT NULL DEFAULT 'hello@mozonatpv.com',
    from_name TEXT NOT NULL DEFAULT 'MOZONA TPV',
    reply_to TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','bounced')),
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB,
    related_to TEXT,  -- 'otp_signup', 'otp_login', 'welcome', etc.
    related_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON public.email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON public.email_outbox(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_to ON public.email_outbox(to_email);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON public.email_outbox(created_at DESC);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_outbox_admin ON public.email_outbox;
CREATE POLICY pol_outbox_admin ON public.email_outbox FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pol_outbox_insert_anon ON public.email_outbox;
CREATE POLICY pol_outbox_insert_anon ON public.email_outbox FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT ALL ON public.email_outbox TO authenticated;
GRANT INSERT ON public.email_outbox TO anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. RPC: enviar código OTP por email
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_send_otp_code(
    p_email TEXT,
    p_purpose TEXT DEFAULT 'signup',
    p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_code TEXT;
    v_expires TIMESTAMPTZ;
    v_code_id UUID;
    v_outbox_id UUID;
    v_html TEXT;
    v_text TEXT;
    v_subject TEXT;
BEGIN
    -- Generar código de 6 dígitos
    v_code := LPAD((floor(random() * 1000000))::text, 6, '0');
    v_expires := now() + interval '15 minutes';

    -- Guardar código
    INSERT INTO public.email_verification_codes (email, code, purpose, expires_at)
    VALUES (LOWER(p_email), v_code, p_purpose, v_expires)
    RETURNING id INTO v_code_id;

    -- Renderizar email HTML
    v_subject := CASE p_purpose
        WHEN 'signup' THEN 'Tu código de acceso a MOZONA TPV'
        WHEN 'login'  THEN 'Tu código de acceso a MOZONA TPV'
        WHEN 'reset'  THEN 'Restablece tu contraseña en MOZONA TPV'
        ELSE 'Tu código de acceso a MOZONA TPV'
    END;

    v_html := format('<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%s</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background:#f8fafc;padding:40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,0.06);">
                    <!-- Logo / Header -->
                    <tr>
                        <td style="padding:36px 32px 24px 32px;text-align:center;border-bottom:1px solid #f1f5f9;">
                            <div style="display:inline-block;padding:10px 18px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#ffffff;border-radius:12px;font-weight:900;font-size:18px;letter-spacing:-0.3px;">
                                MOZONA TPV
                            </div>
                            <p style="margin:14px 0 0 0;font-size:13px;color:#64748b;font-weight:500;">
                                Tu sistema de gestion para hosteleria
                            </p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:32px;">
                            <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:900;color:#0f172a;letter-spacing:-0.3px;">
                                Hola%s
                            </h1>
                            <p style="margin:0 0 24px 0;font-size:14px;color:#475569;line-height:1.6;">
                                %s
                            </p>

                            <!-- Código OTP -->
                            <div style="background:linear-gradient(135deg,#f8fafc,#e2e8f0);border:2px dashed #cbd5e1;border-radius:14px;padding:28px;text-align:center;margin:24px 0;">
                                <p style="margin:0 0 8px 0;font-size:11px;color:#64748b;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">
                                    Tu codigo de verificacion
                                </p>
                                <p style="margin:0;font-size:38px;font-weight:900;color:#7c3aed;letter-spacing:8px;font-family:Consolas,Courier New,monospace;">
                                    %s
                                </p>
                                <p style="margin:12px 0 0 0;font-size:12px;color:#64748b;">
                                    Caduca en 15 minutos
                                </p>
                            </div>

                            <p style="margin:24px 0 0 0;font-size:13px;color:#64748b;line-height:1.6;">
                                Si no has solicitado este codigo, puedes ignorar este mensaje.
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding:20px 32px;background:#f8fafc;text-align:center;border-top:1px solid #f1f5f9;">
                            <p style="margin:0;font-size:11px;color:#94a3b8;">
                                © %s MOZONA TPV · Madrid, España
                            </p>
                            <p style="margin:4px 0 0 0;font-size:11px;color:#94a3b8;">
                                <a href="https://mozonatpv.site" style="color:#7c3aed;text-decoration:none;">mozonatpv.site</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>',
        v_subject,
        CASE WHEN p_user_name IS NOT NULL AND p_user_name != '' THEN ', ' || p_user_name ELSE '' END,
        CASE p_purpose
            WHEN 'signup' THEN 'Gracias por registrarte en MOZONA TPV. Introduce este codigo en la pantalla de verificacion para activar tu cuenta y empezar a usar tu TPV.'
            WHEN 'login'  THEN 'Introduce este codigo para verificar tu identidad y acceder a tu panel.'
            WHEN 'reset'  THEN 'Usa este codigo para crear una nueva contrasena para tu cuenta.'
            ELSE 'Introduce este codigo para continuar.'
        END,
        v_code,
        extract(year from now())::TEXT
    );

    -- Versión texto plano
    v_text := format('MOZONA TPV
Tu codigo de verificacion: %s

Caduca en 15 minutos.

Si no has solicitado este codigo, ignora este mensaje.

© MOZONA TPV · https://mozonatpv.site', v_code);

    -- Insertar en outbox para envío asíncrono
    INSERT INTO public.email_outbox (
        to_email, to_name, subject, html_body, text_body,
        related_to, related_id, metadata
    )
    VALUES (
        LOWER(p_email),
        p_user_name,
        v_subject,
        v_html,
        v_text,
        'otp_' || p_purpose,
        v_code_id,
        jsonb_build_object('code_id', v_code_id, 'purpose', p_purpose, 'expires_at', v_expires)
    )
    RETURNING id INTO v_outbox_id;

    -- Log
    INSERT INTO public.edge_function_logs (function_name, action, success, error_msg)
    VALUES ('rpc_send_otp_code', 'otp_' || p_purpose, true, p_email);

    RETURN jsonb_build_object(
        'ok', true,
        'code_id', v_code_id,
        'outbox_id', v_outbox_id,
        'expires_at', v_expires,
        'message', 'Codigo generado y en cola para envio'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_send_otp_code(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RPC: verificar código OTP
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_verify_otp_code(
    p_email TEXT,
    p_code TEXT,
    p_purpose TEXT DEFAULT 'signup'
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_record RECORD;
BEGIN
    SELECT * INTO v_record
    FROM public.email_verification_codes
    WHERE LOWER(email) = LOWER(p_email)
      AND code = p_code
      AND purpose = p_purpose
      AND used_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_record IS NULL THEN
        UPDATE public.email_verification_codes
        SET attempts = attempts + 1
        WHERE LOWER(email) = LOWER(p_email)
          AND code = p_code
          AND used_at IS NULL;
        RETURN jsonb_build_object('ok', false, 'error', 'Codigo incorrecto o expirado');
    END IF;

    UPDATE public.email_verification_codes
    SET used_at = now()
    WHERE id = v_record.id;

    RETURN jsonb_build_object('ok', true, 'verified', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_verify_otp_code(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RPC: ver estado del último email enviado a una dirección
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_get_email_status(
    p_email TEXT,
    p_limit INTEGER DEFAULT 5
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(e)) INTO v_result
    FROM (
        SELECT id, subject, status, retry_count, last_error,
               sent_at, created_at, related_to
        FROM public.email_outbox
        WHERE to_email = LOWER(p_email)
        ORDER BY created_at DESC
        LIMIT p_limit
    ) e;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_email_status(TEXT, INTEGER) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPCs auxiliares para Edge Function send-email
-- ═══════════════════════════════════════════════════════════════════════

-- Obtener emails pendientes
CREATE OR REPLACE FUNCTION public.rpc_get_pending_emails(
    p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(row_to_json(e)) INTO v_result
    FROM (
        SELECT id, to_email, to_name, subject, html_body, text_body,
               from_email, from_name, reply_to, retry_count, created_at
        FROM public.email_outbox
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT p_limit
    ) e;

    RETURN jsonb_build_object('ok', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_pending_emails(INTEGER) TO service_role;

-- Marcar email como enviado
CREATE OR REPLACE FUNCTION public.rpc_mark_email_sent(
    p_id UUID,
    p_provider_id TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.email_outbox
    SET status = 'sent',
        sent_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('provider_id', p_provider_id)
    WHERE id = p_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_mark_email_sent(UUID, TEXT) TO service_role;

-- Marcar email como fallido
CREATE OR REPLACE FUNCTION public.rpc_mark_email_failed(
    p_id UUID,
    p_error TEXT
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.email_outbox
    SET status = CASE WHEN retry_count >= 3 THEN 'failed' ELSE 'pending' END,
        retry_count = retry_count + 1,
        last_error = p_error
    WHERE id = p_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_mark_email_failed(UUID, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. EDGE FUNCTION SEND-EMAIL (código Deno)
-- ═══════════════════════════════════════════════════════════════════════
-- Esta Edge Function hace polling de email_outbox y envía via Resend API.
-- Debe desplegarse MANUALMENTE en Supabase Dashboard → Edge Functions.
--
-- Pasos para desplegar:
--   1. Ve a https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/functions
--   2. Click "New function" → nombre: send-email
--   3. Click "Secrets" → añade RESEND_API_KEY con tu API key de resend.com
--   4. Pega este código Deno y click "Deploy"
--
-- DESPUÉS, en Supabase Dashboard → Database → Cron Jobs, programa:
--   SELECT cron.schedule('send-emails', '* * * * *',
--     $$ SELECT net.http_post(
--          'https://hcqkpokodrqimkulporw.supabase.co/functions/v1/send-email',
--          '{}',
--          jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
--        ); $$);
--
-- O llamarla manualmente desde el cliente via supabase.functions.invoke('send-email').
-- ═══════════════════════════════════════════════════════════════════════
/*
// supabase/functions/send-email/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "hello@mozonatpv.com";
const RESEND_FROM_NAME = Deno.env.get("RESEND_FROM_NAME") ?? "MOZONA TPV";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
    if (!RESEND_API_KEY) {
        return new Response(
            JSON.stringify({ ok: false, error: "RESEND_API_KEY no configurado en Edge Function Secrets" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    try {
        // 1. Obtener emails pendientes
        const { data: emails, error: fetchErr } = await supabase.rpc("rpc_get_pending_emails", { p_limit: 10 });
        if (fetchErr) throw new Error(`fetch error: ${fetchErr.message}`);
        if (!emails?.data || emails.data.length === 0) {
            return new Response(JSON.stringify({ ok: true, processed: 0 }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // 2. Enviar cada uno via Resend
        let sent = 0, failed = 0;
        for (const email of emails.data) {
            try {
                const resp = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${RESEND_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
                        to: [email.to_email],
                        subject: email.subject,
                        html: email.html_body,
                        text: email.text_body,
                        reply_to: email.reply_to || "support@mozonatpv.com",
                    }),
                });

                if (resp.ok) {
                    const result = await resp.json();
                    await supabase.rpc("rpc_mark_email_sent", {
                        p_id: email.id,
                        p_provider_id: result.id ?? null,
                    });
                    sent++;
                } else {
                    const errText = await resp.text();
                    await supabase.rpc("rpc_mark_email_failed", {
                        p_id: email.id,
                        p_error: `Resend ${resp.status}: ${errText.slice(0, 200)}`,
                    });
                    failed++;
                }
            } catch (e: any) {
                await supabase.rpc("rpc_mark_email_failed", {
                    p_id: email.id,
                    p_error: e?.message ?? String(e),
                });
                failed++;
            }
        }

        return new Response(
            JSON.stringify({ ok: true, sent, failed, total: emails.data.length }),
            { headers: { "Content-Type": "application/json" } }
        );
    } catch (e: any) {
        return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
});
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 7. AUDITORIA FINAL
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_table_count INT;
    v_rpc_count INT;
BEGIN
    SELECT count(*) INTO v_table_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'email_outbox';

    SELECT count(*) INTO v_rpc_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'rpc_send_otp_code',
          'rpc_verify_otp_code',
          'rpc_get_email_status',
          'rpc_get_pending_emails',
          'rpc_mark_email_sent',
          'rpc_mark_email_failed'
      );

    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  MOZONA TPV — SQL #52 APLICADO';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '  Tabla email_outbox: creada (% tabla)', v_table_count;
    RAISE NOTICE '  RPCs de email: % (esperado: 6)', v_rpc_count;
    RAISE NOTICE '';
    RAISE NOTICE '  SIGUIENTE PASO: Desplegar Edge Function send-email';
    RAISE NOTICE '  (ver seccion 6 del SQL para instrucciones)';
    RAISE NOTICE '';
    RAISE NOTICE '  PLAN GRATUITO: Resend free tier = 100 emails/dia';
    RAISE NOTICE '  URL: https://resend.com';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;
