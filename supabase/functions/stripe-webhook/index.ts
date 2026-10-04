// =====================================================================
// MOZONA TPV — Edge Function: stripe-webhook
// =====================================================================
// Recibe eventos de Stripe y actualiza `tenants.subscription_status` +
// `plan` para que el SaaS refleje el estado real del billing.
//
// Eventos manejados:
//   - checkout.session.completed        → plan=plus|pro, status=active
//   - customer.subscription.created     → idem
//   - customer.subscription.updated     → status refleja Stripe
//   - customer.subscription.deleted     → status=canceled
//   - invoice.payment_failed            → status=past_due
//   - invoice.paid                      → status=active
//
// Configuración:
//   1) Stripe Dashboard → Developers → Webhooks → Add endpoint
//      URL:    https://hcqkpokodrqimkulporw.supabase.co/functions/v1/stripe-webhook
//      Events: checkout.session.completed, customer.subscription.*, invoice.*
//   2) Copiar el "Signing secret" (whsec_...) y guardarlo:
//      supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
// =====================================================================

// @ts-nocheck  — Deno runtime
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_SECRET_KEY     = Deno.env.get("STRIPE_SECRET_KEY")     ?? "";
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")          ?? "";
const SUPABASE_SERVICE_KEY  = Deno.env.get("MOZONA_SUPABASE_SERVICE_KEY") ?? "";

const PLAN_TO_DB: Record<string, string> = {
    plus: "plus_30",
    pro:  "pro_50",
};

const STATUS_MAP: Record<string, string> = {
    active:        "active",
    trialing:      "trialing",
    past_due:      "past_due",
    unpaid:        "past_due",
    canceled:      "canceled",
    incomplete:    "incomplete",
    incomplete_expired: "expired",
    paused:        "paused",
};

serve(async (req) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        if (!STRIPE_WEBHOOK_SECRET) {
            return new Response("Webhook secret no configurado", { status: 500 });
        }
        if (!STRIPE_SERVICE_KEY_OK()) {
            return new Response("Supabase no configurado", { status: 500 });
        }

        const sig      = req.headers.get("stripe-signature") ?? "";
        const rawBody  = await req.text();

        // 1) Verificar firma --------------------------------------------
        const event = await verifyStripeSignature(rawBody, sig);
        if (!event) return new Response("Firma inválida", { status: 400 });

        // 2) Conectar a Supabase con service role ----------------------
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        // 3) Manejar evento --------------------------------------------
        const tenantId = await handleEvent(adminClient, event);
        console.log("[stripe-webhook]", event.type, "tenant:", tenantId);

        return new Response(JSON.stringify({ received: true, tenantId }), {
            status: 200, headers: { "Content-Type": "application/json" },
        });
    } catch (e) {
        console.error("[stripe-webhook] error:", e);
        return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
});

// ---------------------------------------------------------------------
// Lógica
// ---------------------------------------------------------------------

async function handleEvent(admin: any, event: any): Promise<string | null> {
    const obj = event.data?.object ?? {};

    switch (event.type) {

        // Checkout completado: encontrar tenant por metadata
        case "checkout.session.completed": {
            const tenantId = obj.metadata?.tenant_id;
            const planRaw  = obj.metadata?.plan;
            if (!tenantId) return null;
            const plan = PLAN_TO_DB[planRaw] ?? planRaw ?? "plus_30";
            await admin.from("tenants").update({
                plan:                plan,
                subscription_status: "active",
                stripe_subscription_id: obj.subscription ?? null,
            }).eq("id", tenantId);
            return tenantId;
        }

        // Suscripción creada/actualizada
        case "customer.subscription.created":
        case "customer.subscription.updated": {
            const tenantId = obj.metadata?.tenant_id
                ?? await findTenantByCustomer(admin, obj.customer);
            if (!tenantId) return null;
            const plan = PLAN_TO_DB[obj.metadata?.plan] ?? null;
            const update: any = {
                subscription_status:      STATUS_MAP[obj.status] ?? obj.status,
                stripe_subscription_id:   obj.id,
                stripe_current_period_end: obj.current_period_end
                    ? new Date(obj.current_period_end * 1000).toISOString()
                    : null,
            };
            if (plan) update.plan = plan;
            await admin.from("tenants").update(update).eq("id", tenantId);
            return tenantId;
        }

        // Suscripción cancelada
        case "customer.subscription.deleted": {
            const tenantId = obj.metadata?.tenant_id
                ?? await findTenantByCustomer(admin, obj.customer);
            if (!tenantId) return null;
            await admin.from("tenants").update({
                subscription_status: "canceled",
                plan:                "free",
            }).eq("id", tenantId);
            return tenantId;
        }

        // Pago fallido
        case "invoice.payment_failed": {
            const tenantId = await findTenantByCustomer(admin, obj.customer);
            if (!tenantId) return null;
            await admin.from("tenants").update({
                subscription_status: "past_due",
            }).eq("id", tenantId);
            return tenantId;
        }

        // Pago correcto
        case "invoice.paid": {
            const tenantId = await findTenantByCustomer(admin, obj.customer);
            if (!tenantId) return null;
            await admin.from("tenants").update({
                subscription_status: "active",
            }).eq("id", tenantId);
            return tenantId;
        }

        default:
            console.log("[stripe-webhook] evento no manejado:", event.type);
            return null;
    }
}

async function findTenantByCustomer(admin: any, customerId: string): Promise<string | null> {
    if (!customerId) return null;
    const { data } = await admin
        .from("tenants")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
    return data?.id ?? null;
}

function STRIPE_SERVICE_KEY_OK() {
    return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

// ---------------------------------------------------------------------
// Verificación de firma Stripe (implementación manual Deno)
// ---------------------------------------------------------------------
// Formato de stripe-signature: t=timestamp,v1=signature
async function verifyStripeSignature(body: string, header: string): Promise<any | null> {
    if (!STRIPE_WEBHOOK_SECRET) return null;
    const parts = header.split(",").reduce((acc: Record<string, string>, p) => {
        const [k, v] = p.split("=");
        if (k && v) acc[k] = v;
        return acc;
    }, {});
    const t     = parts.t;
    const v1    = parts.v1;
    if (!t || !v1) return null;

    const signedPayload = `${t}.${body}`;
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sigBuf = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(signedPayload),
    );
    const expected = Array.from(new Uint8Array(sigBuf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    if (expected !== v1) {
        console.error("[stripe-webhook] firma inválida");
        return null;
    }
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}
