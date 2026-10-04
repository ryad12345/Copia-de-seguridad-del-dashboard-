// =====================================================================
// MOZONA TPV — tables v4.4.0 (RPC ZERO-BLOCK)
// =====================================================================
// CRUD de dining_tables vía fn_update_table_status (SECURITY DEFINER).
// =====================================================================

import { rpcUpdateTableStatus } from "./rpc";
import { resolveRealTenantId } from "./waiters";
import { supabaseFetch } from "./supabase-fetch";

export type TableDbStatus = "free" | "occupied" | "reserved" | "dirty" | "available";

export interface DiningTable {
    id?:          string;
    tenant_id?:   string;
    table_number: string | number;
    table_id?:    string;
    seats?:       number;
    status?:      TableDbStatus | "OCCUPIED" | "FREE" | "DIRTY" | "RESERVED";
    current_order_id?: string | null;
    section?:     string;
    created_at?:  string;
    updated_at?:  string;
}

/**
 * Lista todas las mesas del tenant (read directo — no es crítico).
 */
export async function listTables(tenantId: string | null): Promise<DiningTable[]> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return [];
    try {
        const r = await supabaseFetch(
            `/rest/v1/dining_tables?tenant_id=eq.${realId}&order=table_number.asc`,
            { jwt: null }
        );
        if (!r.ok) {
            console.warn("[tables] list HTTP", r.status);
            return [];
        }
        return await r.json();
    } catch (e: any) {
        console.warn("[tables] list exception:", e?.message);
        return [];
    }
}

/**
 * ★ CRÍTICO: actualizar estado de mesa vía fn_update_table_status RPC.
 * SECURITY DEFINER — sin bloqueos RLS.
 */
export async function updateTableStatus(input: {
    tenantId:        string | null;
    tableId:         string;
    tableNumber?:    string | number;
    status:          TableDbStatus | "OCCUPIED" | "FREE" | "DIRTY" | "RESERVED";
    currentOrderId?: string | null;
}): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
    const realId = await resolveRealTenantId(input.tenantId);
    if (!realId) return { ok: false, error: "Sin tenantId" };

    const r = await rpcUpdateTableStatus({
        tenantId:        realId,
        tableId:         input.tableId,
        tableNumber:     input.tableNumber,
        status:          String(input.status || "free").toLowerCase(),
        currentOrderId:  input.currentOrderId ?? null,
    });

    if (!r.ok) {
        console.warn("[tables] update RPC fail:", r.error);
        return { ok: false, error: r.error };
    }

    console.log("[tables] ✅ update status", input.status, "table", input.tableId);
    return { ok: true, data: r.data };
}

export async function occupyTable(tenantId: string | null, tableId: string, tableNumber?: string | number, orderId?: string): Promise<void> {
    await updateTableStatus({
        tenantId,
        tableId,
        tableNumber,
        status: "occupied",
        currentOrderId: orderId ?? null,
    });
}

export async function freeTable(tenantId: string | null, tableId: string, tableNumber?: string | number): Promise<void> {
    await updateTableStatus({
        tenantId,
        tableId,
        tableNumber,
        status: "free",
        currentOrderId: null,
    });
}

export async function dirtyTable(tenantId: string | null, tableId: string, tableNumber?: string | number): Promise<void> {
    await updateTableStatus({
        tenantId,
        tableId,
        tableNumber,
        status: "dirty",
    });
}

/**
 * Seed inicial: si BD vacía, crea las 16 mesas por defecto.
 * Usa REST directo + RLS permisivo (no crítico transaccional).
 */
export async function seedDefaultTables(tenantId: string | null): Promise<{ ok: boolean; created: number }> {
    const realId = await resolveRealTenantId(tenantId);
    if (!realId) return { ok: false, created: 0 };

    const existing = await listTables(realId);
    if (existing.length > 0) return { ok: true, created: 0 };

    const rows = Array.from({ length: 16 }, (_, i) => ({
        tenant_id:    realId,
        table_number: String(i + 1),
        status:       "free" as TableDbStatus,
        seats:        i < 4 ? 2 : i < 12 ? 4 : 6,
        section:      "main",
    }));

    try {
        const r = await supabaseFetch("/rest/v1/dining_tables", {
            method: "POST",
            jwt: null,
            headers: { "Prefer": "return=minimal" },
            body: JSON.stringify(rows),
        });
        if (!r.ok) {
            const errText = await r.text().catch(() => "");
            console.warn("[tables] seed HTTP", r.status, errText);
            return { ok: false, created: 0 };
        }
        console.log("[tables] ✅ seed", rows.length, "mesas");
        return { ok: true, created: rows.length };
    } catch (e: any) {
        console.warn("[tables] seed exception:", e?.message);
        return { ok: false, created: 0 };
    }
}
