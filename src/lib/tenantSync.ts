// =====================================================================
// MOZONA TPV — Tenant Sync (v4.0.7-tenant-sync)
// =====================================================================
// Sincroniza el tenant_id del LocalStorage con el del JWT activo.
//
// PROBLEMA:
// • Después de aplicar SQL #56 (RLS estricto), si el LocalStorage tiene
//   un tenant_id de una sesión anterior (o de otro usuario), las queries
//   a Supabase devuelven [] o 400 porque el owner_id no coincide.
// • El usuario tenía que borrar la caché manualmente.
//
// SOLUCIÓN:
// • Al iniciar sesión o refresh, este helper:
//   1) Lee el JWT activo de Supabase
//   2) Extrae auth.uid() y email
//   3) Compara con tenant_id en LocalStorage
//   4) Si no coincide, lo limpia o lo corrige
//   5) Si no hay tenant válido, intenta resolver desde Supabase
//   6) Maneja caso especial: tenants virtuales VIP (Riyad)
//
// USO:
//   import { syncTenantFromAuth, getValidatedTenantId } from "./tenantSync";
//   await syncTenantFromAuth(); // Llamar tras signIn/refresh/init
//   const tid = getValidatedTenantId();
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";

// Keys de LocalStorage (constantes para evitar typos)
export const LS_KEYS = {
    tenantId: "mozona.current_tenant_id",
    tenantSettings: "mozona.tenant_settings",
    authUser: "mozona.auth_user",
    authSession: "mozona.auth_session",
    // Cache legacy que pudo dejar la versión anterior
    legacyTenantId: "tenant_id",
    legacyTenant: "mozona_tenant",
    legacyActiveTenant: "mozona_active_tenant_id",
} as const;

// ★ v4.5.13: CRÍTICO — el admin NO debe tener tenant virtual.
//   Solo chalohiahmd (VIP cliente) tiene tenant_id virtual.
//   rofixinsta es admin y NO es un tenant.
const VIP_VIRTUAL_TENANT_ID = "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";
const VIP_EMAILS = new Set([
    "chalohiahmd1980@gmail.com",
    // "rofixinsta@gmail.com" ELIMINADO — admin NO es tenant
]);

export type SyncResult = {
    ok: boolean;
    action: "kept" | "synced" | "cleared" | "vip_kept" | "no_session" | "no_tenant" | "error";
    tenantId?: string;
    email?: string;
    reason?: string;
};

/**
 * Lee el tenant_id del LocalStorage de forma segura.
 */
export function getStoredTenantId(): string | null {
    try {
        for (const key of [
            LS_KEYS.tenantId,
            LS_KEYS.legacyTenantId,
            LS_KEYS.legacyActiveTenant,
        ]) {
            const v = localStorage.getItem(key);
            if (v && v.length > 8 && v.length < 200) {
                return v;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Limpia TODAS las keys de LocalStorage relacionadas con tenant.
 */
export function clearStoredTenant(): void {
    try {
        for (const key of Object.values(LS_KEYS)) {
            localStorage.removeItem(key);
        }
        // También limpiar keys con prefijos comunes
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && (
                k.startsWith("mozona.tenant.") ||
                k.startsWith("mozona_cache_") ||
                k.includes("tenant") && k.includes("_")
            )) {
                localStorage.removeItem(k);
            }
        }
    } catch {
        // ignore
    }
}

/**
 * Persiste el tenant_id validado.
 */
export function setStoredTenantId(tenantId: string): void {
    try {
        localStorage.setItem(LS_KEYS.tenantId, tenantId);
    } catch {
        // ignore
    }
}

/**
 * Helper principal: sincroniza tenant_id con JWT activo.
 *
 * @param force  Si true, siempre re-valida aunque el tenant_id exista.
 */
export async function syncTenantFromAuth(opts: { force?: boolean } = {}): Promise<SyncResult> {
    if (!isSupabaseConfigured) {
        return { ok: false, action: "no_session", reason: "Supabase no configurado" };
    }

    try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        const user = session?.user;

        if (!user) {
            // Sin sesión: limpiar tenant (es de otro usuario o expiró)
            const hadTenant = !!getStoredTenantId();
            if (hadTenant) clearStoredTenant();
            return {
                ok: false,
                action: hadTenant ? "cleared" : "no_session",
                reason: "No hay sesión activa",
            };
        }

        const authUserId = user.id;
        const email = (user.email || "").toLowerCase();

        // Caso especial: VIPs tienen tenant virtual hardcoded
        if (VIP_EMAILS.has(email)) {
            const stored = getStoredTenantId();
            if (stored !== VIP_VIRTUAL_TENANT_ID) {
                setStoredTenantId(VIP_VIRTUAL_TENANT_ID);
                return { ok: true, action: "vip_kept", tenantId: VIP_VIRTUAL_TENANT_ID, email };
            }
            return { ok: true, action: "vip_kept", tenantId: VIP_VIRTUAL_TENANT_ID, email };
        }

        const stored = getStoredTenantId();
        if (!stored || opts.force) {
            // No hay tenant guardado: intentar resolver
            const resolved = await resolveTenantFromAuth(authUserId, email);
            if (resolved) {
                setStoredTenantId(resolved);
                return { ok: true, action: "synced", tenantId: resolved, email };
            }
            return { ok: false, action: "no_tenant", email, reason: "No se pudo resolver tenant" };
        }

        // Hay tenant guardado: verificar que pertenece al usuario
        const verified = await verifyTenantOwnership(stored, authUserId, email);
        if (verified) {
            return { ok: true, action: "kept", tenantId: stored, email };
        }

        // No pertenece al usuario activo: limpiar y re-resolver
        console.warn(`[tenantSync] tenant_id ${stored} no pertenece a ${email}, limpiando...`);
        clearStoredTenant();
        const resolved = await resolveTenantFromAuth(authUserId, email);
        if (resolved) {
            setStoredTenantId(resolved);
            return { ok: true, action: "synced", tenantId: resolved, email, reason: "Re-resuelto tras limpieza" };
        }
        return { ok: false, action: "cleared", email, reason: "Tenant no pertenece al usuario" };
    } catch (e: any) {
        return { ok: false, action: "error", reason: e?.message || String(e) };
    }
}

/**
 * Verifica que el tenant_id pertenece al usuario autenticado.
 */
async function verifyTenantOwnership(
    tenantId: string,
    userId: string,
    email: string
): Promise<boolean> {
    try {
        const url = (import.meta as any).env?.VITE_SUPABASE_URL || "";
        const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
        if (!url || !key) return false;

        const session = (await supabase.auth.getSession()).data.session;
        const token = session?.access_token || key;

        // ★ v4.0.7-tenant-sync: usar JWT del usuario para que RLS funcione
        const r = await fetch(`${url}/rest/v1/tenants?id=eq.${tenantId}&select=id,owner_id,contact_email&limit=1`, {
            headers: {
                apikey: key,
                Authorization: `Bearer ${token}`,
            },
        });

        if (!r.ok) return false;
        const arr = await r.json();
        if (!arr || !arr[0]) return false;

        const t = arr[0];
        return t.owner_id === userId ||
               (t.contact_email && t.contact_email.toLowerCase() === email);
    } catch {
        return false;
    }
}

/**
 * Resuelve el tenant del usuario actual desde Supabase.
 */
async function resolveTenantFromAuth(userId: string, email: string): Promise<string | null> {
    try {
        const url = (import.meta as any).env?.VITE_SUPABASE_URL || "";
        const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
        if (!url || !key) return null;

        const session = (await supabase.auth.getSession()).data.session;
        const token = session?.access_token || key;

        // 1) Por owner_id
        const r1 = await fetch(`${url}/rest/v1/tenants?owner_id=eq.${userId}&select=id&limit=1`, {
            headers: { apikey: key, Authorization: `Bearer ${token}` },
        });
        if (r1.ok) {
            const arr = await r1.json();
            if (arr?.[0]?.id) return arr[0].id;
        }

        // 2) Por contact_email
        if (email) {
            const r2 = await fetch(
                `${url}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
                { headers: { apikey: key, Authorization: `Bearer ${token}` } }
            );
            if (r2.ok) {
                const arr = await r2.json();
                if (arr?.[0]?.id) return arr[0].id;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Devuelve el tenant_id validado, sincronizando primero si es necesario.
 * Úsalo en queries críticas en lugar de leer LocalStorage directamente.
 */
export async function getValidatedTenantId(): Promise<string | null> {
    const result = await syncTenantFromAuth();
    return result.tenantId || null;
}

/**
 * Versión síncrona: devuelve lo que hay en LocalStorage sin validar.
 * Solo para casos donde ya sabes que está validado.
 */
export function getCachedTenantId(): string | null {
    return getStoredTenantId();
}
