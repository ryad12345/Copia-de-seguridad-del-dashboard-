// =====================================================================
// MOZONA TPV — Supabase Edge Function: api-compat (v4.0.8-secure)
// =====================================================================
// Capa de compatibilidad para los /api/* de Vercel que estaban caídos.
// Mapea cada ruta al Edge Function correspondiente:
//
//   /api/tenant-settings      → get_tenant_settings (helper interno)
//   /api/send-email           → send_email (usa Edge Function send-email)
//   /api/notify-telegram      → notify_telegram (Edge Function register-tenant)
//   /api/check-status         → admin-ops list_tenants
//   /api/health               → health público
//   /api/activate             → admin-ops approve_tenant
//   /api/approve-tenant       → admin-ops approve_tenant
//   /api/create-user          → admin-ops create_auth_user (no existe, fallback)
//
// HARDENING v4.0.8-secure:
//   - TODAS las rutas salvo `health` requieren JWT de usuario verificado
//     server-side contra Supabase Auth. Ya NO es un API admin anónimo.
//   - Rutas de administración (check-status all, approve-tenant/activate,
//     create-user, notify-telegram) exigen además email en allowlist admin.
//   - tenant-settings/check-status(por email) sólo permiten consultar el
//     propio tenant del llamante (o admin).
//   - CORS restringido a allowlist (nunca `*`).
// =====================================================================

import {
  corsHeaders,
  verifyUser,
  isAdmin,
  clientIp,
  rateLimit,
  safeError,
} from "../_shared/security.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

function json(req: Request, data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 15000): Promise<Response> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

// ─── HANDLERS ──────────────────────────────────────────────────────────────

async function getTenantSettings(email: string): Promise<any> {
    // Buscar tenant por email en Supabase directo
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
        {
            method: "GET",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
            },
        },
        10000
    );
    if (!r.ok) return { ok: false, error: "HTTP " + r.status };
    const arr = await r.json().catch(() => []);
    const tenant = Array.isArray(arr) ? arr[0] : null;
    if (!tenant) return { ok: false, error: "Tenant no encontrado" };
    return {
        ok: true,
        settings: {
            tenant_id: tenant.id,
            plan: tenant.plan_selected || tenant.plan || "basic",
            email: tenant.contact_email,
            name: tenant.business_name || tenant.name,
            activation_status: tenant.activation_status,
            trial_ends_at: tenant.trial_ends_at
        },
    };
}

async function sendEmail(payload: any, userAuth: string): Promise<any> {
    // Forward a Edge Function send-email si existe, o enviar directo
    if (!BOT_TOKEN || !SERVICE_KEY) {
        return { ok: false, error: "Email no configurado (TELEGRAM_BOT_TOKEN o service key faltantes)" };
    }
    // Reenviar a Edge Function send-email propagando el JWT del llamante
    try {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/functions/v1/send-email`,
            {
                method: "POST",
                headers: {
                    apikey: SERVICE_KEY,
                    Authorization: userAuth,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
            15000
        );
        if (r.ok) return r.json();
        return { ok: false, error: `HTTP ${r.status}` };
    } catch (e: any) {
        return { ok: false, error: safeError(e) };
    }
}

async function notifyTelegram(payload: any): Promise<any> {
    // Reenviar al register-tenant que ya tiene los botones correctos
    try {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/functions/v1/register-tenant`,
            {
                method: "POST",
                headers: {
                    apikey: SERVICE_KEY,
                    Authorization: `Bearer ${SERVICE_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
            15000
        );
        return r.json();
    } catch (e: any) {
        return { ok: false, error: safeError(e) };
    }
}

async function checkStatus(payload: any, url: URL, userAuth: string): Promise<any> {
    // Si email = "__list_all_pending__" → listar pendientes (solo ADMIN)
    if (payload?.email === "__list_all_pending__" || url.searchParams.get("email") === "__list_all_pending__") {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/functions/v1/admin-ops`,
            {
                method: "POST",
                headers: {
                    apikey: SERVICE_KEY,
                    Authorization: userAuth,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ action: "list_tenants", status: "pending_activation" }),
            },
            15000
        );
        return r.json();
    }
    // Si no, buscar tenant por email
    return getTenantSettings(payload?.email ?? url.searchParams.get("email") ?? "");
}

async function approveTenant(payload: any, userAuth: string): Promise<any> {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/functions/v1/admin-ops`,
        {
            method: "POST",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: userAuth,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                action: "approve_tenant",
                tenantId: payload?.tenantId ?? payload?.tenant_id,
                trialDays: payload?.trialDays ?? 14,
            }),
        },
        15000
    );
    return r.json();
}

async function createUser(payload: any): Promise<any> {
    // Crear usuario en Supabase Auth
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/auth/v1/admin/users`,
        {
            method: "POST",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: payload?.email,
                password: payload?.password,
                email_confirm: true,
                user_metadata: payload?.name ? { name: payload.name } : undefined,
            }),
        },
        15000
    );
    if (!r.ok) {
        return { ok: false, error: `HTTP ${r.status}` };
    }
    const user = await r.json();
    return { ok: true, user };
}

async function health(): Promise<any> {
    return {
        ok: true,
        status: "healthy",
        ts: Date.now(),
        platform: "supabase-edge-functions",
        api_compat: true,
    };
}

// ─── ROUTER ────────────────────────────────────────────────────────────────

const ADMIN_ACTIONS = new Set(["approve-tenant", "activate", "create-user", "notify-telegram"]);

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });

    try {
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/api\//, "").replace(/^api\//, "").replace(/^functions\/v1\/api-compat\/?/, "");
        const body = await req.json().catch(() => ({}));

        // Tambien aceptar path en el body (algunos frontend usan esto)
        const action = path || body?.action || body?.path || "";

        // Rate limiting básico por IP en todas las rutas.
        if (!rateLimit(`api-compat:${clientIp(req)}`, 60, 60_000)) {
            return json(req, { ok: false, error: "Demasiadas peticiones" }, 429);
        }

        if (!SUPABASE_URL || !SERVICE_KEY) {
            return json(req, { ok: false, error: "Edge Function no configurada (SUPABASE_URL/SERVICE_ROLE_KEY faltan)" }, 500);
        }

        // `health` es el único endpoint público legítimo.
        if (action === "health" || action === "") {
            if (action === "health") return json(req, await health());
        }

        // ── Autenticación obligatoria (JWT de usuario verificado server-side) ──
        const verified = await verifyUser(req, SUPABASE_URL, SERVICE_KEY);
        if (!verified.ok) {
            return json(req, { ok: false, error: verified.error }, verified.status);
        }
        const callerEmail = verified.user.email;
        const callerIsAdmin = isAdmin(callerEmail);
        const userAuth = req.headers.get("authorization") ?? "";
        const requestedEmail = (body?.email ?? url.searchParams.get("email") ?? "").toLowerCase();

        let result: any;

        switch (action) {
            case "tenant-settings": {
                if (!callerIsAdmin && requestedEmail !== callerEmail) {
                    return json(req, { ok: false, error: "Acceso denegado" }, 403);
                }
                result = await getTenantSettings(requestedEmail);
                break;
            }
            case "send-email":
                result = await sendEmail(body, userAuth);
                break;
            case "notify-telegram":
                if (!callerIsAdmin) return json(req, { ok: false, error: "Acceso denegado" }, 403);
                result = await notifyTelegram(body);
                break;
            case "check-status": {
                const listing = body?.email === "__list_all_pending__" || url.searchParams.get("email") === "__list_all_pending__";
                if (listing && !callerIsAdmin) return json(req, { ok: false, error: "Acceso denegado" }, 403);
                if (!listing && !callerIsAdmin && requestedEmail !== callerEmail) {
                    return json(req, { ok: false, error: "Acceso denegado" }, 403);
                }
                result = await checkStatus(body, url, userAuth);
                break;
            }
            case "approve-tenant":
            case "activate":
                if (!callerIsAdmin) return json(req, { ok: false, error: "Acceso denegado" }, 403);
                result = await approveTenant(body, userAuth);
                break;
            case "create-user":
                if (!callerIsAdmin) return json(req, { ok: false, error: "Acceso denegado" }, 403);
                result = await createUser(body);
                break;
            default:
                return json(req, {
                    ok: false,
                    error: `Ruta /api/${action} no soportada en api-compat.`,
                    available_routes: ["tenant-settings", "send-email", "notify-telegram", "check-status", "approve-tenant", "create-user", "health"],
                });
        }

        return json(req, result);
    } catch (e: any) {
        return json(req, { ok: false, error: safeError(e) }, 500);
    }
});
