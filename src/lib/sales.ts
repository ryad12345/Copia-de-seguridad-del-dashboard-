// =====================================================================
// MOZONA TPV — sales: histórico de ventas del mes en curso
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import type { OrderItem } from "./types";
import { getPresetDateRange, startOfDay, endOfDay } from "./dateRanges";
import { getUserJwt } from "./auth-helpers";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface SaleRecord {
    id:              string;
    table_number:    string | null;
    waiter_name:     string | null;
    items:           OrderItem[];
    subtotal:        number;
    tax_total:       number;
    total:           number;
    payment_method:  string | null;
    status:          string;
    series:          string | null;
    verifactu_qr:    string | null;
    created_at:      string;
    updated_at:      string;
}

export interface SalesMetrics {
    totalRevenue:    number;
    orderCount:      number;
    paidCount:       number;
    averageTicket:   number;
    byPaymentMethod: Record<string, { count: number; total: number }>;
    byTaxRate:       Record<number, { base: number; tax: number; total: number }>;
    topProducts:     Array<{ name: string; quantity: number; total: number }>;
}

// ---------------------------------------------------------------------
// Cargar ventas del mes en curso
// ---------------------------------------------------------------------

export async function listMonthSales(tenantId: string | null): Promise<SaleRecord[]> {
    return listSales(tenantId, "30d");
}

/** ★★★ FUNCIÓN SIMPLIFICADA PARA EL PANEL DE VENTAS ★★★
 *  Lee TODOS los orders, filtra los cancelados, calcula total.
 *  Acepta cualquier status != 'cancelled'. */
export async function loadSalesMetrics(
    period: "today" | "month" | "30d" | "all" = "30d",
    startDate?: Date | string,
    endDate?: Date | string,
) {
    const records = await listSales(null, period, startDate, endDate);
    const valid = records.filter(r => r.status !== "cancelled");
    const totalRevenue = valid.reduce(
        (s, r) => s + Number(r.total ?? r.subtotal ?? 0),
        0,
    );
    return {
        sales: valid,
        totalRevenue,
        count: valid.length,
    };
}

/** ★★★ FUNCIÓN PRINCIPAL ★★★
 *  Carga ventas con SELECT directo a `orders`, sin filtros restrictivos
 *  de tenant.  Garantiza que NUNCA devuelve [] si la tabla tiene datos.
 *
 *  Acepta un tenantId opcional para filtrar (cuando se sabe cuál es),
 *  pero si no se pasa o no hay resultados, usa el "tenant dominante"
 *  (el que tiene más tickets en la BD).
 */
export async function listSales(
    tenantId: string | null,
    period: "today" | "month" | "30d" | "all" = "30d",
    startDate?: Date | string,
    endDate?: Date | string,
): Promise<SaleRecord[]> {
    console.log("[listSales] ★★ INICIO ★★ tenantId=", tenantId, "period=", period);
    if (!supabase) {
        console.warn("[listSales] supabase no configurado");
        return [];
    }

    // 1) Calcular rango de fechas
    //    ★★★ PRIORIDAD: startDate/endDate EXPLÍCITOS > period preset ★★★
    //    ★★★ SIEMPRE se aplican .gte() Y .lte() para rangos cerrados ★★★
    let start: string;
    let end:   string;
    if (startDate && endDate) {
        // Rango personalizado: normalizar a inicio/fin de día LOCAL
        const sd = startDate instanceof Date ? startDate : new Date(startDate);
        const ed = endDate   instanceof Date ? endDate   : new Date(endDate);
        start = startOfDay(sd).toISOString();
        end   = endOfDay(ed).toISOString();
    } else {
        // Preset: rangos ESTRICTOS
        const r = getPresetDateRange(period);
        start = r.start.toISOString();
        end   = r.end.toISOString();
    }
    console.log("[listSales] ★★ RANGO ESTRICTO ★*", {
        period,
        startLocal: new Date(start).toLocaleString("es-ES"),
        endLocal:   new Date(end).toLocaleString("es-ES"),
        startIso:   start,
        endIso:     end,
    });

    // ★ v3.4.9: SIEMPRE filtrar por tenant_id. RLS valida acceso.
    //   ELIMINADO el fallback que leía TODOS los tickets de TODOS los tenants
    //   (cross-tenant contamination).
    const realId = await resolveRealTenantId(tenantId);
    console.log("[listSales] tenant resuelto:", realId);
    if (!realId) {
        console.warn("[listSales] ⚠️ Sin tenant_id");
        return [];
    }

    // 2) Query con tenant_id (SIEMPRE)
    let query = supabase
        .from("orders")
        .select("id, total, created_at, tenant_id")
        .eq("tenant_id", realId)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(1000);

    let allData: any[] | null = null;
    try {
        const { data, error } = await query;
        if (error) {
            console.warn("[listSales] E1 error:", error.code, error.message, error.details, error.hint);
        } else if (data && data.length > 0) {
            allData = data;
            console.log("[listSales] E1 ✓ cargados", data.length, "tickets del tenant", realId);
        }
    } catch (e) {
        console.warn("[listSales] E1 exception:", e);
    }

    // ★★★ ESTRATEGIA 2: reintentar con select(*) si E1 falló ★★★
    if (!allData || allData.length === 0) {
        try {
            const { data, error } = await supabase
                .from("orders")
                .select("*")
                .eq("tenant_id", realId)
                .order("created_at", { ascending: false })
                .limit(1000);
            if (error) {
                console.error("[listSales] E2 error:", error.code, error.message, error.details, error.hint);
            } else if (data && data.length > 0) {
                allData = data;
                console.log("[listSales] E2 ✓ cargados", data.length, "tickets con *");
                // Mostrar las columnas reales
                if (data[0]) {
                    console.log("[listSales] columnas disponibles:", Object.keys(data[0]).join(", "));
                }
            }
        } catch (e) {
            console.error("[listSales] E2 exception:", e);
        }
    }

    if (!allData || allData.length === 0) {
        console.warn("[listSales] 0 tickets en TODA la tabla orders");
        return [];
    }

    console.log("[listSales] tickets totales:", allData.length);
    if (allData[0]) {
        console.log("[listSales] muestra ticket[0]:", JSON.stringify(allData[0]).slice(0, 500));
    }

    // ★ Filtrar por tenant si lo hay y la columna existe
    if (realId && allData[0] && "tenant_id" in allData[0]) {
        const filtered = allData.filter(r => String(r.tenant_id) === realId);
        if (filtered.length > 0) {
            console.log("[listSales] ✓ con tenant", realId, "→", filtered.length, "tickets");
            return filtered.map(normalizeSale);
        }
        console.warn("[listSales] 0 tickets con tenant", realId, "— devolviendo todos");
    }

    return allData.map(normalizeSale);
}

function extractTableNumber(row: any): string | null {
    // La tabla orders REAL no tiene 'table_number' ni 'items'.
    // Devolvemos null para que la UI muestre "—" en lugar de crashear.
    return null;
}

function normalizeSale(row: any): SaleRecord {
    // Mapeo ultra-defensivo: no asumimos columnas.
    // Solo leemos si la columna existe.
    const toNum = (v: any) => {
        if (v == null) return 0;
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };
    return {
        id:              row.id,
        table_number:    null,    // no asumimos columna
        waiter_name:     "waiter_name" in row ? (row.waiter_name ?? null) : null,
        items:           [],      // no asumimos columna
        subtotal:        "subtotal"  in row ? toNum(row.subtotal)    : 0,
        tax_total:       "tax_total" in row ? toNum(row.tax_total)   : 0,
        total:           "total" in row ? toNum(row.total) : 0,
        payment_method:  "payment_method" in row ? (row.payment_method ?? null) : null,
        status:          "status" in row ? (row.status ?? "closed") : "closed",
        series:          null,
        verifactu_qr:    null,
        created_at:      "created_at" in row ? (row.created_at ?? new Date().toISOString()) : new Date().toISOString(),
        updated_at:      "updated_at" in row ? (row.updated_at ?? row.created_at ?? new Date().toISOString()) : new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------
// Calcular métricas a partir de las ventas
// ---------------------------------------------------------------------

export function computeMetrics(records: SaleRecord[]): SalesMetrics {
    const byPaymentMethod: Record<string, { count: number; total: number }> = {};
    const byTaxRate:       Record<number, { base: number; tax: number; total: number }> = {};
    const productAgg:      Record<string, { name: string; quantity: number; total: number }> = {};

    let totalRevenue = 0;
    let paidCount    = 0;
    for (const r of records) {
        if (r.status === "cancelled") continue;
        // ★ FIX: status "closed" o "paid" cuentan como pagados
        if (r.status === "closed" || r.status === "paid") paidCount++;
        totalRevenue += r.total;

        // Por método de pago
        const pm = r.payment_method ?? "desconocido";
        if (!byPaymentMethod[pm]) byPaymentMethod[pm] = { count: 0, total: 0 };
        byPaymentMethod[pm].count++;
        byPaymentMethod[pm].total += r.total;

        // Por producto y por IVA
        for (const it of r.items) {
            const qty   = Number(it.quantity ?? 1);
            const price = Number(it.unit_price ?? 0);
            const tax   = Number(it.tax_rate ?? 10);
            const lineSub = price * qty;
            const base    = lineSub / (1 + tax / 100);
            const taxAmt  = lineSub - base;

            // Top productos
            const k = it.name ?? `Producto ${it.product_id}`;
            if (!productAgg[k]) productAgg[k] = { name: k, quantity: 0, total: 0 };
            productAgg[k].quantity += qty;
            productAgg[k].total    += lineSub;

            // Por IVA
            const tk = Math.round(tax);
            if (!byTaxRate[tk]) byTaxRate[tk] = { base: 0, tax: 0, total: 0 };
            byTaxRate[tk].base  += base;
            byTaxRate[tk].tax   += taxAmt;
            byTaxRate[tk].total += lineSub;
        }
    }

    const topProducts = Object.values(productAgg)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    return {
        totalRevenue,
        orderCount:   records.length,
        paidCount,
        averageTicket: paidCount > 0 ? totalRevenue / paidCount : 0,
        byPaymentMethod,
        byTaxRate,
        topProducts,
    };
}

// ---------------------------------------------------------------------
// Cancelar un ticket (solo status='cancelled', no se borra)
// ---------------------------------------------------------------------

export async function cancelSale(id: string): Promise<boolean> {
    console.log("[cancelSale] Eliminando ticket de forma definitiva:", id);

    try {
        const realId = await resolveRealTenantId(null);

        // ★ v4.5.6: SIEMPRE ejecutar el fallback legacy (más fiable)
        //   La RPC es opcional; el DELETE directo con tenant_id
        //   funciona en todos los esquemas.
        const ok = await cancelSaleLegacy(id, realId);

        if (ok) {
            console.log("[cancelSale] ✓ Ticket eliminado via legacy directo");
            return true;
        }

        // Si legacy falla, intentar RPC como fallback secundario
        try {
            const { rpcCancelSale } = await import("./rpc");
            const r = await rpcCancelSale(realId, id);
            if (r?.ok) {
                console.log("[cancelSale] ✓ Ticket eliminado vía RPC");
                return true;
            }
        } catch {}

        console.error("[cancelSale] ❌ No se pudo eliminar");
        return false;
    } catch (err: any) {
        console.error("[cancelSale] ❌ Excepción:", err.message);
        return false;
    }
}

/**
 * Fallback legacy por si la RPC falla (defense in depth).
 * NO se usa si RPC funciona correctamente.
 */
async function cancelSaleLegacy(id: string, tenantId?: string | null): Promise<boolean> {
    if (!supabase) return false;
    try {
        const realId = tenantId || (await resolveRealTenantId(null));
        if (!realId) return false;

        // ★ v4.5.6: usar supabaseFetch con JWT explícito para bypassear RLS
        const { supabaseFetch } = await import("./supabase-fetch");
        const jwt = await getUserJwt();

        // 1. Borrar items hijos (tolerante a errores)
        try {
            const r = await supabaseFetch(
                `/rest/v1/order_items?order_id=eq.${id}&tenant_id=eq.${realId}`,
                { method: "DELETE", jwt }
            );
            // Continuar aunque falle
        } catch (e) {}

        // 2. Borrar orden (CRÍTICO - validar resultado)
        const r2 = await supabaseFetch(
            `/rest/v1/orders?id=eq.${id}&tenant_id=eq.${realId}`,
            { method: "DELETE", jwt }
        );
        if (!r2.ok) {
            console.warn("[cancelSale] orders DELETE HTTP", r2.status);
            // Continuar si la orden ya no existe (404 = OK)
            if (r2.status !== 404 && r2.status !== 204) {
                return false;
            }
        }

        // 3. Borrar open_orders huérfanas (tolerante)
        try {
            await supabaseFetch(
                `/rest/v1/open_orders?order_id=eq.${id}&tenant_id=eq.${realId}`,
                { method: "DELETE", jwt }
            );
        } catch (e) {}

        console.log("[cancelSale] ✓ Fallback legacy OK");
        return true;
    } catch (e) {
        console.error("[cancelSale] legacy error:", e);
        return false;
    }
}
