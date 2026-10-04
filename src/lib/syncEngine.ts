// =====================================================================
// MOZONA TPV — syncEngine.ts: sincronización bidireccional con Supabase
// =====================================================================
// Dos direcciones:
//   • PUSH: la cola `pendingSync` de IndexedDB → tablas Supabase
//     (invoices, orders, etc.).  Idempotente vía upsert.
//   • PULL: el catálogo, la configuración y las mesas de Supabase
//     → IndexedDB.  Se ejecuta al arrancar y al volver online.
//
// Diseño:
//   • No usa auth (por defecto) — la RLS de Supabase filtra por
//     `restaurant_id` que se pasa explícitamente.  En producción
//     añade `supabase.auth.signInWithPassword()` antes del primer pull.
//   • Es seguro llamarlo concurrentemente: usa upsert y el pull es
//     idempotente (put por key).
// =====================================================================

import { isSupabaseConfigured, supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import {
    enqueueSync, getMeta, setMeta,
    getReadyPending, markSyncing, markSyncDone, markSyncFailed,
    putProducts, putCategories, putTables,
    type PendingSyncItem,
} from "./offlineStorage";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface PullStats {
    categories:   number;
    products:     number;
    tables:       number;
    restaurant:   number;
    zones:        number;
    waiters:      number;
}

export interface SyncResult {
    pushed:       number;             // facturas enviadas
    pushedOrders: number;             // pedidos enviados
    pull:         PullStats;
    durationMs:   number;
    errors:       string[];
    skipped:      string[];           // motivos por los que algo no se hizo
}

export interface SyncEngineOptions {
    /** Limita el número de items procesados en un solo ciclo (default 100) */
    maxBatch?: number;
}

// ---------------------------------------------------------------------
// Validación de configuración
// ---------------------------------------------------------------------

function assertConfigured(): void {
    if (!isSupabaseConfigured) {
        throw new Error(
            "Supabase no está configurado. Define VITE_SUPABASE_URL y " +
            "VITE_SUPABASE_ANON_KEY en .env (ver .env.example)."
        );
    }
}

/** Devuelve el restaurant_id configurado o lanza si no hay. */
async function getRestaurantId(): Promise<string> {
    const id = await getMeta<string>("mozona.restaurant_id");
    if (!id) {
        throw new Error(
            "No hay restaurant_id configurado. Configúralo en el panel " +
            "de Almacenamiento dentro de Settings."
        );
    }
    return id;
}

// ---------------------------------------------------------------------
// PUSH: cola local → Supabase
// ---------------------------------------------------------------------

/**
 * Procesa los items PENDING de la cola y los inserta en Supabase.
 * Devuelve el número de items enviados con éxito.
 */
export async function pushPendingItems(
    opts: SyncEngineOptions = {},
): Promise<{ pushed: number; pushedOrders: number }> {
    assertConfigured();
    const max = opts.maxBatch ?? 100;
    const items = (await getReadyPending()).slice(0, max);

    let pushed = 0;
    let pushedOrders = 0;

    for (const item of items) {
        if (!navigator.onLine) break;
        try {
            await markSyncing(item.id!);
            await pushOne(item);
            await markSyncDone(item.id!);
            if (item.kind === "INVOICE_PUSH") pushed += 1;
            if (item.kind === "ORDER_PUSH")   pushedOrders += 1;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await markSyncFailed(item.id!, msg);
        }
    }

    return { pushed, pushedOrders };
}

async function pushOne(item: PendingSyncItem): Promise<void> {
    switch (item.kind) {
        case "INVOICE_PUSH": {
            const { error } = await supabase
                .from("invoices")
                .upsert(item.payload as Record<string, unknown>, {
                    onConflict: "restaurant_id,series,number",
                    ignoreDuplicates: false,
                });
            if (error) throw error;
            return;
        }
        case "ORDER_PUSH": {
            const payload = item.payload as { order: Record<string, unknown>; items: Array<Record<string, unknown>> };
            // ★ v4.4.3: safety-net — eliminar created_at UUID-ify
            const { sanitizePayload } = await import("./payload-sanitizer");
            const cleanOrder = sanitizePayload(payload.order);
            // ★ v4.2.7: defense in depth — garantizar tenant_id en TODAS las filas
            const realTid = await resolveRealTenantId(null);
            const orderWithTid = realTid && !cleanOrder.tenant_id
                ? { ...cleanOrder, tenant_id: realTid }
                : cleanOrder;
            // Inserta cabecera y líneas en dos pasos.  Si la cabecera ya
            // existe, ignora el duplicado.
            const { error: e1 } = await supabase
                .from("orders")
                .upsert(orderWithTid, { onConflict: "id" });
            if (e1) throw e1;
            if (payload.items.length > 0) {
                const itemsClean = payload.items.map((it: any) => sanitizePayload(it));
                const itemsWithTid = realTid
                    ? itemsClean.map((it: any) => it.tenant_id ? it : { ...it, tenant_id: realTid })
                    : itemsClean;
                const { error: e2 } = await supabase
                    .from("order_items")
                    .upsert(itemsWithTid, { onConflict: "id" });
                if (e2) throw e2;
            }
            return;
        }
        case "CATEGORY_PULL":
        case "PRODUCT_PULL":
            // Son pulls, no se pushan.
            return;
    }
}

// ---------------------------------------------------------------------
// PULL: Supabase → IndexedDB
// ---------------------------------------------------------------------

/**
 * Descarga de Supabase: restaurante, carta, mesas, zonas y camareros.
 * Lo guarda en IndexedDB.  Devuelve las estadísticas de la operación.
 */
export async function pullInitialData(): Promise<PullStats> {
    assertConfigured();
    const restaurantId = await getRestaurantId();

    const [
        restRes,   catsRes,   prodsRes,
        tablesRes,  zonesRes,  waitersRes,
    ] = await Promise.all([
        supabase.from("restaurants").select("*").eq("id", restaurantId).maybeSingle(),
        supabase.from("categories").select("*").eq("restaurant_id", restaurantId),
        supabase.from("products").select("*").eq("restaurant_id", restaurantId),
        supabase.from("tables").select("*").eq("restaurant_id", restaurantId),
        supabase.from("zones").select("*").eq("restaurant_id", restaurantId),
        supabase.from("waiters").select("*").eq("restaurant_id", restaurantId).eq("is_active", true),
    ]);

    if (restRes.error)   throw new Error(`restaurant: ${restRes.error.message}`);
    if (catsRes.error)   throw new Error(`categories: ${catsRes.error.message}`);
    if (prodsRes.error)  throw new Error(`products: ${prodsRes.error.message}`);
    if (tablesRes.error) throw new Error(`tables: ${tablesRes.error.message}`);
    if (zonesRes.error)  throw new Error(`zones: ${zonesRes.error.message}`);
    if (waitersRes.error) throw new Error(`waiters: ${waitersRes.error.message}`);

    // Persistir
    if (restRes.data) {
        await setMeta("mozona.current_restaurant", restRes.data);
    }
    if (catsRes.data)   await putCategories(catsRes.data as Array<{ id: string; name: string; restaurant_id: string; sort_order: number }>);
    if (prodsRes.data)  await putProducts(prodsRes.data as Array<{ id: string; name: string; description: string | null; price: number; tax_rate: number; category_id: string | null; restaurant_id: string; is_available: boolean }>);
    if (tablesRes.data) {
        // Join con zones (best-effort)
        const tablesWithZone = (tablesRes.data as Array<{ id: string; restaurant_id: string; zone_id: string | null; table_number: string; status: string }>).map(t => ({
            ...t,
            zone: (zonesRes.data as Array<{ id: string; name: string }> | null)?.find(z => z.id === t.zone_id)?.name ?? null,
        })) as Array<{ id: string; restaurant_id: string; zone_id: string | null; zone: string | null; table_number: string; status: "FREE" | "OCCUPIED" | "BILL_REQUESTED" | "RESERVED" | "DIRTY" }>;
        await putTables(tablesWithZone);
    }
    if (waitersRes.data) {
        await setMeta("mozona.waiters", waitersRes.data);
    }

    await setMeta("mozona.last_pull_at", new Date().toISOString());

    return {
        restaurant: restRes.data ? 1 : 0,
        categories: catsRes.data?.length  ?? 0,
        products:   prodsRes.data?.length  ?? 0,
        tables:     tablesRes.data?.length ?? 0,
        zones:      zonesRes.data?.length  ?? 0,
        waiters:    waitersRes.data?.length ?? 0,
    };
}

// ---------------------------------------------------------------------
// FULL SYNC: push + pull en una sola operación
// ---------------------------------------------------------------------

/**
 * Push + pull en una sola pasada.  Si el push falla, el pull sigue
 * intentando (puede que el pull no requiera permisos de escritura).
 */
export async function fullSync(
    opts: SyncEngineOptions = {},
): Promise<SyncResult> {
    const start = Date.now();
    const errors: string[] = [];
    const skipped: string[] = [];

    if (!isSupabaseConfigured) {
        return {
            pushed: 0, pushedOrders: 0,
            pull: { categories: 0, products: 0, tables: 0, restaurant: 0, zones: 0, waiters: 0 },
            durationMs: 0,
            errors: ["Supabase no está configurado"],
            skipped: ["pull", "push"],
        };
    }

    if (!navigator.onLine) {
        return {
            pushed: 0, pushedOrders: 0,
            pull: { categories: 0, products: 0, tables: 0, restaurant: 0, zones: 0, waiters: 0 },
            durationMs: 0,
            errors: ["Sin conexión a Internet"],
            skipped: ["pull", "push"],
        };
    }

    // 1) PUSH
    let pushed = 0, pushedOrders = 0;
    try {
        const r = await pushPendingItems(opts);
        pushed = r.pushed;
        pushedOrders = r.pushedOrders;
    } catch (e) {
        errors.push(`push: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2) PULL
    let pull: PullStats = {
        categories: 0, products: 0, tables: 0,
        restaurant: 0, zones: 0, waiters: 0,
    };
    try {
        pull = await pullInitialData();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Si el error es "no restaurant_id", es esperable: el usuario
        // aún no lo ha configurado.  No lo marcamos como error fatal.
        if (msg.includes("restaurant_id")) {
            skipped.push("pull (falta restaurant_id)");
        } else {
            errors.push(`pull: ${msg}`);
        }
    }

    await setMeta("mozona.last_sync_at", new Date().toISOString());

    return {
        pushed, pushedOrders, pull,
        durationMs: Date.now() - start,
        errors, skipped,
    };
}

// ---------------------------------------------------------------------
// Helpers de alto nivel
// ---------------------------------------------------------------------

/** Encolar una factura para sincronizar.  Si hay red, intenta ya. */
export async function enqueueInvoice(invoice: Record<string, unknown>): Promise<number> {
    const id = await enqueueSync("INVOICE_PUSH", invoice);
    if (isSupabaseConfigured && navigator.onLine) {
        // Dispara un push en background, sin await.
        void pushPendingItems().catch(() => { /* errores se loguean dentro */ });
    }
    return id;
}

/** Encolar un pedido (cabecera + líneas) para sincronizar. */
export async function enqueueOrder(
    order: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
): Promise<number> {
    return enqueueSync("ORDER_PUSH", { order, items });
}

/** Configura el restaurant_id (lo guarda en IndexedDB meta). */
export async function setRestaurantId(id: string): Promise<void> {
    await setMeta("mozona.restaurant_id", id);
}

/** Devuelve el restaurant_id configurado o null. */
export async function getConfiguredRestaurantId(): Promise<string | null> {
    return (await getMeta<string>("mozona.restaurant_id")) ?? null;
}
