// =====================================================================
// MOZONA TPV — waiters v4.6.0 (persistencia JWT + tipos canónicos)
// =====================================================================
// Camareros: resolveRealTenantId, saveWaiter, listWaiters, deleteWaiter.
// Todo con JWT explícito vía dbWrite o supabaseFetch.
//
// ★ v4.6.0: se unifica el contrato de tipos.  La tabla real es
//   `public.waiters` con columnas:
//     id, tenant_id, username, full_name, pin, role, is_active,
//     metadata, created_at, updated_at
//   Este módulo expone:
//     - WaiterRow            → fila cruda de BD
//     - Waiter               → modelo canónico de cliente (name normalizado)
//     - WaiterRole           → rol tipado
//     - CreateWaiterResult   → resultado de createWaiter()
// =====================================================================

import { supabase } from "./supabase";
import { supabaseFetch } from "./supabase-fetch";
import { getUserJwt } from "./auth-helpers";
import type { CachedWaiter } from "./offlineStorage";
import type { WaiterRole } from "./types";

export type { WaiterRole };

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

/** Fila cruda de la tabla `waiters` (columnas reales de BD). */
export interface WaiterRow {
    id?: string;
    tenant_id?: string;
    username?: string;
    full_name?: string;
    pin?: string | null;
    role?: string;
    is_active?: boolean;
    created_at?: string;
    updated_at?: string;
    metadata?: Record<string, any>;
}

/** Modelo canónico de camarero para el cliente (name siempre presente). */
export interface Waiter {
    id: string;
    name: string;
    tenant_id?: string;
    username?: string;
    email?: string | null;
    pin?: string | null;
    pin_code?: string | null;
    role?: WaiterRole;
    is_active?: boolean;
    user_id?: string | null;
    created_at?: string;
    cached_at?: number;
    loggedInAt?: string;
}

export interface CreateWaiterResult {
    ok: boolean;
    waiter: any;
    username: string;
    pin: string;
    error?: string;
    data?: any;
}

const VALID_ROLES: WaiterRole[] = ["owner", "manager", "waiter", "kitchen"];

function normalizeRole(role: unknown): WaiterRole {
    const r = String(role ?? "").toLowerCase();
    return (VALID_ROLES as string[]).includes(r) ? (r as WaiterRole) : "waiter";
}

/** Convierte una fila de BD en el modelo canónico de cliente. */
function rowToWaiter(row: any): Waiter {
    return {
        id: String(row?.id ?? ""),
        name: String(row?.full_name || row?.username || row?.name || ""),
        tenant_id: row?.tenant_id,
        username: row?.username,
        email: row?.email ?? null,
        // ★ v4.6.0 (H-07): los PIN nunca se exponen al cliente.
        pin: null,
        pin_code: null,
        role: normalizeRole(row?.role),
        is_active: row?.is_active ?? true,
        user_id: row?.user_id ?? null,
        created_at: row?.created_at,
        cached_at: row?.cached_at,
    };
}

// ---------------------------------------------------------------------
// Resolución de tenant
// ---------------------------------------------------------------------

export async function resolveRealTenantId(preferredId: string | null): Promise<string | null> {
    // 0) Si ya viene bueno
    if (preferredId && preferredId !== ZERO_UUID && preferredId !== "vip-bypass") {
        return preferredId;
    }

    // 1) LS
    if (typeof localStorage !== "undefined") {
        try {
            const raw = localStorage.getItem("mozona.current_tenant_id");
            if (raw && raw !== ZERO_UUID) return raw;
        } catch {}
    }

    // 2) AuthContext
    if (typeof localStorage !== "undefined") {
        try {
            const raw = localStorage.getItem("pos_current_user");
            if (raw) {
                const p = JSON.parse(raw);
                const tid = p?.tenant?.id || p?.user?.tenant_id;
                if (tid && tid !== ZERO_UUID) return tid;
            }
        } catch {}
    }

    // 3) BD via RPC get_my_tenant (requiere JWT).
    //    ★ v4.6.0 (H-03): get_first_active_tenant() fue ELIMINADA — exponía el
    //    primer tenant activo a cualquier anon. El tenant se resuelve post-login.
    if (supabase) {
        try {
            const jwt = getUserJwt();
            const r = await supabaseFetch("/rest/v1/rpc/get_my_tenant", {
                method: "POST",
                jwt,
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            if (r.ok) {
                const tid = await r.json();
                if (typeof tid === "string" && tid !== ZERO_UUID) return tid;
            }
        } catch {}
    }

    return null;
}

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------

export async function listWaiters(tenantId: string | null): Promise<Waiter[]> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return [];

    const jwt = getUserJwt();
    try {
        // ★ v4.6.0: proyección explícita SIN pin/pin_hash.
        const r = await supabaseFetch(
            `/rest/v1/waiters?tenant_id=eq.${realId}` +
            `&select=id,tenant_id,username,full_name,role,is_active,created_at,updated_at,metadata` +
            `&order=username.asc`,
            { jwt }
        );
        if (!r.ok) {
            console.warn("[waiters] list HTTP", r.status);
            return [];
        }
        const rows = (await r.json()) as any[];
        return Array.isArray(rows) ? rows.map(rowToWaiter) : [];
    } catch (e: any) {
        console.warn("[waiters] list exception:", e?.message);
        return [];
    }
}

// ---------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------

/**
 * Fija/cambia el PIN de un camarero server-side vía RPC `set_waiter_pin`
 * (hash bcrypt). El cliente NUNCA escribe pin_hash ni el PIN en claro.
 * Requiere JWT de un miembro del tenant (o superadmin) — lo verifica la RPC.
 */
export async function setWaiterPin(
    waiterId: string,
    pin: string,
    jwt?: string | null,
): Promise<boolean> {
    if (!waiterId || !pin) return false;
    try {
        const r = await supabaseFetch("/rest/v1/rpc/set_waiter_pin", {
            method: "POST",
            jwt: jwt ?? getUserJwt(),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ p_waiter_id: waiterId, p_pin: pin }),
        });
        if (!r.ok) {
            const t = await r.text().catch(() => "");
            console.warn("[waiters] set_waiter_pin HTTP", r.status, t.slice(0, 200));
            return false;
        }
        const data = await r.json().catch(() => null);
        return data === true || (data && data.ok === true);
    } catch (e: any) {
        console.warn("[waiters] set_waiter_pin exception:", e?.message);
        return false;
    }
}

export async function saveWaiter(input: {
    tenantId: string | null;
    username: string;
    full_name?: string;
    pin?: string;
    role?: string;
    id?: string;
}): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
    const realId = await resolveRealTenantId(input.tenantId);
    if (!realId) {
        return { ok: false, error: "Sin tenantId válido" };
    }
    if (!input.username || input.username.length < 2) {
        return { ok: false, error: "username demasiado corto" };
    }

    const jwt = getUserJwt();
    // ★ v4.6.0 (H-07): el PIN NO viaja en claro a la tabla. Se fija por
    //   RPC `set_waiter_pin` (hash bcrypt server-side) tras el insert/update.
    const row = {
        tenant_id: realId,
        username: input.username.trim().slice(0, 50),
        full_name: (input.full_name ?? input.username).trim().slice(0, 120),
        role: input.role ?? "waiter",
    };

    try {
        let data: any = null;
        let id: string | undefined = input.id;

        if (input.id) {
            const r = await supabaseFetch(
                `/rest/v1/waiters?id=eq.${encodeURIComponent(input.id)}&tenant_id=eq.${realId}`,
                {
                    method: "PATCH",
                    jwt,
                    headers: { "Prefer": "return=representation" },
                    body: JSON.stringify({
                        username: row.username,
                        full_name: row.full_name,
                        role: row.role,
                    }),
                }
            );
            if (!r.ok) {
                const errText = await r.text().catch(() => "");
                return { ok: false, error: errText, status: r.status };
            }
            data = await r.json().catch(() => null);
            id = (Array.isArray(data) ? data[0]?.id : data?.id) ?? input.id;
            console.log("[waiters] ✅ UPDATE", input.username);
        } else {
            const r = await supabaseFetch("/rest/v1/waiters", {
                method: "POST",
                jwt,
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify(row),
            });
            if (!r.ok) {
                const errText = await r.text().catch(() => "");
                return { ok: false, error: errText, status: r.status };
            }
            data = await r.json();
            id = (Array.isArray(data) ? data[0]?.id : data?.id) ?? undefined;
            console.log("[waiters] ✅ INSERT", input.username);
        }

        _waitersCache = null;

        // Fijar/actualizar el PIN hasheado server-side (nunca en claro).
        if (input.pin && id) {
            const pinOk = await setWaiterPin(id, input.pin, jwt);
            if (!pinOk) {
                console.warn("[waiters] set_waiter_pin falló para", id);
            }
        }

        return { ok: true, data, status: 200 };
    } catch (e: any) {
        console.error("[waiters] save exception:", e?.message);
        return { ok: false, error: e?.message };
    }
}

export async function deleteWaiter(tenantId: string | null, id: string): Promise<{ ok: boolean; error?: string; status?: number }> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return { ok: false, error: "Sin tenantId" };

    const jwt = getUserJwt();
    try {
        const r = await supabaseFetch(
            `/rest/v1/waiters?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${realId}`,
            { method: "DELETE", jwt }
        );
        if (!r.ok) {
            const errText = await r.text().catch(() => "");
            return { ok: false, error: errText, status: r.status };
        }
        _waitersCache = null;
        console.log("[waiters] ✅ DELETE", id);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// ---------------------------------------------------------------------
// Caché + compatibilidad (useWaiters.ts / useWaiterAuth.ts)
// ---------------------------------------------------------------------

let _waitersCache: { ts: number; rows: Waiter[] } | null = null;

export async function syncWaiters(tenantId: string | null, force = false): Promise<Waiter[]> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return [];
    if (_waitersCache && !force && Date.now() - _waitersCache.ts < 60_000) {
        return _waitersCache.rows;
    }
    const rows = await listWaiters(realId);
    _waitersCache = { ts: Date.now(), rows };
    return rows;
}

export async function listCachedWaiters(tenantId: string | null, ttlMs = 60_000): Promise<Waiter[]> {
    if (_waitersCache && Date.now() - _waitersCache.ts < ttlMs) {
        return _waitersCache.rows;
    }
    return await syncWaiters(tenantId, true);
}

/**
 * Valida un PIN de forma SERVER-SIDE.
 *
 * ★ v4.6.0 (H-07): antes se descargaban TODOS los PINs y se comparaban
 *   en el navegador (cualquiera con la anon key los leía). Ahora se llama
 *   a la RPC `verify_waiter_pin_tenant(tenant_id, pin)`, que compara el
 *   hash bcrypt en el servidor y aplica rate-limit. El cliente nunca ve
 *   el PIN ni el hash.
 *
 * Mantiene el nombre/firma por compatibilidad con useWaiters/useWaiterAuth
 * (que lo usan como `validatePin(pin)`).
 */
export async function findByPinCached(tenantId: string | null, pin: string): Promise<CachedWaiter | null> {
    if (!pin) return null;
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return null;
    try {
        const jwt = getUserJwt();
        const r = await supabaseFetch("/rest/v1/rpc/verify_waiter_pin_tenant", {
            method: "POST",
            jwt,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ p_tenant_id: realId, p_pin: pin }),
        });
        if (!r.ok) return null;
        const res: any = await r.json().catch(() => null);
        if (!res || res.ok !== true || !res.id) return null;
        return {
            id: String(res.id),
            tenant_id: String(res.tenant_id ?? realId),
            user_id: null,
            name: String(res.name ?? ""),
            pin_code: null,
            role: normalizeRole(res.role),
            is_active: true,
            cached_at: Date.now(),
        };
    } catch (e: any) {
        console.warn("[waiters] verify pin exception:", e?.message);
        return null;
    }
}

// ---------------------------------------------------------------------
// CRUD de alto nivel (usado por useWaiters)
// ---------------------------------------------------------------------

export async function createWaiter(input: {
    tenant_id: string;
    username?: string;
    name?: string;
    full_name?: string;
    pin?: string;
    role?: WaiterRole | string;
}): Promise<CreateWaiterResult> {
    const username = String(input.username ?? input.name ?? "").trim();
    const role = normalizeRole(input.role);
    const pin = input.pin && /^\d{4,6}$/.test(input.pin)
        ? input.pin
        : String(Math.floor(1000 + Math.random() * 9000));

    const res = await saveWaiter({
        tenantId: input.tenant_id,
        username: username || `camarero${Date.now().toString().slice(-4)}`,
        full_name: input.full_name ?? input.name ?? username,
        pin,
        role,
    });

    if (!res.ok) {
        return { ok: false, waiter: null, username, pin, error: res.error };
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const waiter: Waiter = row
        ? rowToWaiter(row)
        : { id: "", name: input.name ?? username, username, role, is_active: true, pin };
    return { ok: true, waiter, username: waiter.username ?? username, pin, data: res.data };
}

export async function updateWaiter(
    id: string,
    patch: {
        username?: string;
        name?: string;
        full_name?: string;
        pin?: string;
        role?: WaiterRole | string;
        is_active?: boolean;
        tenant_id?: string;
    },
): Promise<Waiter | null> {
    const realId = await resolveRealTenantId(patch.tenant_id ?? null);
    if (!realId) return null;
    const jwt = getUserJwt();

    const body: Record<string, any> = {};
    const username = patch.username ?? patch.name;
    if (username !== undefined) body.username = String(username).trim().slice(0, 50);
    if (patch.full_name !== undefined) body.full_name = String(patch.full_name).trim().slice(0, 120);
    // ★ v4.6.0 (H-07): el PIN NUNCA se escribe en la tabla (columna plana
    //   anulada/no usada). Se fija con la RPC set_waiter_pin (hash server-side).
    if (patch.role !== undefined) body.role = normalizeRole(patch.role);
    if (patch.is_active !== undefined) body.is_active = patch.is_active;

    try {
        const r = await supabaseFetch(
            `/rest/v1/waiters?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${realId}`,
            {
                method: "PATCH",
                jwt,
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify(body),
            }
        );
        if (!r.ok) {
            const t = await r.text().catch(() => "");
            console.warn("[waiters] update fail:", t);
            return null;
        }
        _waitersCache = null;
        const data = await r.json().catch(() => null);
        const row = Array.isArray(data) ? data[0] : data;

        // Fijar PIN hasheado server-side si se pidió cambio.
        if (patch.pin) {
            const pinOk = await setWaiterPin(id, patch.pin, jwt);
            if (!pinOk) console.warn("[waiters] set_waiter_pin falló para", id);
        }

        return rowToWaiter(row ?? { id, tenant_id: realId, ...body });
    } catch (e: any) {
        console.warn("[waiters] update exception:", e?.message);
        return null;
    }
}

export async function deleteWaiterById(id: string): Promise<{ ok: boolean; error?: string }> {
    const realId = await resolveRealTenantId(null);
    if (!realId) return { ok: false, error: "Sin tenantId" };
    const result = await deleteWaiter(realId, id);
    _waitersCache = null;
    return result;
}

/** Regenera el PIN de un camarero.  Devuelve el nuevo PIN o null. */
export async function resetWaiterPassword(id: string, newPin?: string): Promise<string | null> {
    const realId = await resolveRealTenantId(null);
    if (!realId) return null;
    const pin = newPin && /^\d{4,6}$/.test(newPin)
        ? newPin
        : String(Math.floor(1000 + Math.random() * 9000));
    const r = await updateWaiter(id, { tenant_id: realId, pin });
    return r ? pin : null;
}
