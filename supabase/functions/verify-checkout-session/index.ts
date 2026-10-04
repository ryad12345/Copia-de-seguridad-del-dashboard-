// =====================================================================
// MOZONA TPV — Supabase Edge Function: verify-checkout-session
// =====================================================================
// Verifica una sesión de Stripe Checkout y devuelve la info de plan /
// cliente / suscripción.  Sólo devuelve datos si la sesión está `paid`.
// Esta función es segura de exponer (no requiere service_role).
// =====================================================================

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=denonext";
import { corsHeaders } from "../_shared/security.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PRICE_PLUS = Deno.env.get("STRIPE_PRICE_PLUS") ?? "";
const STRIPE_PRICE_PRO  = Deno.env.get("STRIPE_PRICE_PRO")  ?? "";

const stripe = STRIPE_SECRET_KEY
    ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" })
    : null;

// ★ CORS con allowlist (ver _shared/security.ts). Se elimina el comodín
//   `*` para que sólo los orígenes de la app puedan invocar la función.

const PLAN_BY_PRICE: Record<string, "plus_30" | "pro_50" | "lifetime_vip"> = {
    [STRIPE_PRICE_PLUS]: "plus_30",
    [STRIPE_PRICE_PRO]:  "pro_50",
};

serve(async (req: Request) => {
    // Cabeceras CORS restringidas por allowlist, calculadas por petición.
    const cors = corsHeaders(req);
    const jsonResponse = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...cors, "Content-Type": "application/json" },
        });

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
    if (!stripe) {
        return jsonResponse({ error: "Stripe no configurado" }, 503);
    }

    let body: { sessionId?: string };
    try { body = await req.json(); }
    catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

    const sessionId = (body.sessionId ?? "").trim();
    if (!sessionId || !sessionId.startsWith("cs_")) {
        return jsonResponse({ error: "sessionId inválido" }, 400);
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== "paid") {
            return jsonResponse({
                error: "Sesión no pagada",
                payment_status: session.payment_status,
            }, 402);
        }

        const priceId =
            (typeof session.line_items === "object" && (session.line_items as any)?.data?.[0]?.price?.id) ||
            session.metadata?.price_id ||
            "";

        const plan = PLAN_BY_PRICE[priceId]
            ?? (session.metadata?.plan as "plus_30" | "pro_50" | "lifetime_vip")
            ?? "plus_30";

        return jsonResponse({
            session_id:      session.id,
            customer_email:  session.customer_details?.email ?? null,
            plan,
            amount_total:    session.amount_total ?? 0,
            currency:        session.currency ?? "eur",
            payment_status:  session.payment_status,
            customer_id:     typeof session.customer === "string" ? session.customer : session.customer?.id,
            subscription_id: typeof session.subscription === "string"
                ? session.subscription
                : (session.subscription as any)?.id ?? null,
            metadata:        session.metadata ?? {},
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonResponse({ error: `Stripe error: ${msg}` }, 500);
    }
});
