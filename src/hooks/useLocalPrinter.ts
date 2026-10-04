// =====================================================================
// MOZONA TPV — useLocalPrinter: hook que reemplaza usePrinter cuando
// estamos en la app Tauri. Reutiliza el EscposBuilder del frontend
// (mismo TS que la versión cloud) y envía los bytes al backend Rust.
// =====================================================================

import { useCallback, useState } from "react";
import { EscposBuilder } from "../lib/escpos";
import { localApi } from "../lib/local-api";
import type { Invoice, IssueInvoiceResponse } from "../lib/local-api";

export interface UseLocalPrinterState {
    isConnecting: boolean;
    isPrinting:   boolean;
    lastError:    string | null;
    lastInvoice:  Invoice | null;
    qrSvg:        string | null;
}

export function useLocalPrinter() {
    const [state, setState] = useState<UseLocalPrinterState>({
        isConnecting: false, isPrinting: false,
        lastError: null, lastInvoice: null, qrSvg: null,
    });

    const connect = useCallback(async (
        kind: "usb" | "serial" | "network" | "auto",
        options?: { port?: string; baud?: number; host?: string; tcp_port?: number }
    ) => {
        setState(s => ({ ...s, isConnecting: true, lastError: null }));
        try {
            if (kind === "auto") {
                // Detectar: USB primero, luego serial.
                const found = await localApi.listPrinters();
                if (found.usb.length > 0) {
                    const dev = found.usb[0];
                    const [v, p] = dev.identifier.replace("usb:", "").split(":");
                    await localApi.connectPrinter({
                        kind: "usb",
                        vendor_id: parseInt(v, 16),
                        product_id: parseInt(p, 16),
                    });
                } else if (found.serial.length > 0) {
                    await localApi.connectPrinter({
                        kind: "serial",
                        port: found.serial[0].identifier.replace("serial:", ""),
                        baud: 9600,
                    });
                } else {
                    throw new Error("No se encontraron impresoras");
                }
            } else {
                await localApi.connectPrinter({ kind, ...options });
            }
            setState(s => ({ ...s, isConnecting: false }));
        } catch (e) {
            setState(s => ({
                ...s, isConnecting: false,
                lastError: e instanceof Error ? e.message : String(e),
            }));
        }
    }, []);

    const disconnect = useCallback(async () => {
        await localApi.disconnectPrinter();
    }, []);

    /**
     * Emite una factura VeriFactu y la imprime automáticamente.
     * El backend Rust se encarga del hash chain y del QR.
     */
    const issueAndPrint = useCallback(async (params: {
        orderId: string;
        series: string;
        paymentMethod: "CASH" | "CARD" | "BIZUM" | "TRANSFER" | "OTHER";
    }): Promise<IssueInvoiceResponse | null> => {
        setState(s => ({ ...s, isPrinting: true, lastError: null }));
        try {
            const res = await localApi.issueInvoice({
                order_id:       params.orderId,
                series:         params.series,
                payment_method: params.paymentMethod,
                auto_print:     true,
            });
            setState(s => ({
                ...s,
                isPrinting: false,
                lastInvoice: res.invoice,
                qrSvg: res.qr_svg,
            }));
            return res;
        } catch (e) {
            setState(s => ({
                ...s,
                isPrinting: false,
                lastError: e instanceof Error ? e.message : String(e),
            }));
            return null;
        }
    }, []);

    /**
     * Imprime un ticket arbitrario construido con EscposBuilder.
     * Útil para pre-cuentas, comandas de cocina, etc.
     */
    const printRaw = useCallback(async (bytes: Uint8Array) => {
        setState(s => ({ ...s, isPrinting: true, lastError: null }));
        try {
            await localApi.printBytes(bytes);
            setState(s => ({ ...s, isPrinting: false }));
        } catch (e) {
            setState(s => ({
                ...s, isPrinting: false,
                lastError: e instanceof Error ? e.message : String(e),
            }));
        }
    }, []);

    /**
     * Helper de alto nivel: construye un ticket de pre-cuenta con
     * el mismo builder que en la versión cloud y lo imprime.
     * Desglosa IVA por tipo (10% restauración / 21% bebidas alcohólicas).
     */
    const printPreBill = useCallback(async (params: {
        businessName: string;
        cifNif: string;
        address: string;
        phone?: string;
        tableNumber?: string;
        waiterName?: string;
        lines: Array<{ name: string; qty: number; price: number; tax_rate?: number; notes?: string }>;
    }) => {
        const b = new EscposBuilder();
        b.init().align("center").bold(true).size(2)
            .text(params.businessName || "RESTAURANTE")
            .size(1).bold(false)
            .text(params.address || "")
            .text("NIF/CIF: " + (params.cifNif || "—"))
            .feed(1).hr("=").align("left");

        if (params.tableNumber || params.waiterName) {
            const meta: string[] = [];
            if (params.tableNumber)  meta.push(`Mesa: ${params.tableNumber}`);
            if (params.waiterName)   meta.push(`Camarero: ${params.waiterName}`);
            b.text(meta.join(" · ")).feed(1);
        }

        // 1) Líneas + acumular base imponible por tipo de IVA
        const baseByRate = new Map<number, number>();
        let grossTotal = 0;
        for (const l of params.lines) {
            const line  = l.qty > 1 ? `${l.name} x${l.qty}` : l.name;
            const price = l.qty * l.price;
            b.lineWithPrice(line, price.toFixed(2) + " €");
            if (l.notes) b.text("   > " + l.notes);
            grossTotal += price;
            const rate = l.tax_rate ?? 10;
            baseByRate.set(rate, (baseByRate.get(rate) ?? 0) + price);
        }
        b.feed(1).hr("-");

        // 2) Desglose de IVA (precios en España ya incluyen IVA → base = price / (1 + rate/100))
        const sortedRates = Array.from(baseByRate.keys()).sort((a, b) => b - a);
        let totalNet = 0;
        let totalTax = 0;
        for (const rate of sortedRates) {
            const gross = baseByRate.get(rate) ?? 0;
            const base  = gross / (1 + rate / 100);
            const tax   = gross - base;
            totalNet += base;
            totalTax += tax;
            b.lineWithPrice(`Base ${rate}%`,    base.toFixed(2) + " €");
            b.lineWithPrice(`I.V.A. ${rate}%`,   tax.toFixed(2) + " €");
        }
        b.hr("=")
            .bold(true).lineWithPrice("TOTAL", grossTotal.toFixed(2) + " €").bold(false)
            .feed(1).align("center")
            .text("— PRE-CUENTA —")
            .feed(3).cut("PARTIAL", 3);

        await printRaw(b.build());
    }, [printRaw]);

    return { ...state, connect, disconnect, issueAndPrint, printRaw, printPreBill };
}
