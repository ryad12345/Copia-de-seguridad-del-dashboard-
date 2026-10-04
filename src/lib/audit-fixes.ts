// =====================================================================
// MOZONA TPV — audit-fixes.ts v4.5.0 (capas de aislamiento)
// =====================================================================
// Helper que centraliza las queries multi-tenant.
// GARANTIZA que toda query a tablas multi-tenant incluye tenant_id.
// =====================================================================

import { supabase } from "./supabase";
import { supabaseFetch } from "./supabase-fetch";
import { getUserJwt } from "./auth-helpers";
import { resolveRealTenantId } from "./waiters";

const MULTI_TENANT_TABLES = new Set([
    "products",
    "categories",
    "orders",
    "order_items",
    "dining_tables",
    "open_orders",
    "drafts",
    "tenant_settings",
    "waiters",
    "cash_closures",
    "customers",
    "pre_bills",
    "ticket_settings",
    "email_outbox",
]);

/**
 * SELECT seguro: añade filtro tenant_id automáticamente.
 * Si la tabla es multi-tenant y NO se pasa tenantId, retorna error.
 */
export async function safeSelect<T = any>(args: {
    table: string;
    tenantId: string | null | undefined;
    select?: string;
    filter?: (q: any) => any;
    limit?: number;
    order?: { column: string; ascending?: boolean };
}): Promise<{ data: T[] | null; error: string | null }> {
    const isMulti = MULTI_TENANT_TABLES.has(args.table);
    let realTid: string | null = null;
    if (isMulti) {
        realTid = await resolveRealTenantId(args.tenantId ?? null);
        if (!realTid) {
            return { data: null, error: `tenant_id requerido para tabla '${args.table}'` };
        }
    }

    let q = supabase.from(args.table).select(args.select || "*");
    if (isMulti && realTid) {
        q = q.eq("tenant_id", realTid);
    }
    if (args.filter) {
        q = args.filter(q);
    }
    if (args.order) {
        q = q.order(args.order.column, { ascending: args.order.ascending ?? true });
    }
    if (args.limit) {
        q = q.limit(args.limit);
    }

    const { data, error } = await q;
    return { data: data as T[] | null, error: error?.message || null };
}

/**
 * INSERT seguro: añade tenant_id al payload automáticamente.
 */
export async function safeInsert(args: {
    table: string;
    tenantId: string | null | undefined;
    payload: Record<string, any> | Record<string, any>[];
}): Promise<{ data: any; error: string | null }> {
    const isMulti = MULTI_TENANT_TABLES.has(args.table);
    let realTid: string | null = null;
    if (isMulti) {
        realTid = await resolveRealTenantId(args.tenantId ?? null);
        if (!realTid) {
            return { data: null, error: `tenant_id requerido para tabla '${args.table}'` };
        }
    }

    const items = Array.isArray(args.payload) ? args.payload : [args.payload];
    const stamped = items.map(it => {
        if (isMulti && !it.tenant_id) {
            return { ...it, tenant_id: realTid };
        }
        return it;
    });
    const finalPayload = Array.isArray(args.payload) ? stamped : stamped[0];

    const jwt = getUserJwt();
    if (jwt) {
        // PREFERIR RPC — usar supabaseFetch para que JWT llegue
        // Para operaciones masivas (insert multiple), construir RPC si existe
        // Por ahora fallback a supabase.from con .insert normal
    }
    const { data, error } = await supabase.from(args.table).insert(finalPayload as any).select();
    return { data, error: error?.message || null };
}

/**
 * UPDATE seguro: añade filtro tenant_id automáticamente.
 */
export async function safeUpdate(args: {
    table: string;
    tenantId: string | null | undefined;
    payload: Record<string, any>;
    filter?: (q: any) => any;
}): Promise<{ data: any; error: string | null }> {
    const isMulti = MULTI_TENANT_TABLES.has(args.table);
    let realTid: string | null = null;
    if (isMulti) {
        realTid = await resolveRealTenantId(args.tenantId ?? null);
        if (!realTid) {
            return { data: null, error: `tenant_id requerido para tabla '${args.table}'` };
        }
    }

    let q = supabase.from(args.table).update(args.payload);
    if (isMulti && realTid) {
        q = q.eq("tenant_id", realTid);
    }
    if (args.filter) {
        q = args.filter(q);
    }

    const { data, error } = await q.select();
    return { data, error: error?.message || null };
}

/**
 * DELETE seguro: añade filtro tenant_id automáticamente.
 */
export async function safeDelete(args: {
    table: string;
    tenantId: string | null | undefined;
    filter?: (q: any) => any;
}): Promise<{ count: number; error: string | null }> {
    const isMulti = MULTI_TENANT_TABLES.has(args.table);
    let realTid: string | null = null;
    if (isMulti) {
        realTid = await resolveRealTenantId(args.tenantId ?? null);
        if (!realTid) {
            return { count: 0, error: `tenant_id requerido para tabla '${args.table}'` };
        }
    }

    let q = supabase.from(args.table).delete({ count: "exact" });
    if (isMulti && realTid) {
        q = q.eq("tenant_id", realTid);
    }
    if (args.filter) {
        q = args.filter(q);
    }

    const { count, error } = await q;
    return { count: count || 0, error: error?.message || null };
}

if (typeof window !== "undefined") {
    (window as any).__safeDb = { safeSelect, safeInsert, safeUpdate, safeDelete };
}
