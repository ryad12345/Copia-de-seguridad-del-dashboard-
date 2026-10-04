// =====================================================================
// MOZONA TPV — ticketPrinter: impresión de tickets 58mm / 80mm (v3.2.0)
// =====================================================================
// REESCRITO: usa texto monospace plano (sin tablas HTML) para máxima
// compatibilidad con impresoras térmicas.
//
// CHARS_PER_LINE:
//   - 58mm Font A: 32 chars
//   - 80mm Font A: 42 chars
//
// Estructura del ticket:
//   1. Cabecera (nombre empresa, NIF, dirección, teléfono)
//   2. Datos del ticket (serie, fecha/hora, mesa, camarero, pago)
//   3. Líneas de productos
//   4. Desglose IVA + Total
//   5. Pie (footer, brand)
// =====================================================================

import { loadTicketSettings, type TicketSettings, companyFromSettingsWithLocal } from "./ticketSettings";
import { escapeHtml } from "./htmlEscape";

export interface TicketLine {
    name: string;
    quantity: number;
    unit_price: number;
    tax_rate?: number;
}

export interface TicketOptions {
    lines: TicketLine[];
    series: string;             // e.g. "PRE" o "T-F"
    invoiceNumber: number;      // número secuencial
    tableNumber?: number | null;
    waiterName?: string | null;
    paymentMethod?: string;     // "Efectivo", "Tarjeta", etc.
    createdAt: number;          // timestamp ms
    orderId?: string;
    showTax?: boolean;          // mostrar desglose IVA
    headerMsg?: string;
    footerMsg?: string;
    settings?: TicketSettings | null;
    paperWidth?: 48 | 58 | 80;       // ancho del rollo (v4.0.7: 48mm añadido)
}

const DEFAULT_COMPANY = {
    name: "MOZONA TPV",
    nif: "",
    address: "",
    phone: "",
};

const FONT_STACK = `'Courier New', Courier, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

// ★ v3.2.0: CHARS_PER_LINE según ancho del rollo
//  - 58mm Font A: 32 chars
//  - 48mm Font A: 24 chars
//  - 58mm Font A: 32 chars
//  - 80mm Font A: 42 chars
const CHARS_BY_WIDTH: Record<number, number> = {
    48: 24,
    58: 32,
    80: 42,
};
const DEFAULT_CHARS = 32;

// ════════════════════════════════════════════════════════════════
// ★ HELPERS DE FORMATO (texto plano, monospace)
// ════════════════════════════════════════════════════════════════

/** Limpia caracteres que no se imprimen bien en tickets térmicos */
function cleanText(s: any): string {
    if (s == null) return "";
    return String(s)
        .replace(/[áàäâ]/gi, "a")
        .replace(/[éèëê]/gi, "e")
        .replace(/[íìïî]/gi, "i")
        .replace(/[óòöô]/gi, "o")
        .replace(/[úùüû]/gi, "u")
        .replace(/[ñ]/gi, "n")
        .replace(/[ç]/gi, "c")
        .replace(/[ÁÀÄÂ]/g, "A")
        .replace(/[ÉÈËÊ]/g, "E")
        .replace(/[ÍÌÏÎ]/g, "I")
        .replace(/[ÓÒÖÔ]/g, "O")
        .replace(/[ÚÙÜÛ]/g, "U")
        .replace(/[Ñ]/g, "N")
        .replace(/[Ç]/g, "C")
        .replace(/[°ºª]/g, ".")
        .replace(/[€]/g, "EUR")
        .replace(/[—–-]/g, "-")
        .replace(/[''´`]/g, "'")
        .replace(/[""]/g, '"')
        .replace(/[^\x20-\x7E]/g, "") // quitar chars no-ASCII
        .trim();
}

/** Padding derecho a N chars (trunca si excede) */
function padRight(s: string, n: number): string {
    s = cleanText(s);
    if (s.length >= n) return s.slice(0, n);
    return s + " ".repeat(n - s.length);
}

/** Padding izquierdo a N chars */
function padLeft(s: string, n: number): string {
    s = cleanText(s);
    if (s.length >= n) return s.slice(0, n);
    return " ".repeat(n - s.length) + s;
}

/** Línea con label a la izquierda y valor a la derecha */
function fmtLine(left: string, right: string, width: number): string {
    left = cleanText(left);
    right = cleanText(right);
    if (left.length + right.length >= width) {
        // Si no caben juntos, poner en 2 líneas
        if (left.length >= width) left = left.slice(0, width);
        if (right.length >= width) right = right.slice(0, width);
        return padRight(left, width) + "\n" + padLeft(right, width);
    }
    return padRight(left, width - right.length) + right;
}

/** Línea centrada */
function center(s: string, width: number): string {
    s = cleanText(s);
    if (s.length >= width) return s.slice(0, width);
    const pad = Math.floor((width - s.length) / 2);
    return " ".repeat(pad) + s;
}

/** Línea de separador */
function sep(width: number, char = "-"): string {
    return char.repeat(width);
}

/** Corta string a width SIN word break, añade "..." si lo corta */
function truncStr(s: string, n: number): string {
    s = cleanText(s);
    if (s.length <= n) return s;
    if (n <= 1) return s.slice(0, n);
    return s.slice(0, n - 1) + ".";
}

/** Wrap multi-línea ROBUSTO: corta por palabras y, si una palabra es
 *  más larga que el ancho, la divide con guion. Garantiza que ninguna
 *  línea exceda `width` caracteres. */
function wrap(s: string, width: number): string[] {
    s = cleanText(s);
    if (!s) return [""];
    if (width <= 0) return [s];
    if (s.length <= width) return [s];
    const out: string[] = [];
    let remaining = s;
    while (remaining.length > width) {
        // buscar último espacio dentro del rango permitido
        let cut = remaining.lastIndexOf(" ", width);
        if (cut <= 0) {
            // No hay espacio: buscar último espacio DESPUÉS para no cortar palabras
            const after = remaining.indexOf(" ", width);
            if (after > 0) {
                cut = after;
            } else {
                // Ni antes ni después: palabra más larga que width → cortar con guion
                cut = width - 1;
                out.push(remaining.slice(0, cut) + "-");
                remaining = remaining.slice(cut);
                continue;
            }
        }
        out.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut + 1); // +1 para saltar el espacio
    }
    if (remaining) out.push(remaining);
    return out;
}

/** Wrap específico para texto legal: prioriza mantener palabras enteras,
 *  añade elipsis si el texto es demasiado largo para caber en W líneas. */
function wrapLegal(text: string, width: number, maxLines: number = 3): string[] {
    text = cleanText(text);
    if (!text) return [""];
    // Si cabe en una línea, perfecto
    if (text.length <= width) return [text];

    const lines = wrap(text, width);
    if (lines.length <= maxLines) return lines;

    // Demasiadas líneas: truncar y añadir elipsis
    const truncated = lines.slice(0, maxLines);
    const last = truncated[truncated.length - 1];
    truncated[truncated.length - 1] = last.slice(0, Math.max(0, width - 1)) + ".";
    return truncated;
}

/** Formato EUR sin símbolo (las impresoras a veces no lo tienen) */
function fmtEUR(n: number): string {
    const v = Number(n) || 0;
    return v.toFixed(2).replace(".", ",") + " EUR";
}

/** Formato fecha/hora */
function fmtDateTime(ts: number): { date: string; time: string } {
    try {
        const d = new Date(ts);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yy = String(d.getFullYear()).slice(-2); // YY en lugar de YYYY (2 chars)
        const hh = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");
        return { date: `${dd}/${mm}/${yy}`, time: `${hh}:${mi}` };
    } catch (_) {
        return { date: "--/--/--", time: "--:--" };
    }
}

/** Resumen de IVA por tasa */
function summarizeVat(lines: TicketLine[]): { rate: number; base: number; tax: number }[] {
    const map = new Map<number, { base: number; tax: number }>();
    for (const l of lines) {
        const rate = Number(l.tax_rate ?? 10);
        const qty = Number(l.quantity || 0);
        const price = Number(l.unit_price || 0);
        const lineSub = qty * price; // base imponible
        const tax = lineSub * rate / 100;
        const cur = map.get(rate) || { base: 0, tax: 0 };
        cur.base += lineSub;
        cur.tax += tax;
        map.set(rate, cur);
    }
    return Array.from(map.entries())
        .map(([rate, v]) => ({ rate, base: v.base, tax: v.tax }))
        .sort((a, b) => a.rate - b.rate);
}

// ════════════════════════════════════════════════════════════════
// ★ FUNCIÓN PRINCIPAL: construir el ticket (texto plano)
// ════════════════════════════════════════════════════════════════

export function buildTicketText(opts: TicketOptions): string {
    const W = CHARS_BY_WIDTH[opts.paperWidth || 58] || DEFAULT_CHARS;
    const settings = opts.settings;
    // ★ v4.5.6: leer company desde settings directamente (NO pasar como tenantId)
    const company = settings
        ? {
            name: settings.business_name || DEFAULT_COMPANY.name,
            nif: settings.cif_nif || settings.nif || "",
            address: settings.address || "",
            phone: settings.phone || "",
            contact_email: settings.contact_email || "",
        }
        : { name: DEFAULT_COMPANY.name, nif: "", address: "", phone: "", contact_email: "" };

    const { date, time } = fmtDateTime(opts.createdAt);
    const vatSummary = summarizeVat(opts.lines);

    let subtotal = 0;
    let totalTax = 0;
    for (const l of opts.lines) {
        const sub = Number(l.unit_price || 0) * Number(l.quantity || 0);
        const rate = Number(l.tax_rate ?? 10);
        subtotal += sub;
        totalTax += sub * rate / 100;
    }
    const total = subtotal + totalTax;

    const lines: string[] = [];

    // 1. CABECERA - Nombre del negocio
    // ★ v4.5.9: prioridad headerMsg > business_name
    //   Si está vacío, mostrar (vacío) para que se vea el error, no un default confuso
    const nameToShow = (opts.headerMsg && opts.headerMsg.trim())
        || company.name
        || "";
    if (nameToShow) {
        lines.push(center(nameToShow.toUpperCase(), W));
    } else {
        lines.push(center("(sin nombre de empresa)", W));
    }

    // ★ v4.5.8: header_text personalizado (mensaje bienvenida) si existe
    if (settings?.ticket_header_msg && settings.ticket_header_msg.trim()
        && settings.ticket_header_msg !== nameToShow) {
        for (const ln of wrap(settings.ticket_header_msg.trim(), W)) {
            lines.push(center(ln, W));
        }
    }
    lines.push(center(sep(W, "="), W));

    // 2. NIF, dirección, teléfono
    if (company.nif) {
        lines.push(center("NIF: " + truncStr(company.nif, W - 5), W));
    }
    if (company.address) {
        for (const ln of wrap(company.address, W)) {
            lines.push(center(ln, W));
        }
    }
    if (company.phone) {
        lines.push(center("Tel: " + truncStr(company.phone, W - 5), W));
    }
    if (company.contact_email) {
        lines.push(center(truncStr(company.contact_email, W), W));
    }
    lines.push(sep(W));

    // 3. Datos del ticket
    const ticketNum = truncStr(`${opts.series}-${String(opts.invoiceNumber).padStart(6, "0")}`, W - 8);
    lines.push(fmtLine("Ticket:", ticketNum, W));
    lines.push(fmtLine("Fecha:", `${date} ${time}`, W));
    // ★ v4.5.8: SIEMPRE mostrar mesa si está presente
    if (opts.tableNumber != null && opts.tableNumber !== 0) {
        lines.push(fmtLine("Mesa:", String(opts.tableNumber), W));
    }
    if (opts.waiterName) {
        lines.push(fmtLine("Camarero:", truncStr(opts.waiterName, 16), W));
    }
    if (opts.paymentMethod) {
        lines.push(fmtLine("Pago:", truncStr(opts.paymentMethod, 20), W));
    }
    lines.push(sep(W));

    // 4. PRODUCTOS
    for (const l of opts.lines) {
        const qty = Number(l.quantity || 0);
        const price = Number(l.unit_price || 0);
        const sub = qty * price;
        if (qty <= 0) continue;
        const qtyStr = qty === Math.floor(qty) ? String(Math.floor(qty)) : qty.toFixed(2);
        // Wrap nombre del producto
        const nameLines = wrap(l.name || "—", W);
        // Primera línea: "Nx NOMBRE" + precio
        const firstLine = `${qtyStr} x ${nameLines[0] || ""}`;
        lines.push(fmtLine(firstLine, fmtEUR(sub), W));
        // Líneas siguientes: nombre continuación
        for (let i = 1; i < nameLines.length; i++) {
            lines.push(padRight(nameLines[i], W));
        }
    }
    lines.push(sep(W));

    // 5. IVA (si showTax)
    if (opts.showTax !== false) {
        for (const v of vatSummary) {
            const rateStr = v.rate % 1 === 0 ? `${v.rate}%` : `${v.rate.toFixed(2)}%`;
            const lab = `Base ${rateStr}:`;
            const val = fmtEUR(v.base);
            lines.push(fmtLine(lab, val, W));
            lines.push(fmtLine(`IVA ${rateStr}:`, fmtEUR(v.tax), W));
        }
    } else {
        lines.push(fmtLine("Subtotal:", fmtEUR(subtotal), W));
    }
    lines.push(sep(W, "="));
    lines.push(fmtLine("TOTAL (IVA incl.):", fmtEUR(total), W));
    lines.push(sep(W, "="));

    // 6. PIE - texto legal con wrap robusto
    // ★ v4.5.8: prioridad footer personalizado > default "Esta no es una factura definitiva"
    const finalFooter = opts.footerMsg || settings?.ticket_footer_msg || settings?.footer_text || "Esta no es una factura definitiva";
    if (finalFooter) {
        for (const ln of wrapLegal(finalFooter, W, 3)) {
            lines.push(center(ln, W));
        }
    }
    if (opts.orderId) {
        lines.push(center("ID: " + truncStr(opts.orderId, W - 4), W));
    }
    lines.push("");
    lines.push(center("Gracias por su visita!", W));
    lines.push(center("Software TPV: Mozona TPV", W));

    return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════
// ★ GENERACIÓN DE HTML PARA IMPRESIÓN
// ════════════════════════════════════════════════════════════════

export function buildTicketHTML(opts: TicketOptions): string {
    const W = CHARS_BY_WIDTH[opts.paperWidth || 58] || DEFAULT_CHARS;
    const body = buildTicketText(opts);

    // Convertir texto a HTML (cada línea en <div>)
    const htmlBody = body.split("\n").map(line => {
        // ★ Escapar TODO el texto (incluye datos de negocio/usuario: nombre,
        //   dirección, productos, camarero, footer, etc.) con el helper central
        //   que cubre & < > " '
        const safe = escapeHtml(line);
        return `<div class="line">${safe || "&nbsp;"}</div>`;
    }).join("\n");

    // ★ v3.4.6 + v4.0.7-print-dynamic: CSS optimizado para 48mm/58mm/80mm
    //   Ancho físico: 48/58/80mm, ancho efectivo (con margen para dientes) ligeramente menor
    const cssWidth = opts.paperWidth || 58;
    // 48mm físico → 44mm efectivo, 58mm físico → 48mm efectivo, 80mm físico → 72mm efectivo
    const effectiveWidth = cssWidth === 48 ? 44 : cssWidth === 58 ? 48 : 72;
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket - ${cssWidth}mm</title>
<style>
/* ★ v4.1.6-print-THERMAL: CSS ULTRA-ROBUSTO para impresoras térmicas */
/* Fuerza dimensiones exactas del rollo, sin margen del navegador */
@page {
    margin: 0 !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    padding: 0 !important;
    size: ${cssWidth}mm auto !important;
}
* {
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
}
html, body {
    margin: 0 !important;
    padding: 2mm !important;
    background: #fff !important;
    color: #000 !important;
    font-family: ${FONT_STACK} !important;
    font-size: 10px !important;
    font-weight: 800 !important;
    line-height: 1.2 !important;
    -webkit-font-smoothing: none !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    width: ${effectiveWidth}mm !important;
    max-width: ${effectiveWidth}mm !important;
    min-width: ${effectiveWidth}mm !important;
    overflow: hidden !important;
}
.ticket {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 100% !important;
    white-space: pre !important;
    font-variant-numeric: tabular-nums !important;
    letter-spacing: 0 !important;
}
.line {
    width: 100% !important;
    white-space: pre !important;
    overflow: hidden !important;
    text-overflow: clip !important;
    word-break: normal !important;
    hyphens: none !important;
    display: block !important;
}
/* ★ Header del ticket con datos REALES del tenant */
.ticket-header {
    text-align: center !important;
    font-weight: bold !important;
    margin-bottom: 2mm !important;
}
.ticket-header .business-name {
    font-size: 12px !important;
    font-weight: 900 !important;
    text-transform: uppercase !important;
    display: block !important;
    width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}
@media print {
    @page {
        size: ${cssWidth}mm auto !important;
        margin: 0 !important;
    }
    html, body {
        width: ${effectiveWidth}mm !important;
        max-width: ${effectiveWidth}mm !important;
        padding: 1mm !important;
        overflow: hidden !important;
    }
}
</style>
</head>
<body id="thermal-ticket-print">
<div class="ticket">
${htmlBody}
</div>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════
// ★ API PÚBLICA: imprimir
// ════════════════════════════════════════════════════════════════

export interface PrintResult {
    ok: boolean;
    method: "local" | "browser" | "none";
    preview: string;
    error?: string;
}

export function printTicket(opts: TicketOptions): PrintResult {
    const html = buildTicketHTML(opts);
    const text = buildTicketText(opts);

    // Estrategia 1: local printer (USB/Serial/Bluetooth)
    try {
        const w = window as any;
        if (w?.mozona?.printTicketLocal) {
            const r = w.mozona.printTicketLocal(html);
            if (r && r.ok) return { ok: true, method: "local", preview: text };
        }
    } catch (_) {}

    // Estrategia 2: window.open + window.print
    try {
        const w = window.open("", "_blank", "width=400,height=600");
        if (w) {
            // ★ Seguridad: cortar la referencia inversa para que el documento
            //   abierto no pueda navegar/controlar la ventana que lo abrió.
            //   (No se usa la feature "noopener" porque haría que window.open
            //   devolviese null y rompería el document.write de impresión.)
            try { (w as Window).opener = null; } catch (_) {}
            w.document.open();
            w.document.write(html);
            w.document.close();
            // Esperar a que cargue
            setTimeout(() => {
                try { w.focus(); w.print(); } catch (_) {}
            }, 200);
            return { ok: true, method: "browser", preview: text };
        }
    } catch (e) {
        return { ok: false, method: "none", preview: text, error: String(e) };
    }
    return { ok: false, method: "none", preview: text };
}

// ════════════════════════════════════════════════════════════════
// ★ PRINT FINAL TICKET — tras cobrar (factura definitiva, no pre-cuenta)
// ════════════════════════════════════════════════════════════════

export interface PrintFinalTicketOptions {
    tenantId?: string | null;
    tableNumber?: string | number | null;
    waiterName?: string | null;
    paymentMethod?: string;
    orderId?: string;
    invoiceNumber?: number;
    lines: Array<{
        name: string;
        quantity: number;
        unit_price: number;
        tax_rate?: number;
    }>;
    companyOverride?: any;
    createdAt?: number;
}

export async function printFinalTicket(input: PrintFinalTicketOptions): Promise<PrintResult> {
    try {
        const { loadCompany, loadTicketSettings } = await import("./ticketSettings");

        // Cargar de BD (igual que printPreBill)
        const company = await loadCompany(input.tenantId || null);
        const ticketCfg = loadTicketSettings();

        const dbSettings: TicketSettings = {
            tenant_id:         company.tenant_id || input.tenantId || "",
            business_name:     company.business_name || "",
            cif_nif:           company.cif_nif || "",
            nif:               company.cif_nif || "",
            address:           company.address || "",
            phone:             company.phone || "",
            contact_email:     company.contact_email || "",
            ticket_header_msg: company.ticket_header_msg || "",
            ticket_footer_msg: company.ticket_footer_msg || "",
            ticket_show_tax:   company.ticket_show_tax ?? true,
            paper_width_mm:    company.paper_width_mm || 80,
            header_text:       ticketCfg.header_text || ticketCfg.ticket_header_msg || "",
            footer_text:       ticketCfg.footer_text || ticketCfg.ticket_footer_msg || "",
            show_vat_breakdown: company.ticket_show_tax ?? true,
        };

        let settings: TicketSettings = dbSettings;
        if (input.companyOverride) {
            const ov = input.companyOverride;
            if (ov.business_name || ov.cif_nif || ov.address || ov.phone) {
                settings = {
                    ...dbSettings,
                    business_name:     ov.business_name || ov.name || dbSettings.business_name,
                    cif_nif:           ov.cif_nif || ov.nif || dbSettings.cif_nif,
                    nif:               ov.cif_nif || ov.nif || dbSettings.nif,
                    address:           ov.address || dbSettings.address,
                    phone:             ov.phone || dbSettings.phone,
                    contact_email:     ov.contact_email || dbSettings.contact_email,
                    ticket_header_msg: ov.ticket_header_msg || ov.header_text || dbSettings.ticket_header_msg,
                    ticket_footer_msg: ov.ticket_footer_msg || ov.footer_text || dbSettings.ticket_footer_msg,
                    paper_width_mm:    ov.paper_width_mm || dbSettings.paper_width_mm,
                };
            }
        }

        // Sincronizar con tenant desde BD
        if (input.tenantId) {
            try {
                const { fetchTenantFull } = await import("./bidirectionalSync");
                const tenant = await fetchTenantFull(input.tenantId);
                if (tenant) {
                    settings = {
                        ...settings,
                        tenant_id: tenant.id,
                        business_name: tenant.business_name || settings.business_name,
                        cif_nif: tenant.cif_nif || settings.cif_nif,
                        nif: tenant.cif_nif || settings.nif,
                        address: tenant.address || settings.address,
                        phone: tenant.phone || settings.phone,
                    };
                }
            } catch (e) {}
        }

        let paperWidth: 48 | 58 | 80 = (settings.paper_width_mm as 48 | 58 | 80) || 58;
        if (![48, 58, 80].includes(paperWidth)) paperWidth = 58;

        const opts: TicketOptions = {
            lines: input.lines.map(l => ({
                name: l.name,
                quantity: l.quantity,
                unit_price: l.unit_price,
                tax_rate: l.tax_rate,
            })),
            series: "T-F",  // ★ TICKET FINAL (no pre-cuenta)
            invoiceNumber: input.invoiceNumber ?? (Date.now() % 1000000),
            tableNumber: input.tableNumber != null ? Number(input.tableNumber) : null,
            waiterName: input.waiterName || null,
            paymentMethod: input.paymentMethod || "Efectivo",
            createdAt: input.createdAt ?? Date.now(),
            settings,
            showTax: true,
            paperWidth,
            orderId: input.orderId,
            headerMsg: settings.ticket_header_msg || settings.header_text || undefined,
            footerMsg: settings.ticket_footer_msg || settings.footer_text || "Gracias por su visita",
        };
        return printTicket(opts);
    } catch (e) {
        return { ok: false, method: "none", preview: "", error: String(e) };
    }
}

// ════════════════════════════════════════════════════════════════
// ★ PREVIEW EN PANTALLA
// ════════════════════════════════════════════════════════════════

export function getTicketPreview(opts: TicketOptions): string {
    return buildTicketText(opts);
}

// ════════════════════════════════════════════════════════════════
// ★ PRINTPREBILL: pre-cuenta desde el TPV
// ════════════════════════════════════════════════════════════════

export interface PrintPreBillOptions {
    tenantId?: string | null;
    tableNumber?: string | null;
    waiterName?: string | null;
    lines: Array<{
        name: string;
        quantity: number;
        unit_price: number;
        tax_rate?: number;
    }>;
    companyOverride?: any;
}

export async function printPreBill(input: PrintPreBillOptions): Promise<PrintResult> {
    try {
        const { loadCompany, loadTicketSettings } = await import("./ticketSettings");

        // ★ v4.5.9: SIEMPRE cargar de BD primero (fuente de verdad)
        //   Si companyOverride tiene datos, usar ESO directamente.
        const company = await loadCompany(input.tenantId || null);
        const ticketCfg = loadTicketSettings();

        const dbSettings: TicketSettings = {
            tenant_id:         company.tenant_id || input.tenantId || "",
            business_name:     company.business_name || "",
            cif_nif:           company.cif_nif || "",
            nif:               company.cif_nif || "",
            address:           company.address || "",
            phone:             company.phone || "",
            contact_email:     company.contact_email || "",
            ticket_header_msg: company.ticket_header_msg || "",
            ticket_footer_msg: company.ticket_footer_msg || "",
            ticket_show_tax:   company.ticket_show_tax ?? true,
            paper_width_mm:    company.paper_width_mm || 80,
            header_text:       ticketCfg.header_text || ticketCfg.ticket_header_msg || "",
            footer_text:       ticketCfg.footer_text || ticketCfg.ticket_footer_msg || "",
            show_vat_breakdown: company.ticket_show_tax ?? true,
        };

        // ★ v4.5.9: companyOverride PRIORIDAD ALTA — si tiene datos, usar esos
        //   Es lo que viene directo del TPV (restaurant object)
        let settings: TicketSettings = dbSettings;
        if (input.companyOverride) {
            const ov = input.companyOverride;
            // Si tiene cualquier dato, sobreescribe
            if (ov.business_name || ov.cif_nif || ov.address || ov.phone) {
                settings = {
                    ...dbSettings,
                    business_name:     ov.business_name || ov.name || dbSettings.business_name,
                    cif_nif:           ov.cif_nif || ov.nif || dbSettings.cif_nif,
                    nif:               ov.cif_nif || ov.nif || dbSettings.nif,
                    address:           ov.address || dbSettings.address,
                    phone:             ov.phone || dbSettings.phone,
                    contact_email:     ov.contact_email || dbSettings.contact_email,
                    ticket_header_msg: ov.ticket_header_msg || ov.header_text || dbSettings.ticket_header_msg,
                    ticket_footer_msg: ov.ticket_footer_msg || ov.footer_text || dbSettings.ticket_footer_msg,
                    paper_width_mm:    ov.paper_width_mm || dbSettings.paper_width_mm,
                };
            }
        }

        // ★ Si hay tenantId, sincronizar con datos reales del tenant via BD
        if (input.tenantId) {
            try {
                const { fetchTenantFull } = await import("./bidirectionalSync");
                const tenant = await fetchTenantFull(input.tenantId);
                if (tenant) {
                    settings = {
                        ...settings,
                        tenant_id: tenant.id,
                        business_name: tenant.business_name || settings.business_name,
                        cif_nif: tenant.cif_nif || settings.cif_nif,
                        nif: tenant.cif_nif || settings.nif,
                        address: tenant.address || settings.address,
                        phone: tenant.phone || settings.phone,
                    };
                }
            } catch (e) {
                console.warn("[printPreBill] tenant sync warn:", String(e));
            }
        }

        // ★ v4.0.7-print-dynamic: leer ancho desde cache local
        let paperWidth: 48 | 58 | 80 = (settings.paper_width_mm as 48 | 58 | 80) || 58;
        if (![48, 58, 80].includes(paperWidth)) paperWidth = 58;

        const opts: TicketOptions = {
            lines: input.lines.map(l => ({
                name: l.name,
                quantity: l.quantity,
                unit_price: l.unit_price,
                tax_rate: l.tax_rate,
            })),
            series: "PRE",
            invoiceNumber: Date.now() % 1000000,
            tableNumber: input.tableNumber ? Number(input.tableNumber) : null,
            waiterName: input.waiterName || null,
            paymentMethod: "Pendiente",
            createdAt: Date.now(),
            settings,
            showTax: true,
            paperWidth,
            headerMsg: settings.ticket_header_msg || settings.header_text || undefined,
            footerMsg: settings.ticket_footer_msg || settings.footer_text || "Esta no es una factura definitiva",
        };
        return printTicket(opts);
    } catch (e) {
        return { ok: false, method: "none", preview: "", error: String(e) };
    }
}
