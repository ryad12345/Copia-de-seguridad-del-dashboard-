// =====================================================================
// MOZONA TPV — billing.ts: verificación de pagos y suscripciones
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";

export interface CheckoutSessionInfo {
    session_id:    string;
    customer_email: string | null;
    plan:          "plus_30" | "pro_50" | "lifetime_vip";
    amount_total:  number;
    currency:      string;
    payment_status: "paid" | "unpaid" | "no_payment_required";
    customer_id?:  string;
    subscription_id?: string | null;
    metadata?:     Record<string, string>;
}

const VERIFY_ENDPOINT = "verify-checkout-session";

/**
 * Verifica una sesión de Stripe llamando a la Edge Function
 * `verify-checkout-session`. Devuelve null si no está pagada
 * o si la Edge Function no está desplegada (modo degradado).
 */
export async function verifyCheckoutSession(
    sessionId: string,
): Promise<CheckoutSessionInfo | null> {
    if (!isSupabaseConfigured) return null;
    if (!sessionId || !sessionId.startsWith("cs_")) return null;

    try {
        const { data, error } = await supabase.functions.invoke(VERIFY_ENDPOINT, {
            body: { sessionId },
        });
        if (error) {
            console.warn("[billing] verifyCheckoutSession error:", error.message);
            return null;
        }
        if (!data || data.payment_status !== "paid") return null;
        return data as CheckoutSessionInfo;
    } catch (e) {
        console.warn("[billing] verifyCheckoutSession exception:", e);
        return null;
    }
}

/**
 * Almacena localmente la sesión de Stripe verificada para no
 * re-verificarla en cada navegación.  Se borra tras usarla.
 */
const SESSION_KEY = "mozona.verified_checkout_session";

export function cacheVerifiedSession(info: CheckoutSessionInfo): void {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(info));
    } catch (e) { /* noop */ }
}

export function getCachedVerifiedSession(): CheckoutSessionInfo | null {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CheckoutSessionInfo;
        // sólo válido 30 min
        const now = Date.now();
        const ts  = (parsed as any)._cached_at;
        if (ts && now - ts > 30 * 60 * 1000) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        return parsed;
    } catch (e) {
        return null;
    }
}

export function clearCachedVerifiedSession(): void {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
}

/**
 * Marca el tenant como "pagado" creando un registro en `tenants` con
 * `subscription_status='active'` y `plan` desde la sesión.  Si el
 * usuario ya tiene un tenant, lo actualiza.  Devuelve el tenant.
 */
export async function applyPaidSessionToTenant(
    userId: string,
    info: CheckoutSessionInfo,
    restaurantName: string,
): Promise<{ id: string; plan: string } | null> {
    if (!isSupabaseConfigured) return null;

    try {
        // 1) buscar tenant existente del usuario (silenciado si owner_id no existe)
        let existing: any = { data: null };
        try {
            const r = await supabase
                .from("tenants")
                .select("*")
                .eq("owner_id", userId)
                .maybeSingle();
            existing = r;
            if (r.error) console.warn("[billing] owner_id lookup falló:", r.error.message);
        } catch (e) {
            console.warn("[billing] owner_id exception:", e);
        }

        const plan = info.plan;
        const stripeCustomer = info.customer_id ?? null;
        const stripeSub      = info.subscription_id ?? null;

        if (existing.data) {
            await supabase.from("tenants").update({
                plan,
                subscription_status: "active",
                stripe_customer_id:    stripeCustomer,
                stripe_subscription_id: stripeSub,
                name: restaurantName || existing.data.name,
            }).eq("id", existing.data.id);
            return { id: existing.data.id, plan };
        }

        // INSERT con fallback si owner_id no existe
        let ins: any = { data: null, error: null };
        try {
            ins = await supabase.from("tenants").insert({
                owner_id:             userId,
                name:                 restaurantName || "Mi Restaurante",
                plan,
                subscription_status:  "active",
                stripe_customer_id:   stripeCustomer,
                stripe_subscription_id: stripeSub,
                onboarding_completed: false,
            }).select().single();
            if (ins.error && /owner_id|column.*does not exist/i.test(ins.error.message)) {
                // Fallback: insertar sin owner_id
                console.warn("[billing] owner_id no existe, insertando sin él");
                ins = await supabase.from("tenants").insert({
                    name:                 restaurantName || "Mi Restaurante",
                    plan,
                    subscription_status:  "active",
                    stripe_customer_id:   stripeCustomer,
                    stripe_subscription_id: stripeSub,
                    onboarding_completed: false,
                }).select().single();
            }
        } catch (e) {
            ins.error = e instanceof Error ? e : new Error(String(e));
        }

        if (ins.error) {
            console.warn("[billing] applyPaidSessionToTenant insert error:", ins.error.message);
            return null;
        }
        return { id: ins.data.id, plan };
    } catch (e) {
        console.warn("[billing] applyPaidSessionToTenant exception:", e);
        return null;
    }
}
