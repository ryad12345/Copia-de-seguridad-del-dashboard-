// =====================================================================
// MOZONA TPV — cashRegister: cierre de caja y arqueo
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";

export interface CashClosure {
    id?:                string;
    tenant_id:          string;
    closed_by:          string;
    closed_at:          string;
    period_start:       string;
    period_end:         string;
    ticket_count:       number;
    total_revenue:      number;
    total_tax:          number;
    total_subtotal:     number;
    by_payment:         Record<string, { count: number; total: number }>;
    cancelled_count:    number;
    cancelled_total:    number;
    // ★ Control de descuadre (inputs del cajero al cerrar)
    initial_cash:       number;   // Fondo inicial de caja
    counted_cash:       number;   // Recuento real en efectivo
    expected_cash:      number;   // initial + ventas_efectivo
    cash_difference:    number;   // counted - expected (+ sobra, - falta)
    notes?:             string | null;
}

export interface CashSummary {
    ticketCount:      number;
    totalRevenue:     number;
    totalSubtotal:    number;
    totalTax:         number;
    byPayment:        Record<string, { count: number; total: number }>;
    cancelledCount:   number;
    cancelledTotal:   number;
    periodStart:      string;
    periodEnd:        string;
}

/** Resumen de ventas del periodo (default: día actual) */
export async function getDailySummary(
    tenantId: string | null,
    periodStart?: string,
    periodEnd?: string,
): Promise<CashSummary> {
    if (!supabase) {
        return emptySummary(periodStart, periodEnd);
    }
    const start = periodStart ?? startOfDay();
    const end   = periodEnd   ?? endOfDay();
    const realId = await resolveRealTenantId(tenantId);

    // 1) Query con columnas mínimas
    let query = supabase
        .from("orders")
        .select("id, total, status, created_at")
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false });
    if (realId) query = query.eq("tenant_id", realId);

    const { data, error } = await query;
    if (error) {
        console.warn("[getDailySummary] error:", error.message);
        return emptySummary(start, end);
    }

    const rows = (data ?? []).map((r: any) => ({
        id:     r.id,
        total:  Number(r.total ?? 0),
        status: String(r.status ?? "closed"),
        pm:     "cash" as string, // La tabla real no tiene payment_method
    }));

    // Filtrar cancelados
    const active = rows.filter(r => r.status !== "cancelled");
    const cancelled = rows.filter(r => r.status === "cancelled");

    const byPayment: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;
    for (const r of active) {
        totalRevenue += r.total;
        const k = r.pm;
        if (!byPayment[k]) byPayment[k] = { count: 0, total: 0 };
        byPayment[k].count++;
        byPayment[k].total += r.total;
    }

    // Asumimos IVA 10% (hostelería ES). El usuario puede ajustar.
    const totalTax     = +(totalRevenue * (10 / 110)).toFixed(2);
    const totalSub     = +(totalRevenue - totalTax).toFixed(2);

    return {
        ticketCount:    active.length,
        totalRevenue:   +totalRevenue.toFixed(2),
        totalSubtotal:  totalSub,
        totalTax:       totalTax,
        byPayment,
        cancelledCount: cancelled.length,
        cancelledTotal: +cancelled.reduce((s, r) => s + r.total, 0).toFixed(2),
        periodStart:    start,
        periodEnd:      end,
    };
}

function emptySummary(start?: string, end?: string): CashSummary {
    return {
        ticketCount:   0,
        totalRevenue:  0,
        totalSubtotal: 0,
        totalTax:      0,
        byPayment:     {},
        cancelledCount: 0,
        cancelledTotal: 0,
        periodStart:   start ?? startOfDay(),
        periodEnd:     end ?? endOfDay(),
    };
}

function startOfDay(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}
function endOfDay(): string {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
}

/**
 * Persiste el cierre en la tabla `cash_closures` (o `closures`).
 * Si la tabla no existe, devuelve { ok: true, local: true } y
 * solo guarda en localStorage.
 */
export interface SaveCashClosureInput {
    summary:        CashSummary;
    closedBy:       string;
    notes?:         string;
    initialCash:    number;   // ★ Fondo inicial
    countedCash:    number;   // ★ Recuento real
}

export async function saveCashClosure(
    input: SaveCashClosureInput,
): Promise<{ ok: boolean; id?: string; error?: string; diff?: number }> {
    const { summary, closedBy, notes, initialCash, countedCash } = input;
    const tenantId = await resolveRealTenantId(null);
    // ★ Calcular diferencia (sobra / falta)
    const cashSales = summary.byPayment["cash"]?.total ?? 0;
    const expectedCash = +(initialCash + cashSales).toFixed(2);
    const diff = +(countedCash - expectedCash).toFixed(2);

    if (!supabase || !tenantId) {
        // Fallback a localStorage
        saveLocalClosure({ ...input, expectedCash, diff });
        return { ok: true, id: "local", diff };
    }
    const closure: CashClosure = {
        tenant_id:         tenantId,
        closed_by:         closedBy,
        closed_at:         new Date().toISOString(),
        period_start:      summary.periodStart,
        period_end:        summary.periodEnd,
        ticket_count:      summary.ticketCount,
        total_revenue:     summary.totalRevenue,
        total_tax:         summary.totalTax,
        total_subtotal:    summary.totalSubtotal,
        by_payment:        summary.byPayment,
        cancelled_count:   summary.cancelledCount,
        cancelled_total:   summary.cancelledTotal,
        initial_cash:      initialCash,
        counted_cash:      countedCash,
        expected_cash:     expectedCash,
        cash_difference:   diff,
        notes:             notes ?? null,
    };
    try {
        const { data, error } = await supabase
            .from("cash_closures")
            .insert([closure])
            .select()
            .single();
        if (error) {
            console.warn("[saveCashClosure] BD error:", error.message);
            saveLocalClosure({ ...input, expectedCash, diff });
            return { ok: true, id: "local", diff };
        }
        return { ok: true, id: (data as any)?.id ?? "local", diff };
    } catch (e) {
        console.warn("[saveCashClosure] exception:", e);
        saveLocalClosure({ ...input, expectedCash, diff });
        return { ok: true, id: "local", diff };
    }
}

function saveLocalClosure(input: SaveCashClosureInput & { expectedCash: number; diff: number }) {
    if (typeof localStorage === "undefined") return;
    try {
        const local = JSON.parse(localStorage.getItem("mozona.cash_closures") ?? "[]");
        local.push({
            ...input.summary,
            closedBy: input.closedBy,
            notes:    input.notes,
            initial_cash:   input.initialCash,
            counted_cash:   input.countedCash,
            expected_cash:  input.expectedCash,
            cash_difference: input.diff,
            savedAt: new Date().toISOString(),
        });
        localStorage.setItem("mozona.cash_closures", JSON.stringify(local.slice(-50)));
    } catch (e) {
        console.warn("[saveLocalClosure] error:", e);
    }
}
