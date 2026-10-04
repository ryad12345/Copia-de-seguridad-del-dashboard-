// =====================================================================
// MOZONA TPV — executeCheckout v4.4.0 (RPC ZERO-BLOCK)
// =====================================================================
// Wrapper delgado que delega a fn_atomic_checkout (SECURITY DEFINER).
// No más INSERT/UPDATE directos desde el cliente para transacciones.
// =====================================================================

import { rpcAtomicCheckout, type CheckoutItemRpc } from "./rpc";
import { resolveRealTenantId } from "./waiters";

export interface ExecuteCheckoutInput {
    tenantId?:     string | null;
    tableId?:      string | null;
    tableNumber?:  string | number | null;
    openOrderId?:  string | null;
    items?:        CheckoutItemRpc[];
    subtotal?:     number;
    taxTotal?:     number;
    total:         number;
    paymentMethod?: string;
    waiterName?:   string | null;
    series?:       string;
    invoiceNumber?: number;
}

export interface ExecuteCheckoutResult {
    ok: boolean;
    orderId?: string;
    error?: string;
    errorCode?: string;
    errorDetails?: string;
    errorHint?: string;
    step?: "tenant" | "rpc" | "insert_order" | "insert_items" | "delete_open_order" | "update_table";
}

export async function executeCheckout(input: ExecuteCheckoutInput): Promise<ExecuteCheckoutResult> {
    console.log("[executeCheckout] ★★ INICIO ★★", {
        tenantId: input.tenantId,
        tableId: input.tableId,
        tableNumber: input.tableNumber,
        items: input.items?.length ?? 0,
        total: input.total,
        paymentMethod: input.paymentMethod,
    });

    // 1) Resolver tenant_id
    const realId = await resolveRealTenantId(input.tenantId ?? null);
    const validTenantId = (realId && realId !== "00000000-0000-0000-0000-000000000000")
        ? realId
        : null;

    if (!validTenantId) {
        return { ok: false, error: "tenant_id inválido", step: "tenant" };
    }

    // 2) ★ Llamada atómica vía RPC SECURITY DEFINER
    try {
        const r = await rpcAtomicCheckout({
            tenantId:      validTenantId,
            tableId:       input.tableId ?? null,
            tableNumber:   input.tableNumber ?? null,
            items:         input.items ?? [],
            subtotal:      Number(input.subtotal ?? input.total),
            taxTotal:      Number(input.taxTotal ?? 0),
            total:         Number(input.total),
            paymentMethod: input.paymentMethod ?? "cash",
            waiterName:    input.waiterName ?? "Caja",
            series:        input.series ?? "T-F",
            invoiceNumber: input.invoiceNumber,
        });

        if (!r.ok) {
            console.error("[executeCheckout] ❌ RPC fail:", r.error);
            return {
                ok: false,
                error: r.error,
                errorCode: r.code,
                errorDetails: r.details,
                errorHint: r.hint,
                step: "rpc",
            };
        }

        const orderId = r.order_id || r.data?.order_id;
        console.log("[executeCheckout] ✅ orden creada:", orderId);
        return { ok: true, orderId };
    } catch (e: any) {
        console.error("[executeCheckout] ❌ exception:", e?.message);
        return { ok: false, error: e?.message ?? "RPC error", step: "rpc" };
    }
}

/**
 * Wrapper silencioso para usos no críticos.
 */
export async function executeCheckoutSilent(input: ExecuteCheckoutInput): Promise<ExecuteCheckoutResult> {
    try {
        return await executeCheckout(input);
    } catch (e: any) {
        console.error("[executeCheckoutSilent] error silencioso:", e?.message);
        return { ok: false, error: e?.message ?? "error" };
    }
}
