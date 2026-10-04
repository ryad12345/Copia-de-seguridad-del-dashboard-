// =====================================================================
// MOZONA TPV — src/lib/api.ts
// Wrapper centralizado de llamadas Supabase con manejo de errores
// 401 / 403 / PGRST301 / 42501 (RLS denegado).
// v4.5.17 — BLOQUE 3 del plan de remediación auditoría (02/10/2026).
//
// Reglas:
//   - 401 / PGRST301 / JWT expirado → refresh + retry → si falla, logout
//   - 403 / 42501 → lanza ApiError con mensaje claro
//   - 404 / PGRST202 (function not found) → lanzar ApiError para que
//     callRpc decida fallback
// =====================================================================

import { supabase } from "./supabase";

export class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

type SupabaseResult<T> = {
    data: T | null;
    error: { message: string; status?: number; code?: string } | null;
};

/**
 * Ejecuta una operación Supabase con manejo centralizado de errores.
 *   - 401/PGRST301/JWT expirado: refresh + retry UNA vez, si falla logout
 *   - 403/42501: lanza ApiError → caller decide UX
 *   - PGRST202 (function not found): lanza ApiError → caller decide fallback
 *   - Sin error: cualquier resultado y lo devuelve
 */
export async function withSession<T>(
    op: () => PromiseLike<SupabaseResult<T>>
): Promise<T> {
    const { data, error } = await op();
    if (!error) return data as T;

    const code = error.code ?? "";
    const msg = error.message ?? "";
    const status = error.status ?? 0;

    // 1) Sesión caducada / JWT inválido → refrescar y reintentar UNA vez
    if (status === 401 || code === "PGRST301" || /jwt|expired/i.test(msg)) {
        try {
            const { error: refreshErr } = await supabase.auth.refreshSession();
            if (!refreshErr) {
                const retry = await op();
                if (!retry.error) return retry.data as T;
            }
        } catch (_) { /* ignore */ }
        // refresh falló → forzar logout y redirigir a /login
        try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
            window.location.assign("/auth?reason=session_expired");
        }
        throw new ApiError("Tu sesión ha expirado. Inicia sesión de nuevo.", 401, code);
    }

    // 2) RLS / permisos (403/42501) → no autorizado
    if (status === 403 || code === "42501") {
        throw new ApiError("No tienes permisos para esta operación.", 403, code);
    }

    // 3) PGRST202: function RPC no encontrada → caller decide fallback
    if (code === "PGRST202" || /Could not find the function/i.test(msg)) {
        throw new ApiError(msg || "RPC not found", status || 404, code);
    }

    // 4) 404 / not found → bubble up
    if (status === 404 || code === "PGRST116") {
        throw new ApiError(msg || "Not found", 404, code);
    }

    // 5) Cualquier otro error
    throw new ApiError(msg || "Error inesperado", status || 500, code);
}

/**
 * Wrapper para queries de tabla (SELECT).
 */
export async function tableGet<T = any>(
    table: string,
    select: string = "*",
    filter?: (q: any) => any
): Promise<T[]> {
    let q = supabase.from(table).select(select);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) {
        // Reutilizar la lógica de withSession
        return withSession(async () => ({ data: null, error } as SupabaseResult<T[]>));
    }
    return (data ?? []) as T[];
}

/**
 * Detecta si un error es ApiError.
 */
export function isApiError(e: unknown): e is ApiError {
    return e instanceof ApiError;
}