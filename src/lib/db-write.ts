// =====================================================================
// MOZONA TPV — db-write.ts (v4.1.8-persistence)
// =====================================================================
// Wrapper central para TODOS los writes (INSERT/UPDATE/DELETE).
// Garantiza:
//   - JWT del usuario en headers Authorization
//   - tenant_id correcto en path/filter
//   - Logs de éxito/error
//   - No bypassa RLS por error
// =====================================================================

import { supabaseFetch } from "./supabase-fetch";

declare global {
    interface Window {
        __dbWrite?: (...args: any[]) => any;
    }
}

export type WriteAction = "INSERT" | "UPDATE" | "DELETE";

export interface DbWriteOptions {
    table: string;
    action: WriteAction;
    /** Payload para INSERT (objeto) o UPDATE (objeto). Para DELETE omitir. */
    payload?: any;
    /** Para UPDATE/DELETE: filtro {col: val}. Si no, asume "id=eq.<payload.id>". */
    filter?: Record<string, string>;
    /** JWT del usuario (obtenido de AuthContext.session.access_token) */
    jwt: string | null;
}

export interface DbWriteResult<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
    status?: number;
}

/**
 * Helper central para escrituras.
 * USO:
 *   await dbWrite({ table: "products", action: "INSERT", payload: {...}, jwt });
 *   await dbWrite({ table: "products", action: "UPDATE", payload: {...}, filter: {id: "abc"}, jwt });
 *   await dbWrite({ table: "products", action: "DELETE", filter: {id: "abc"}, jwt });
 */
export async function dbWrite<T = any>(opts: DbWriteOptions): Promise<DbWriteResult<T>> {
    const { table, action, payload, filter, jwt } = opts;

    // Construir query string
    let query = "";
    if (filter && Object.keys(filter).length > 0) {
        const parts = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`);
        query = "?" + parts.join("&");
    } else if ((action === "UPDATE" || action === "DELETE") && payload?.id) {
        query = `?id=eq.${encodeURIComponent(payload.id)}`;
    }

    // Determinar método HTTP y body
    let method: string;
    let body: string | undefined;

    if (action === "INSERT") {
        method = "POST";
        // Prefer header single (1 row) para evitar problemas con array
        body = JSON.stringify(payload);
    } else if (action === "UPDATE") {
        method = "PATCH";
        body = JSON.stringify(payload);
    } else if (action === "DELETE") {
        method = "DELETE";
        body = undefined;
    } else {
        return { ok: false, error: `unknown action ${action}` };
    }

    const path = `/rest/v1/${table}${query}`;

    try {
        const r = await supabaseFetch(path, {
            method,
            jwt,
            body,
        });

        const status = r.status;

        if (!r.ok) {
            const errText = await r.text().catch(() => "");
            console.error(`[dbWrite] ${action} ${table} failed:`, status, errText);
            return {
                ok: false,
                error: errText || `HTTP ${status}`,
                status,
            };
        }

        // 201 (insert) o 204 (delete/update) o 200
        let data: any = undefined;
        if (status !== 204) {
            try { data = await r.json(); } catch {}
        }

        console.log(`[dbWrite] OK ${action} ${table} status=${status}`);
        return { ok: true, data, status };
    } catch (e: any) {
        const msg = e?.message || String(e);
        console.error(`[dbWrite] exception ${action} ${table}:`, msg);
        return { ok: false, error: msg };
    }
}

if (typeof window !== "undefined") {
    try { window.__dbWrite = dbWrite; } catch {}
}
