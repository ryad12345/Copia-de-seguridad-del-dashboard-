// =====================================================================
// MOZONA TPV — Supabase Edge Function: auth-otp (v4.0.8-secure)
// =====================================================================
// Reemplaza /api/business-intelligence?action=send-otp y verify-otp
// Usa SERVICE_ROLE_KEY para crear/buscar users + bypass RLS
//
// HARDENING v4.0.8-secure:
//   - Ya NO se devuelve `dev_code` al cliente (era un bypass total del OTP).
//   - CORS restringido a allowlist (nunca `*`).
//   - Rate limiting por IP+email en send-otp y por email en verify-otp.
//   - Comparación de OTP en tiempo constante + límite de intentos.
//   - Errores genéricos (sin filtrar detalles de DB).
// =====================================================================

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?target=denonext";
import {
  corsHeaders,
  timingSafeEqual,
  rateLimit,
  clientIp,
  safeError,
} from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://hcqkpokodrqimkulporw.supabase.co";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// VIP allowlist configurable por env. Si no se configura, lista vacía
// (no hay bypass de OTP hardcodeado).
function vipEmails(): string[] {
  return (Deno.env.get("VIP_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isVip(email: string): boolean {
  return vipEmails().includes((email || "").toLowerCase());
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const MAX_VERIFY_ATTEMPTS = 5;

serve(async (req) => {
  const cors = corsHeaders(req, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "send-otp";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const ip = clientIp(req);

    if (!SERVICE_KEY) {
      return respond({
        ok: false,
        friendly_message: "Servicio de autenticacion no disponible. Contacta con soporte.",
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ═══════════════════════════════════════════════════════
    // SEND OTP
    // ═══════════════════════════════════════════════════════
    if (action === "send-otp") {
      const email = (body.email || "").trim().toLowerCase();
      const purpose = body.purpose || "login";

      if (!email) {
        return respond({
          ok: false,
          friendly_message: "Introduce tu correo electronico.",
        });
      }

      // Anti-abuso: máx 5 envíos por email y 20 por IP cada 15 min.
      if (
        !rateLimit(`otp-send:email:${email}`, 5, 15 * 60_000) ||
        !rateLimit(`otp-send:ip:${ip}`, 20, 15 * 60_000)
      ) {
        return respond({
          ok: false,
          friendly_message: "Demasiadas solicitudes. Inténtalo más tarde.",
        }, 429);
      }

      // VIP bypass (solo si está configurado explícitamente por env).
      if (isVip(email)) {
        return respond({
          ok: true,
          vip_bypass: true,
          message: "Acceso VIP concedido",
          friendly_message: "Acceso VIP concedido",
        });
      }

      // Generar OTP
      const code = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      // Guardar en tabla email_verifications
      const { error: dbErr } = await supabase.from("email_verifications").insert({
        email,
        code,
        purpose,
        expires_at: expiresAt,
        attempts: 0,
        used: false,
      });

      if (dbErr) {
        // No exponer detalles de DB ni el código.
        console.warn("[auth-otp] tabla email_verifications no disponible:", dbErr.message);
        return respond({
          ok: false,
          friendly_message: "No se pudo generar el código. Inténtalo de nuevo.",
        }, 500);
      }

      // Aquí iría el envío real del email (via mail.mozonatpv.com)
      return respond({
        ok: true,
        message: "Codigo enviado",
        friendly_message: "Te enviamos un codigo de 6 digitos a tu correo.",
      });
    }

    // ═══════════════════════════════════════════════════════
    // VERIFY OTP
    // ═══════════════════════════════════════════════════════
    if (action === "verify-otp") {
      const email = (body.email || "").trim().toLowerCase();
      const code = (body.code || "").trim();
      const purpose = body.purpose || "login";

      if (!email || !code) {
        return respond({
          ok: false,
          friendly_message: "Introduce el codigo que te enviamos.",
        });
      }

      // Anti fuerza bruta: máx 10 intentos por email y 30 por IP cada 15 min.
      if (
        !rateLimit(`otp-verify:email:${email}`, 10, 15 * 60_000) ||
        !rateLimit(`otp-verify:ip:${ip}`, 30, 15 * 60_000)
      ) {
        return respond({
          ok: false,
          friendly_message: "Demasiados intentos. Solicita un código nuevo más tarde.",
        }, 429);
      }

      // Recuperar el OTP vigente más reciente para (email, purpose)
      const { data, error } = await supabase
        .from("email_verifications")
        .select("*")
        .eq("email", email)
        .eq("purpose", purpose)
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const genericFail = () =>
        respond({
          ok: false,
          friendly_message: "El codigo no es correcto o ha caducado.",
        });

      if (error || !data) return genericFail();

      // Límite de intentos por registro
      const attempts = Number(data.attempts ?? 0);
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await supabase.from("email_verifications").update({ used: true }).eq("id", data.id);
        return genericFail();
      }

      if (new Date(data.expires_at) < new Date()) {
        return respond({
          ok: false,
          friendly_message: "El codigo ha caducado. Solicita uno nuevo.",
        });
      }

      // Comparación en tiempo constante.
      if (!timingSafeEqual(code, String(data.code ?? ""))) {
        await supabase.from("email_verifications").update({ attempts: attempts + 1 }).eq("id", data.id);
        return genericFail();
      }

      // Marcar como usado
      await supabase.from("email_verifications").update({ used: true }).eq("id", data.id);

      return respond({
        ok: true,
        verified: true,
        message: "Codigo verificado correctamente",
      });
    }

    return respond({
      ok: false,
      friendly_message: "Accion no reconocida.",
    });

  } catch (e) {
    console.warn("[auth-otp] error:", safeError(e));
    return respond({
      ok: false,
      friendly_message: "El servicio no responde. Reintenta en unos segundos.",
    }, 500);
  }
});
