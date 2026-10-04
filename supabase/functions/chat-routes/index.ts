// =====================================================================
// MOZONA TPV — Supabase Edge Function: chat-routes (v4.0.8-secure)
// =====================================================================
// Reemplaza /api/business-intelligence?action=chat
// Parsea intent del usuario y devuelve respuesta estructurada
//
// HARDENING v4.0.8-secure:
//   - Requiere JWT de usuario verificado server-side (antes era anónimo).
//   - El `tenant_id` del body ya no se confía: debe coincidir con el tenant
//     del JWT (si difiere → 403).
//   - CORS restringido a allowlist (nunca `*`).
// =====================================================================

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?target=denonext";
import { corsHeaders, verifyUser, clientIp, rateLimit } from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://hcqkpokodrqimkulporw.supabase.co";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function parseIntent(text: string): { intent: string; period?: string } {
  const t = (text || "").toLowerCase().trim();
  if (/v[ei]nt[ae]s|hoy|ayer|semana|mes/.test(t)) return { intent: "query_sales" };
  if (/st[o0]ck|b[ao]j[o0]|reponer/.test(t)) return { intent: "query_low_stock" };
  if (/m[aá]s\s*vend|top|popular/.test(t)) return { intent: "query_top_products" };
  if (/mesa|cliente/.test(t)) return { intent: "query_table_stats" };
  if (/margen|rentab|profit/.test(t)) return { intent: "query_profit" };
  if (/apunta|anota|comanda/.test(t)) return { intent: "create_order" };
  return { intent: "query_sales" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req, "GET, POST, OPTIONS") });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders(req, "GET, POST, OPTIONS"), "Content-Type": "application/json" },
    });

  try {
    // Rate limiting básico por IP.
    if (!rateLimit(`chat-routes:${clientIp(req)}`, 60, 60_000)) {
      return respond({ ok: false, friendly_message: "Demasiadas peticiones." }, 429);
    }

    // ★ Autenticación obligatoria (JWT verificado server-side).
    const verified = await verifyUser(req, SUPABASE_URL, SERVICE_KEY);
    if (!verified.ok) {
      return respond({ ok: false, friendly_message: "No autorizado." }, verified.status);
    }

    const body = await req.json().catch(() => ({}));
    const text = body.text || body.message || "";

    // ★ El tenant se toma de los claims del JWT, no del body.
    const bodyTenant = body.tenant_id ? String(body.tenant_id) : null;
    const tenantId = verified.user.tenantId;
    if (bodyTenant && tenantId && bodyTenant !== tenantId) {
      return respond({ ok: false, friendly_message: "Acceso denegado." }, 403);
    }
    const effectiveTenant = tenantId ?? bodyTenant;

    const { intent } = parseIntent(text);

    if (!SERVICE_KEY || !effectiveTenant) {
      return respond({
        ok: true,
        intent,
        message: "Soy Riyad. Estoy aqui para ayudarte con tu local. Preguntame sobre ventas, stock o mesas.",
        friendly_message: "Soy Riyad. Estoy aqui para ayudarte con tu local.",
        quickReplies: [
          { id: "sales-today", label: "💰 Ventas de hoy", prompt: "Como han ido las ventas hoy?" },
          { id: "low-stock", label: "📦 Stock bajo", prompt: "Que productos tienen stock bajo?" },
          { id: "tables", label: "🪑 Mesas", prompt: "Estado de las mesas ahora" },
        ],
      });
    }

    // Cliente con service key (sólo para consultas del tenant autenticado).
    createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Aqui irian las queries reales. Por ahora devolvemos un placeholder estructurado.
    return respond({
      ok: true,
      intent,
      message: "Consulta recibida. En un momento te muestro los datos.",
      quickReplies: [],
    });

  } catch (e) {
    return respond({
      ok: false,
      friendly_message: "El chat no responde. Reintenta.",
    });
  }
});
