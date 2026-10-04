// =====================================================================
// MOZONA TPV — dateRanges: presets con rangos ESTRICTOS local-time
// =====================================================================
// CRÍTICO: cada preset define inicio 00:00:00.000 LOCAL y
// fin 23:59:59.999 LOCAL, sin desfase UTC.
// =====================================================================

export type DateRangePreset =
    | "today" | "yesterday" | "week" | "month"
    | "lastMonth" | "30d" | "all" | "custom";

export interface DateRange {
    start: Date;  // 00:00:00.000 LOCAL
    end:   Date;  // 23:59:59.999 LOCAL
}

// ---------------------------------------------------------------------
// Helpers LOCAL-TIME (no UTC)
// ---------------------------------------------------------------------

/** Inicio del día a las 00:00:00.000 hora LOCAL */
export function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Fin del día a las 23:59:59.999 hora LOCAL */
export function endOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Lunes de la semana actual a las 00:00 LOCAL */
export function startOfWeek(d: Date): Date {
    const r = startOfDay(d);
    const day = (r.getDay() + 6) % 7; // lunes=0, domingo=6
    r.setDate(r.getDate() - day);
    return r;
}

/** Primer día del mes a las 00:00 LOCAL */
export function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/** Último día del mes a las 23:59:59.999 LOCAL */
export function endOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

// ---------------------------------------------------------------------
// ★★★ FUNCIÓN PRINCIPAL: rangos estrictos LOCAL-TIME ★★★
// ---------------------------------------------------------------------

export function getPresetDateRange(preset: DateRangePreset | string): DateRange {
    const now = new Date();

    switch (preset) {
        case "today":
        case "hoy":
            return { start: startOfDay(now), end: endOfDay(now) };

        case "yesterday":
        case "ayer": {
            const y = addDays(now, -1);
            return { start: startOfDay(y), end: endOfDay(y) };
        }

        case "week":
        case "this_week":
        case "esta_semana":
            return { start: startOfWeek(now), end: endOfDay(now) };

        case "month":
        case "this_month":
        case "este_mes":
            return { start: startOfMonth(now), end: endOfDay(now) };

        case "lastMonth":
        case "last_month":
        case "mes_anterior": {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { start: startOfMonth(lm), end: endOfMonth(lm) };
        }

        case "30d": {
            const past = addDays(now, -30);
            return { start: startOfDay(past), end: endOfDay(now) };
        }

        case "all":
            return { start: new Date(2000, 0, 1, 0, 0, 0, 0), end: endOfDay(now) };

        case "custom":
        default:
            return { start: startOfDay(now), end: endOfDay(now) };
    }
}

/** Alias para mantener compatibilidad con código anterior */
export const rangeForPreset = getPresetDateRange;

/** Convierte Date → ISO string preservando la hora local */
export function toLocalISO(d: Date): string {
    return d.toISOString();
}
