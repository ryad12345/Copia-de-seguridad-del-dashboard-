// =====================================================================
// MOZONA TPV — supabase.ts: cliente Supabase Cloud (SaaS multi-tenant)
// =====================================================================
// El cliente único se usa para:
//   • Auth (signIn, signUp, OAuth, session, onAuthStateChange)
//   • Datos de tenant (restaurants, products, tables, orders, ...)
//   • Realtime (postgres_changes) para sincronizar comandas entre TPV
//     y móviles.
//   • Storage (imágenes de productos, logos)
//
// La app offline (sin .env) sigue funcionando con mock data y
// `isSupabaseConfigured = false`.
//
// ★ v4.0.7-military: CERO RIESGO DE DATOS
//   - SUPABASE_ANON_KEY hardcoded es la PUBLISHABLE key (anon role)
//   - RLS en Supabase es la barrera real de seguridad
//   - SERVICE ROLE key NUNCA debe estar en este bundle
//   - Configurar VITE_SUPABASE_URL/ANON_KEY en Cloudflare Pages env
//     para evitar el fallback hardcoded (más seguro)
// =====================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// Configuración desde variables de entorno Vite
// ---------------------------------------------------------------------
//
// ★ v4.0.7-military: Orden de prioridad de credenciales (defense in depth)
//   1. Cloudflare Pages env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
//   2. Fallback hardcoded (publishable key, RLS-protected)
//   3. Cliente dummy si nada funciona (no rompe la app)
//
// IMPORTANTE: El ANON_KEY es PUBLISHABLE (no es un secret). La barrera
// real de seguridad es RLS en Supabase. NO se debe confundir con
// SERVICE_ROLE_KEY (que NUNCA debe estar en el bundle).
//
// ---------------------------------------------------------------------

const SUPABASE_URL: string =
    (import.meta.env.VITE_SUPABASE_URL as string)?.trim()
    || "https://hcqkpokodrqimkulporw.supabase.co";

const SUPABASE_ANON: string =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim()
    || "sb_publishable_9kWDFdbRaIuTrc1HSzpr3Q_0e6vfoO2";

// ★ v4.1.2-fix-401: exports públicos para que supabase-fetch.ts
//   pueda construir los headers sin duplicar la constante.
export const SUPABASE_URL_EXPORT = SUPABASE_URL;
export const SUPABASE_ANON_EXPORT = SUPABASE_ANON;

// Validamos formato antes de usarlo
export const isSupabaseConfigured: boolean =
    SUPABASE_URL.startsWith("https://") && SUPABASE_ANON.length > 20;

/** Email del SuperAdmin (bypass paywall + acceso a /admin/invites). */
export const SUPERADMIN_EMAIL: string =
    (import.meta.env.VITE_SUPERADMIN_EMAIL ?? "rofixinsta@gmail.com").trim().toLowerCase();

/** URL pública absoluta (para Stripe Checkout, magic links, etc). */
export const PUBLIC_URL: string =
    (import.meta.env.VITE_PUBLIC_URL
        ?? (typeof window !== "undefined" ? window.location.origin : "https://mozona-tpv.com")
    ).replace(/\/+$/, "");

/** Cliente Supabase.  Si no está configurado, devuelve un cliente
 *  "dummy" que fallará al usarse.  Mantenerlo exportado para que
 *  los demás módulos (auth, syncEngine, etc.) no rompan al importar. */
export const supabase: SupabaseClient = isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: {
            persistSession:    true,
            autoRefreshToken:  true,
            detectSessionInUrl: true,
            storageKey:        "mozona.auth.session",
        },
        realtime: { params: { eventsPerSecond: 10 } },
        global: {
            headers: {
                "x-application-name": "mozona-tpv",
                "x-client-info": "mozona-tpv/web",
                "apikey": SUPABASE_ANON,
                "Authorization": `Bearer ${SUPABASE_ANON}`,
            },
        },
        // ★ NO usar accessToken callback: deshabilita supabase.auth.*
        //   En su lugar, syncSupabaseSession() llama setSession() para
        //   inyectar la sesión del AuthContext al SDK.
    })
    : createClient("https://placeholder.supabase.co", "placeholder-anon-key", {
        auth:   { persistSession: false },
        global: { fetch: () => Promise.reject(new Error("Supabase no configurado")) },
    });

// =====================================================================
// ★ v4.1.9-SYNC: sincroniza la sesion del AuthContext (localStorage
//   'pos_current_user') con el cliente Supabase via setSession().
//   Asi el SDK adjunta automaticamente el JWT en cada request,
//   Y los métodos supabase.auth.* siguen funcionando (getUser, etc).
// =====================================================================

let lastSyncedToken: string | null = null;

export async function syncSupabaseSession(): Promise<void> {
    if (!supabase || !isSupabaseConfigured) return;
    try {
        const raw = typeof localStorage !== "undefined"
            ? localStorage.getItem("pos_current_user")
            : null;
        if (!raw) {
            // No hay sesion -> limpiar el cliente
            if (lastSyncedToken !== null) {
                try { await supabase.auth.signOut(); } catch {}
                lastSyncedToken = null;
            }
            return;
        }
        const parsed = JSON.parse(raw);
        const access = parsed?.session?.access_token;
        const refresh = parsed?.session?.refresh_token;
        if (!access || typeof access !== "string") return;

        // Evitar re-sync innecesario
        if (access === lastSyncedToken) return;

        try {
            await supabase.auth.setSession({
                access_token: access,
                refresh_token: refresh || "",
            });
            lastSyncedToken = access;
            console.log("[supabase] sesion sincronizada con SDK via setSession");
        } catch (e: any) {
            console.warn("[supabase] setSession fallo:", e?.message);
        }
    } catch (e) {
        console.warn("[supabase] syncSupabaseSession error:", e);
    }
}

if (typeof window !== "undefined") {
    try {
        // Sincronizar al cargar la pagina
        void syncSupabaseSession();
        // Re-sincronizar cuando AuthContext cambie la sesion en LS
        window.addEventListener("storage", (e) => {
            if (e.key === "pos_current_user") void syncSupabaseSession();
        });
    } catch {}
}

// ---------------------------------------------------------------------
// Helpers de identificación
// ---------------------------------------------------------------------

/** restaurant_id persistido en IndexedDB meta (legacy). */
export const RESTAURANT_ID_KEY = "mozona.restaurant_id";

/** ¿El email pertenece al SuperAdmin? */
export function isSuperAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return email.trim().toLowerCase() === SUPERADMIN_EMAIL;
}

// ---------------------------------------------------------------------
// Tipo UserProfile (espejo de public.profiles)
// ---------------------------------------------------------------------

export interface UserProfile {
    id:     string;
    email:  string;
    name?:  string | null;
    avatar_url?: string | null;
    is_superadmin?: boolean;
    created_at?: string;
}

export interface TenantUser {
    id:        string;
    tenant_id: string;
    user_id:   string;
    email:     string;
    role:      "owner" | "waiter" | "cashier" | "superadmin";
    pin_code:  string;
    created_at: string;
}

export interface Tenant {
    id:                    string;
    name:                  string;
    owner_id:              string;
    plan:                  "plus_30" | "pro_50" | "lifetime_vip";
    subscription_status:   "active" | "trialing" | "past_due" | "canceled"
                          | "trial" | "expired";
    trial_started_at?:     string | null;
    trial_ends_at?:        string | null;
    cancelled_at?:         string | null;
    stripe_customer_id?:     string | null;
    stripe_subscription_id?: string | null;
    /** Datos fiscales del tenant (rellenados en el wizard) */
    cif_nif?:              string | null;
    address?:              string | null;
    phone?:                string | null;
    primary_color?:        string;
    ticket_footer_msg?:    string;
    default_tax_rate?:     number;
    /** `false` hasta que el cliente completa el wizard inicial. */
    onboarding_completed?: boolean;
    created_at:           string;
}

// ---------------------------------------------------------------------
// requireRestaurantId: ahora apunta a IndexedDB meta
// ---------------------------------------------------------------------

/** Versión síncrona deprecada — usar `syncEngine.getRestaurantId()` */
export function requireRestaurantId(): string {
    throw new Error(
        "requireRestaurantId() está deprecated.  " +
        "Importa getRestaurantId() desde './syncEngine' o " +
        "RestaurantContext desde './tenant'."
    );
}
