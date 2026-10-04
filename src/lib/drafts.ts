// =====================================================================
// MOZONA TPV — drafts v4.4.0 (RPC ZERO-BLOCK)
// =====================================================================
// Upsert/Clear de open_orders vía fn_upsert_draft / fn_clear_draft.
// =====================================================================

import { rpcUpsertDraft, rpcClearDraft } from "./rpc";
import { resolveRealTenantId } from "./waiters";
import type { OrderItem } from "./types";

export interface OpenOrder {
    id:            string;
    tenant_id:     string;
    table_id:      string;
    table_number:  string;
    waiter_name:   string | null;
    items:         OrderItem[];
    notes:         string | null;
    status:        "open" | "locked";
    created_at:    string;
    updated_at:    string;
}

/**
 * Cargar borradores del tenant.
 * Mantiene el GET simple (no es crítico transaccional).
 */
export async function listOpenDrafts(tenantId: string | null): Promise<OpenOrder[]> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return [];
    try {
        const { supabase } = await import("./supabase");
        if (!supabase) return [];
        const { data, error } = await supabase
            .from("open_orders")
            .select("*")
            .eq("tenant_id", realId)
            .eq("status", "open")
            .order("updated_at", { ascending: false });
        if (error) {
            console.warn("[drafts] list fail:", error.message);
            return [];
        }
        return (data || []) as OpenOrder[];
    } catch (e: any) {
        console.warn("[drafts] list exception:", e?.message);
        return [];
    }
}

/**
 * Guardar/actualizar borrador de una mesa vía RPC SECURITY DEFINER.
 */
export async function upsertDraft(input: {
    tenantId: string | null;
    tableId: string;
    tableNumber: string;
    items: OrderItem[];
    waiterName?: string | null;
    notes?: string | null;
}): Promise<OpenOrder | null> {
    const realId = await resolveRealTenantId(input.tenantId);
    if (!realId) {
        console.warn("[drafts] upsertDraft: sin tenantId válido");
        return null;
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
        await clearDraft(realId, input.tableId);
        return null;
    }

    const r = await rpcUpsertDraft({
        tenantId:    realId,
        tableId:     input.tableId,
        tableNumber: input.tableNumber,
        items:       input.items as any,
        waiterName:  input.waiterName ?? null,
        notes:       input.notes ?? null,
    });

    if (!r.ok) {
        console.warn("[drafts] upsert RPC fail:", r.error);
        return null;
    }
    return (r.data?.data || r.data) as OpenOrder | null;
}

/**
 * Borrar borrador de una mesa vía RPC SECURITY DEFINER.
 */
export async function clearDraft(
    tenantId: string | null,
    tableIdOrNumber: string | number,
): Promise<void> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return;

    const r = await rpcClearDraft(realId, String(tableIdOrNumber));
    if (r.ok) {
        console.log("[drafts] ✅ clear", tableIdOrNumber, `deleted=${r.deleted}`);
    } else {
        console.warn("[drafts] clear RPC fail:", r.error);
    }
}

/**
 * Obtiene el borrador abierto de una mesa concreta (por table_id o table_number).
 * Devuelve null si no existe o si falla la consulta.
 */
export async function getOpenDraft(
    tenantId: string | null,
    tableIdOrNumber: string | number,
): Promise<OpenOrder | null> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return null;
    const key = String(tableIdOrNumber);
    try {
        const { supabase } = await import("./supabase");
        if (!supabase) return null;
        const { data, error } = await supabase
            .from("open_orders")
            .select("*")
            .eq("tenant_id", realId)
            .eq("status", "open")
            .or(`table_id.eq.${key},table_number.eq.${key}`)
            .maybeSingle();
        if (error) {
            console.warn("[drafts] getOpenDraft fail:", error.message);
            return null;
        }
        return (data as OpenOrder) || null;
    } catch (e: any) {
        console.warn("[drafts] getOpenDraft exception:", e?.message);
        return null;
    }
}

/**
 * Sync completo: persistir comanda actual.
 */
export async function persistOpenOrder(
    tenantId: string | null,
    tableId: string,
    tableNumber: string,
    items: OrderItem[],
    waiterName?: string | null,
): Promise<{ ok: boolean; error?: string }> {
    const result = await upsertDraft({
        tenantId,
        tableId,
        tableNumber,
        items,
        waiterName,
    });
    if (result) return { ok: true };
    return { ok: false, error: "upsert falló" };
}
