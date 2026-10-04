// =====================================================================
// MOZONA TPV — Edge Function: billing-portal
// =====================================================================
// Crea una sesión del Stripe Customer Portal para que el usuario
// pueda: cambiar tarjeta, ver facturas, cancelar / reactivar,
// descargar PDFs.
//
// Variables:
//   STRIPE_SECRET_KEY
//   PUBLIC_URL
//   SUPABASE_URL
//   MOZONA_SUPABASE_SERVICE_KEY
//
// Body:  { tenantId?: string }  (opcional, default = tenant del usuario)
// Salida:{ url: string }
//
// Deploy:
//   supabase functions deploy billing-portal --no-verify-jwt
// =====================================================================

// @ts-nocheck  — Deno runtime
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/security.ts";

const STRIPE_SECRET_KEY  = Deno.env.get("STRIPE_SECRET_KEY")  ?? "";
const PUBLIC_URL         = Deno.env.get("PUBLIC_URL")         ?? "http://localhost:5173";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")       ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("MOZONA_SUPABASE_SERVICE_KEY") ?? "";

// ★ CORS con allowlist (ver _shared/security.ts). Se elimina el comodín `*`.

serve(async (req) => {
    // Helper de error con CORS por allowlist (cierra sobre `req`).
    const jsonError = (status: number, message: string): Response =>
        new Response(JSON.stringify({ error: message }), {
            status,
            headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        });

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders(req) });
    }
    if (req.method !== "POST") {
        return jsonError(405, "Method not allowed");
    }

    try {
        if (!STRIPE_SECRET_KEY)      return jsonError(500, "STRIPE_SECRET_KEY no configurada");
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonError(500, "Supabase no configurado");

        // 1) Validar usuario
        const authHeader = req.headers.get("Authorization") ?? "";
        const jwt = authHeader.replace(/^Bearer\s+/i, "");
        if (!jwt) return jsonError(401, "Falta token de autenticación");

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userRes, error: userErr } = await adminClient.auth.getUser(jwt);
        if (userErr || !userRes?.user) return jsonError(401, "Sesión inválida");
        const user = userRes.user;

        // 2) Resolver tenant del usuario
        const body = await req.json().catch(() => ({}));
        let tenantId = (body as any)?.tenantId;

        if (!tenantId) {
            const { data: tu } = await adminClient
                .from("tenant_users")
                .select("tenant_id")
                .eq("user_id", user.id)
                .eq("role", "owner")
                .maybeSingle();
            tenantId = tu?.tenant_id ?? null;
        }
        if (!tenantId) return jsonError(404, "No tienes un tenant asociado");

        // 3) Recuperar stripe_customer_id
        const { data: tenant, error: tErr } = await adminClient
            .from("tenants")
            .select("id, owner_id, stripe_customer_id")
            .eq("id", tenantId)
            .single();
        if (tErr || !tenant) return jsonError(404, "Tenant no encontrado");
        if (tenant.owner_id !== user.id) return jsonError(403, "Solo el dueño puede gestionar la facturación");

        if (!tenant.stripe_customer_id) {
            return jsonError(400, "Aún no tienes una suscripción activa.  Empieza con un plan.");
        }

        // 4) Crear sesión del Customer Portal
        const form = new URLSearchParams();
        form.set("customer",   tenant.stripe_customer_id);
        form.set("return_url", `${PUBLIC_URL}/app?billing=return`);

        const resp = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
                "Content-Type":  "application/x-www-form-urlencoded",
            },
            body: form.toString(),
        });
        const data = await resp.json();
        if (!resp.ok) {
            console.error("[billing-portal] stripe", resp.status, data);
            return jsonError(502, `Stripe ${resp.status}: ${data?.error?.message ?? ""}`);
        }
        if (!data.url) return jsonError(500, "Stripe no devolvió url");

        return new Response(
            JSON.stringify({ url: data.url }),
            { headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
        );
    } catch (e) {
        console.error("[billing-portal] error:", e);
        return jsonError(500, e instanceof Error ? e.message : String(e));
    }
});
