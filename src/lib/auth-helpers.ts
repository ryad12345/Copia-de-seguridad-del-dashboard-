// =====================================================================
// MOZONA TPV — auth-helpers.ts
// =====================================================================
// Helpers para extraer JWT/anon_key del AuthContext o LS.
// =====================================================================

import { SUPABASE_ANON_EXPORT as SUPABASE_ANON } from "./supabase";

/**
 * Devuelve el JWT del usuario autenticado, o null si no hay sesión.
 * Lee de localStorage 'pos_current_user' (donde AuthContext guarda).
 * Para usuarios VIP (sin Supabase auth), retorna null — se usará anon key.
 */
export function getUserJwt(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        // 1) LS pos_current_user
        const raw = localStorage.getItem("pos_current_user");
        if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.session?.access_token;
            if (typeof token === "string" && token.startsWith("eyJ")) {
                return token;
            }
        }
        // 2) Cualquier token en LS mozona.auth.session
        for (const k of ["mozona.auth.session", "supabase.auth.token", "sb-token"]) {
            const v = localStorage.getItem(k);
            if (!v) continue;
            try {
                const p = JSON.parse(v);
                const t = p?.access_token ?? p?.currentSession?.access_token;
                if (typeof t === "string" && t.startsWith("eyJ")) return t;
            } catch {}
        }
    } catch {}
    return null;
}

/**
 * Devuelve ANON_KEY como fallback si no hay JWT.
 */
export function getAnonKey(): string {
    return SUPABASE_ANON;
}

/**
 * Devuelve el user_id actual del LS, o null.
 */
export function getUserId(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem("pos_current_user");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.user?.id ?? null;
    } catch {}
    return null;
}

/**
 * Devuelve el tenant_id del LS (AuthContext puede ponerlo ahi).
 */
export function getTenantIdFromStorage(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem("mozona.current_tenant_id");
        if (raw) return raw;
        const raw2 = localStorage.getItem("pos_current_user");
        if (!raw2) return null;
        const parsed = JSON.parse(raw2);
        return parsed?.user?.tenant_id ?? parsed?.tenant?.id ?? null;
    } catch {}
    return null;
}
