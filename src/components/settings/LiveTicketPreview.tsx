// =====================================================================
// MOZONA TPV — LiveTicketPreview
// =====================================================================
// Renderiza una vista previa fiel al papel térmico de 80mm. Se
// re-renderiza en tiempo real con cualquier cambio del formulario.
//
//   • Ancho:  280px (≈ 32 chars en font monospace 12px)
//   • Tipografía: ui-monospace / 'SF Mono' / Menlo
//   • Estilo: "papel recién impreso" (sombra sutil + dientes de corte)
// =====================================================================

import { useMemo } from "react";
import { fmtEUR, round2 } from "../../lib/format";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface RestaurantForm {
    /** Alias legacy para `business_name`. Se acepta cualquiera. */
    name?:               string;
    /** snake_case canónico (al cargar de tenants). */
    business_name?:      string;
    nif?:                string;
    cif_nif?:            string;
    address?:            string;
    phone?:              string;
    header_msg?:         string;
    header_text?:        string;
    footer_msg?:         string;
    footer_text?:        string;
    showTax?:            boolean;
    show_vat_breakdown?: boolean;
    fontSize?:           "small" | "normal" | "large";
    print_logo_on_ticket?: boolean;
    logo_url?:           string;
    default_series?:     string;
    ticket_paper_width?: number;
    [key: string]: any;
}

/**
 * Helper: devuelve el valor de un campo priorizando snake_case,
 * luego camelCase, luego legacy.
 */
function pick<T = string>(form: RestaurantForm, ...keys: string[]): T | undefined {
    for (const k of keys) {
        const v = (form as any)[k];
        if (v !== undefined && v !== null && v !== "") return v as T;
    }
    return undefined;
}

export interface LiveTicketPreviewProps {
    form:       RestaurantForm;
    /** QR generado por VeriFactu (URL). Si está vacío, muestra un placeholder. */
    qrPayload?: string;
    /** Forzar el botón "modo vista" sin la estructura de tarjeta */
    bare?: boolean;
}

// ---------------------------------------------------------------------
// Datos de muestra que aparecen en la pre-cuenta
// ---------------------------------------------------------------------

const SAMPLE_ITEMS: Array<{ name: string; qty: number; price: number; tax: number }> = [
    { name: "Paella Valenciana",  qty: 1, price: 14.50, tax: 10 },
    { name: "Cerveza Mahou",      qty: 2, price:  2.50, tax: 21 },
    { name: "Café Solo",          qty: 1, price:  1.50, tax: 10 },
];

// ★ v4.0.7-ticket: Soporte para 48mm, 58mm y 80mm con tamaños proporcionales
const PAPER_WIDTHS: Record<48 | 58 | 80, { px: number; chars: number }> = {
    48: { px: 168, chars: 22 },  // ≈ 22 chars en font monospace 11px
    58: { px: 200, chars: 28 },  // ≈ 28 chars
    80: { px: 280, chars: 32 },  // ≈ 32 chars (estándar ESC/POS 80mm font A)
};

function getPaperWidth(width: 48 | 58 | 80 | undefined): { px: number; chars: number } {
    const w = (width === 48 || width === 58 || width === 80) ? width : 48;
    return PAPER_WIDTHS[w];
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function LiveTicketPreview({ form, qrPayload, bare = false }: LiveTicketPreviewProps) {
    // ★ v4.0.7: Ancho dinámico según ticket_paper_width
    const paperConfig = getPaperWidth(form.ticket_paper_width as any);
    const PAPER_WIDTH = paperConfig.px;
    const CHARS_PER_LINE = paperConfig.chars;

    // Cálculos de la pre-cuenta -----------------------------------------
    const { taxByRate, total } = useMemo(() => {
        const byRate = new Map<number, { base: number; tax: number }>();
        let sub = 0;
        let taxSum = 0;
        for (const it of SAMPLE_ITEMS) {
            const lineSub = it.qty * it.price;
            const lineTax = lineSub * (it.tax / 100);
            sub += lineSub;
            taxSum += lineTax;
            const cur = byRate.get(it.tax) ?? { base: 0, tax: 0 };
            cur.base += lineSub; cur.tax += lineTax;
            byRate.set(it.tax, cur);
        }
        return {
            taxByRate: Array.from(byRate.entries())
                .sort((a, b) => b[0] - a[0])
                .map(([rate, v]) => ({ rate, base: round2(v.base), tax: round2(v.tax) })),
            total: round2(sub + taxSum),
        };
    }, []);

    const paper = (
        <div
            className={`
                ${bare ? "" : "bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4"}
                font-mono text-[11px] leading-snug text-slate-900
            `}
        >
            <div
                className={`
                    mx-auto bg-[#fafaf7] text-black
                    border border-slate-300
                    rounded-md
                    ${form.ticket_paper_width === 48 ? "px-2 py-2" : "px-4 py-3"}
                    shadow-inner
                    box-border
                `}
                style={{ width: PAPER_WIDTH, maxWidth: "100%" }}
            >
                {/* LOGO (opcional) ------------------------------------- */}
                {form.print_logo_on_ticket && form.logo_url && (
                    <div className="flex justify-center mb-2">
                        <img
                            src={form.logo_url}
                            alt="logo"
                            className="max-h-12 max-w-[120px] object-contain"
                            style={{ filter: "grayscale(1) contrast(1.2)" }}
                        />
                    </div>
                )}

                {/* Cabecera ------------------------------------------- */}
                <Center>{pick(form, "business_name", "name") || "RESTAURANT NAME"}</Center>
                <Center>{form.address || "Dirección del local"}</Center>
                {form.phone && <Center>Tel: {form.phone}</Center>}
                <Center>CIF/NIF: {pick(form, "cif_nif", "nif") || "—"}</Center>

                <Sep chars={CHARS_PER_LINE} />

                {/* Factura -------------------------------------------- */}
                <Row label="Factura:" chars={CHARS_PER_LINE} value={`${form.default_series}-000001`} />
                <Row label="Fecha:" chars={CHARS_PER_LINE}   value="26/08/2026 14:32" />
                <Row label="Pago:" chars={CHARS_PER_LINE}    value="TARJETA" />

                <Sep dash chars={CHARS_PER_LINE} />

                {/* Líneas --------------------------------------------- */}
                {SAMPLE_ITEMS.map((it, i) => (
                    <div key={i} className="mb-1">
                        <div>{it.name}</div>
                        <div className="flex justify-between text-[10px] text-slate-700">
                            <span>  {it.qty} x {fmtEUR(it.price).replace(" €", "")}</span>
                            <span>{fmtEUR(it.qty * it.price)}</span>
                        </div>
                    </div>
                ))}

                <Sep dash chars={CHARS_PER_LINE} />

                {/* Desglose IVA --------------------------------------- */}
                {taxByRate.map(({ rate, base }) => (
                    <div key={rate} className="flex justify-between text-[10px]">
                        <span>Subtotal {rate}%</span>
                        <span>{fmtEUR(base)}</span>
                    </div>
                ))}
                {taxByRate.map(({ rate, tax: taxValue }) => (
                    <div key={`t-${rate}`} className="flex justify-between text-[10px]">
                        <span>IVA {rate}%</span>
                        <span>{fmtEUR(taxValue)}</span>
                    </div>
                ))}

                <Sep chars={CHARS_PER_LINE} />

                {/* TOTAL ----------------------------------------------- */}
                <div className="flex justify-between font-black text-[13px]">
                    <span>TOTAL</span>
                    <span>{fmtEUR(total)}</span>
                </div>

                <Sep chars={CHARS_PER_LINE} />

                {/* QR ------------------------------------------------- */}
                <div className="flex justify-center my-2">
                    <QrPlaceholder payload={qrPayload ?? buildSampleQrPayload(form)} size={92} />
                </div>
                <Center className="text-[8.5px] mt-1">
                    {qrPayload ? "VeriFactu AEAT" : "QR VeriFactu (preview)"}
                </Center>

                <Sep dash chars={CHARS_PER_LINE} />

                {/* Footer --------------------------------------------- */}
                <Center className="mt-1 whitespace-pre-wrap text-[10px]">
                    {pick(form, "ticket_footer_msg", "footer_msg", "footer_text") || "¡Gracias por su visita!"}
                </Center>
            </div>

            {/* Dientes de corte --------------------------------------- */}
            <div className="mt-2 flex justify-center gap-[3px] opacity-60">
                {Array.from({ length: form.ticket_paper_width === 48 ? 14 : form.ticket_paper_width === 58 ? 18 : 24 }).map((_, i) => (
                    <span key={i} className="w-[6px] h-[3px] rounded-sm bg-slate-300" />
                ))}
            </div>
            <div className="text-center text-[10px] text-slate-400 mt-1 font-sans">
                Vista previa {form.ticket_paper_width || 48}mm
            </div>
        </div>
    );

    if (bare) return paper;

    return (
        <div className="lg:sticky lg:top-20">
            <h2 className="text-[11px] font-bold tracking-[0.15em] text-slate-500 uppercase mb-2">
                Vista previa del ticket
            </h2>
            {paper}
        </div>
    );
}

// ---------------------------------------------------------------------
// Sub-componentes de impresión
// ---------------------------------------------------------------------

function Center({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return <div className={`text-center ${className}`}>{children}</div>;
}

function Sep({ dash = false, chars = 32 }: { dash?: boolean; chars?: number }) {
    return <div className="my-1 text-slate-500">{dash ? "-".repeat(chars) : "=".repeat(chars)}</div>;
}

function Row({ label, value, chars = 32 }: { label: string; value: string; chars?: number }) {
    const pad = Math.max(1, chars - label.length - value.length);
    return (
        <div className="flex justify-between">
            <span>{label}</span>
            <span>{" ".repeat(pad)}{value}</span>
        </div>
    );
}

// ---------------------------------------------------------------------
// QR placeholder: genera un patrón pseudo-aleatorio a partir del hash
// del payload, con las tres "esquinas" de un QR real para que se
// reconozca visualmente como tal.
// ---------------------------------------------------------------------

function QrPlaceholder({ payload, size }: { payload: string; size: number }) {
    const grid = useMemo(() => {
        const N = 25;
        const g: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
        // Hash determinista
        let h = 0;
        for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
        // Patrón pseudo-aleatorio
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                h = (h * 1103515245 + 12345) | 0;
                g[y][x] = (h >>> 8) % 7 < 3;
            }
        }
        // Marcar las 3 esquinas con cuadrados (fiducial markers)
        const drawFinder = (cx: number, cy: number) => {
            for (let y = 0; y < 7; y++) {
                for (let x = 0; x < 7; x++) {
                    const onBorder = (x === 0 || x === 6 || y === 0 || y === 6);
                    const inner    = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
                    g[cy + y][cx + x] = onBorder || inner;
                }
            }
        };
        drawFinder(0, 0);
        drawFinder(N - 7, 0);
        drawFinder(0, N - 7);
        return g;
    }, [payload]);

    const cell = size / 25;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="bg-white">
            <rect width={size} height={size} fill="white" />
            {grid.map((row, y) =>
                row.map((on, x) =>
                    on ? (
                        <rect
                            key={`${x}-${y}`}
                            x={x * cell}
                            y={y * cell}
                            width={cell}
                            height={cell}
                            fill="black"
                        />
                    ) : null
                )
            )}
        </svg>
    );
}

function buildSampleQrPayload(form: RestaurantForm): string {
    return `https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/es.aeat.ticket.api.TicketAPI?nif=${pick(form, "cif_nif", "nif") || "B00000000"}&numserie=${form.default_series}00000001&fecha=26-08-2026&importe=34.50`;
}
