// =====================================================================
// MOZONA TPV — orders.ts: persistencia de comandas en Supabase
// =====================================================================
// Los camareros (vía /waiter) y el TPV (vía /app) usan este módulo
// para crear comandas, leer comandas activas y marcarlas como pagadas.
//
// SINCRONIZACIÓN:
//   • Realtime en `orders` y `order_items` (postgres_changes)
//   • El TPV se suscribe via supabase.channel() y actualiza mesas
//   • El camarero recibe confirmación visual inmediata
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";

export interface OrderItemRow {
    id:         string;
    order_id:   string;
    product_id: string | null;
    name:       string;
    price:      number;
    quantity:   number;
    notes:      string | null;
    created_at: string;
}

export interface OrderRow {
    id:             string;
    tenant_id:      string;
    table_id:       string | null;
    waiter_name:    string | null;
    status:         "open" | "sent" | "billed" | "paid" | "cancelled";
    subtotal:       number;
    tax_total:      number;
    total:          number;
    payment_method: string | null;
    created_at:     string;
}

export interface CreateOrderInput {
    tenant_id:      string;
    table_id:       string | null;
    table_label:    string;
    waiter_name:    string;
    items: Array<{
        product_id: string | null;
        name:       string;
        price:      number;
        quantity:   number;
        notes?:     string | null;
    }>;
}

/** Normaliza un valor NUMERIC de Supabase a number (a veces llega como string) */
const N = (v: unknown): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v) || 0;
    return 0;
};

/** Crea una comanda (con sus líneas) en Supabase. */
export async function createOrder(input: CreateOrderInput): Promise<{
    order: OrderRow;
    items: OrderItemRow[];
} | null> {
    if (!isSupabaseConfigured) {
        console.warn("[orders] Supabase no configurado");
        return null;
    }
    if (!input.tenant_id) {
        console.warn("[orders] tenant_id requerido");
        return null;
    }
    if (!input.items || input.items.length === 0) {
        console.warn("[orders] items vacío");
        return null;
    }

    // 1) Calcular totales
    let subtotal = 0;
    for (const it of input.items) {
        subtotal += N(it.price) * N(it.quantity);
    }
    const tax_total = 0; // se calcula en backend si hay tax_rate en product
    const total = subtotal + tax_total;

    try {
        // ★ v4.4.3: safety-net — payload nunca lleva created_at UUID
        const { sanitizeOrdersPayload } = await import("./payload-sanitizer");
        // 2) Insertar cabecera
        const { data: order, error: orderErr } = await supabase
            .from("orders")
            .insert(sanitizeOrdersPayload({
                tenant_id:     input.tenant_id,
                table_id:      input.table_id,
                waiter_name:   input.waiter_name,
                status:        "sent",
                subtotal:      subtotal,
                tax_total:     tax_total,
                total:         total,
            }))
            .select()
            .single();

        if (orderErr) {
            console.error("[orders] insert order error:", orderErr.message);
            return null;
        }
        if (!order) {
            console.error("[orders] order sin data");
            return null;
        }

        // 3) Insertar líneas
        const itemsRows = input.items.map(it => ({
            order_id:   order.id,
            product_id: it.product_id,
            name:       it.name,
            price:      N(it.price),
            quantity:   N(it.quantity),
            notes:      it.notes ?? null,
        }));

        const { data: items, error: itemsErr } = await supabase
            .from("order_items")
            .insert(itemsRows)
            .select();

        if (itemsErr) {
            console.error("[orders] insert items error:", itemsErr.message);
            // rollback: borrar la cabecera
            await supabase.from("orders").delete().eq("id", order.id);
            return null;
        }

        // 4) Marcar la mesa como "occupied" (best-effort)
        if (input.table_id) {
            await supabase
                .from("dining_tables")
                .update({ status: "occupied" })
                .eq("id", input.table_id);
        }

        // 5) ★ CRÍTICO: Actualizar/crear el borrador en open_orders
        //    para que el TPV pueda mostrar las líneas al hacer click
        //    en la mesa.  Clave: (tenant_id, table_number) — funciona
        //    tanto si el camarero envía table_id="local-table-16"
        //    como si el TPV tiene UUID de dining_tables.
        try {
            const { data: existing } = await supabase
                .from("open_orders")
                .select("id, items")
                .eq("tenant_id", input.tenant_id)
                .eq("table_number", input.table_label)
                .maybeSingle();
            const newItemsAsOrder = (items ?? []).map((it: any) => ({
                id:          it.id,
                product_id:  it.product_id,
                name:        it.name,
                unit_price:  N(it.price),
                tax_rate:    10,
                quantity:    N(it.quantity),
                notes:       it.notes ?? "",
                added_at:    new Date().toISOString(),
            }));
            const existingItems = Array.isArray(existing?.items) ? existing!.items : [];
            const merged = [...existingItems, ...newItemsAsOrder];
            const { error: draftErr } = await supabase
                .from("open_orders")
                .upsert({
                    tenant_id:    input.tenant_id,
                    table_id:     input.table_id ?? "",
                    table_number: input.table_label,
                    waiter_name:  input.waiter_name,
                    items:        merged,
                }, { onConflict: "tenant_id,table_number" });
            if (draftErr) {
                console.warn("[orders] upsert open_orders error:", draftErr.message);
            } else {
                console.log("[orders] open_orders actualizado con", merged.length, "items (mesa", input.table_label, ")");
            }
        } catch (e) {
            console.warn("[orders] open_orders upsert exception:", e);
        }

        return {
            order: { ...order, subtotal, tax_total, total } as OrderRow,
            items: (items ?? []) as OrderItemRow[],
        };
    } catch (e) {
        console.error("[orders] createOrder exception:", e);
        return null;
    }
}

/** Lista las comandas abiertas (status='sent' o 'open') de un tenant. */
export async function listOpenOrders(tenantId: string): Promise<OrderRow[]> {
    if (!isSupabaseConfigured || !tenantId) return [];
    const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "sent"])
        .order("created_at", { ascending: false });
    if (error) {
        console.warn("[orders] listOpenOrders error:", error.message);
        return [];
    }
    return (data ?? []) as OrderRow[];
}

/** Lista comandas de una mesa. */
export async function listOrdersForTable(tableId: string, tenantId?: string): Promise<OrderRow[]> {
    if (!isSupabaseConfigured || !tableId) return [];
    // ★ v3.4.9: Filtrar también por tenant_id (defensa en profundidad)
    let query = supabase
        .from("orders")
        .select("*")
        .eq("table_id", tableId)
        .order("created_at", { ascending: false });
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) {
        console.warn("[orders] listOrdersForTable error:", error.message);
        return [];
    }
    return (data ?? []) as OrderRow[];
}

/** Lista las líneas de una comanda. */
export async function listOrderItems(orderId: string): Promise<OrderItemRow[]> {
    if (!isSupabaseConfigured || !orderId) return [];
    const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at");
    if (error) {
        console.warn("[orders] listOrderItems error:", error.message);
        return [];
    }
    return (data ?? []) as OrderItemRow[];
}

/** Marca una comanda como pagada. */
export async function markOrderPaid(
    orderId: string,
    paymentMethod: string = "cash",
): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase
        .from("orders")
        .update({
            status: "paid",
            payment_method: paymentMethod,
        })
        .eq("id", orderId);
    if (error) {
        console.warn("[orders] markOrderPaid error:", error.message);
        return false;
    }
    // Liberar la mesa
    const { data: order } = await supabase
        .from("orders")
        .select("table_id")
        .eq("id", orderId)
        .single();
    if (order?.table_id) {
        await supabase
            .from("dining_tables")
            .update({ status: "available" })
            .eq("id", order.table_id);
    }
    return true;
}

// ---------------------------------------------------------------------
// Realtime: suscripción a nuevas comandas
// ---------------------------------------------------------------------

/** Suscripción a INSERTs en `orders` de un tenant. Devuelve unsub. */
export function subscribeToOrders(
    tenantId: string,
    onNewOrder: (order: OrderRow) => void,
): () => void {
    if (!isSupabaseConfigured || !tenantId) return () => undefined;
    const channel = supabase
        .channel(`orders:${tenantId}`)
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "orders",
              filter: `tenant_id=eq.${tenantId}` },
            (payload) => {
                const o = payload.new as OrderRow;
                if (o && o.status !== "paid" && o.status !== "cancelled") {
                    onNewOrder(o);
                }
            }
        )
        .subscribe();
    return () => { void supabase.removeChannel(channel); };
}
