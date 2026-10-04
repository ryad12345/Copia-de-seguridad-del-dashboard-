// =====================================================================
// MOZONA TPV — supabase-fetch.ts (v4.1.2-fix-401)
// =====================================================================
// Wrapper de fetch() que SIEMPRE añade apikey + Authorization.
// Cualquier fetch directo a Supabase DEBE usar este helper.
// =====================================================================

import { SUPABASE_URL_EXPORT as SUPABASE_URL, SUPABASE_ANON_EXPORT as SUPABASE_ANON } from "./supabase";

// Headers por defecto que SIEMPRE viajan en cualquier request a Supabase.
// Sin esto, PostgREST devuelve 401 "No API key found in request".
export function getSupabaseHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        "apikey": SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        "x-application-name": "mozona-tpv",
        "x-client-info": "mozona-tpv/web",
        ...(extra || {}),
    };
}

/**
 * fetch() a Supabase con headers garantizados.
 * Uso:
 *   const r = await supabaseFetch("/rest/v1/products?select=*");
 *   const r = await supabaseFetch("/functions/v1/mi-edge", { method: "POST", body: JSON.stringify(data) });
 */
export async function supabaseFetch(
    path: string,
    init?: RequestInit & { jwt?: string | null }
): Promise<Response> {
    const url = path.startsWith("http")
        ? path
        : `${SUPABASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

    const headers = getSupabaseHeaders(
        init?.headers as Record<string, string> | undefined
    );

    // Si se pasa un JWT del usuario autenticado, sobreescribe Authorization
    if (init?.jwt) {
        headers["Authorization"] = `Bearer ${init.jwt}`;
    }

    return fetch(url, {
        ...init,
        headers,
    });
}

if (typeof window !== "undefined") {
    try {
        (window as any).__mozonaFetch = supabaseFetch;
    } catch {}
}
