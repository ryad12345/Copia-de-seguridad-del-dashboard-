// =====================================================================
// MOZONA TPV — Edge Function: create-checkout-session (v4.0.8-secure)
// =====================================================================
// Crea una sesión de Stripe Checkout (modo subscription) para un tenant.
// Devuelve { url } que el frontend abre con window.location.href.
//
// Variables de entorno requeridas:
//   STRIPE_SECRET_KEY         — sk_test_... o sk_live_...
//   STRIPE_PRICE_PLUS         — price_...   (plan Plus 30€/mes)
//   STRIPE_PRICE_PRO          — price_...   (plan Pro  50€/mes)
//   PUBLIC_URL                — https://mozona-tpv.vercel.app  (return URL)
//
// Body:  { plan: "plus" | "pro", tenantId: string }
// Salida:{ url: string, sessionId: string }
//
// Deploy:
//   supabase functions deploy create-checkout-session --no-verify-jwt
//
// HARDENING v4.0.8-secure:
//   - CORS restringido a allowlist (nunca `*`).
//   - (Ya validaba JWT y la propiedad del tenant: se conserva.)
// =====================================================================

// @ts-nocheck  — Deno runtime
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/security.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_PLUS = Deno.env.get("STRIPE_PRICE_PLUS") ?? "";
const STRIPE_PRICE_PRO  = Deno.env.get("STRIPE_PRICE_PRO")  ?? "";
const PUBLIC_URL        = Deno.env.get("PUBLIC_URL")        ?? "http://localhost:5173";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("MOZONA_SUPABASE_SERVICE_KEY") ?? "";

function cors(req: Request): Record<string, string> {
    return corsHeaders(req, "POST, OPTIONS");
}

const PLAN_TO_PRICE: Record<string, string> = {
    plus: STRIPE_PRICE_PLUS,
    pro:  STRIPE_PRICE_PRO,
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: cors(req) });
    }
    if (req.method !== "POST") {
        return jsonError(req, 405, "Method not allowed");
    }

    try {
        if (!STRIPE_SECRET_KEY) return jsonError(req, 500, "STRIPE_SECRET_KEY no configurada");
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            return jsonError(req, 500, "Supabase no configurado");
        }

        // 1) Validar usuario autenticado ---------------------------------
        const authHeader = req.headers.get("Authorization") ?? "";
        const jwt = authHeader.replace(/^Bearer\s+/i, "");
        if (!jwt) return jsonError(req, 401, "Falta token de autenticación");

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userRes, error: userErr } = await adminClient.auth.getUser(jwt);
        if (userErr || !userRes?.user) return jsonError(req, 401, "Sesión inválida");
        const user = userRes.user;

        // 2) Body --------------------------------------------------------
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") return jsonError(req, 400, "Body inválido");
        const { plan, tenantId } = body as { plan?: string; tenantId?: string };
        if (!plan || !(plan in PLAN_TO_PRICE)) {
            return jsonError(req, 400, `Plan inválido.  Usa "plus" o "pro".`);
        }
        const priceId = PLAN_TO_PRICE[plan];
        if (!priceId) return jsonError(req, 500, `Price ID no configurado para plan "${plan}"`);

        // 3) Buscar/crear customer --------------------------------------
        // a) recuperar tenant
        let actualTenantId = tenantId;
        if (!actualTenantId) {
            const { data: tu } = await adminClient
                .from("tenant_users")
                .select("tenant_id")
                .eq("user_id", user.id)
                .eq("role", "owner")
                .maybeSingle();
            actualTenantId = tu?.tenant_id ?? null;
        }
        if (!actualTenantId) return jsonError(req, 404, "No tienes un tenant asociado");

        const { data: tenant, error: tErr } = await adminClient
            .from("tenants")
            .select("id, name, stripe_customer_id, owner_id, plan")
            .eq("id", actualTenantId)
            .single();
        if (tErr || !tenant) return jsonError(req, 404, "Tenant no encontrado");
        if (tenant.owner_id !== user.id) return jsonError(req, 403, "No eres el dueño del tenant");

        // b) crear o reutilizar customer de Stripe
        let customerId: string = tenant.stripe_customer_id ?? "";
        if (!customerId) {
            const customerRes = await stripeRequest("/customers", {
                method: "POST",
                body: {
                    email:    user.email,
                    name:     tenant.name ?? user.email,
                    metadata: { tenant_id: tenant.id, supabase_user_id: user.id },
                },
            });
            if (!customerRes.id) return jsonError(req, 500, "No se pudo crear customer de Stripe");
            customerId = customerRes.id;
            await adminClient
                .from("tenants")
                .update({ stripe_customer_id: customerId })
                .eq("id", tenant.id);
        }

        // 4) Crear Checkout Session -------------------------------------
        const session = await stripeRequest("/checkout/sessions", {
            method: "POST",
            body: {
                customer:   customerId,
                mode:       "subscription",
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${PUBLIC_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url:  `${PUBLIC_URL}/pricing?checkout=cancel`,
                allow_promotion_codes: true,
                billing_address_collection: "required",
                automatic_tax: { enabled: false },
                metadata: {
                    tenant_id: tenant.id,
                    plan:      plan,
                    user_id:   user.id,
                },
                subscription_data: {
                    metadata: {
                        tenant_id: tenant.id,
                        plan:      plan,
                    },
                },
            },
        });
        if (!session.url) return jsonError(req, 500, "Stripe no devolvió url de checkout");

        return new Response(
            JSON.stringify({ url: session.url, sessionId: session.id }),
            { headers: { ...cors(req), "Content-Type": "application/json" } },
        );
    } catch (e) {
        console.error("[create-checkout-session] error:", e);
        return jsonError(req, 500, "Error interno del servicio");
    }
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function stripeRequest(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
    const url = `https://api.stripe.com/v1${path}`;
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":  "application/x-www-form-urlencoded",
    };
    // Construir body x-www-form-urlencoded
    const formBody = opts.body ? objectToFormBody(opts.body) : "";
    const resp = await fetch(url, {
        method:  opts.method ?? "GET",
        headers,
        body:    formBody || undefined,
    });
    const json = await resp.json();
    if (!resp.ok) {
        console.error("[stripe] error", resp.status, json);
        throw new Error(`Stripe ${resp.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 200)}`);
    }
    return json;
}

function objectToFormBody(obj: any, prefix = ""): string {
    const parts: string[] = [];
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) {
            v.forEach((item, i) => {
                if (typeof item === "object") {
                    parts.push(objectToFormBody(item, `${key}[${i}]`));
                } else {
                    parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
                }
            });
        } else if (typeof v === "object") {
            parts.push(objectToFormBody(v, key));
        } else if (typeof v === "boolean") {
            parts.push(`${encodeURIComponent(key)}=${v ? "true" : "false"}`);
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        }
    }
    return parts.filter(Boolean).join("&");
}

function jsonError(req: Request, status: number, message: string): Response {
    return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { ...cors(req), "Content-Type": "application/json" } },
    );
}
