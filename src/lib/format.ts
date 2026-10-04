// =====================================================================
// MOZONA TPV — Formateadores monetarios y de fecha (es-ES)
// =====================================================================

const EUR = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Formato moneda: 12,50 € */
export const fmtEUR = (n: number): string => EUR.format(n);

/** Formato sin símbolo: 12,50 */
export const fmtNum = (n: number): string => NUM.format(n);

/** Parsea un string "12,50" / "12.50" a número 12.5 */
export const parseAmount = (s: string): number => {
    const normalized = s.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
};

/** Formato fecha corta: 26 ago 2025, 14:32 */
export const fmtDateTime = (iso: string): string => {
    try {
        return new Date(iso).toLocaleString("es-ES", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    } catch {
        return iso;
    }
};

/** Suma cantidades (con redondeo a 2 decimales). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Trunca un número para mostrar como entero (cantidades). */
export const fmtInt = (n: number): string => Math.trunc(n).toString();
