// =====================================================================
// MOZONA TPV — local-api.ts: adaptador que envuelve los comandos Tauri
// =====================================================================
// En modo Local-First el frontend NO habla con Supabase: habla con el
// backend Rust vía IPC. Este módulo expone una API similar a
// supabase-js (las mismas firmas de `from().select()`, `rpc()`, etc.)
// pero las llamadas terminan invocando los `#[tauri::command]`.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface Restaurant {
    id: string;
    slug: string;
    business_name: string;
    cif_nif: string;
    address: string;
    phone: string | null;
    primary_color: string;
    ticket_footer_msg: string;
    created_at: string;
}

export interface Invoice {
    id: string;
    series: string;
    number: number;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    payment_method: string;
    previous_hash: string;
    current_hash: string;
    created_at: string;
    sync_status: string;
}

export interface IssueInvoiceResponse {
    invoice: Invoice;
    qr_url: string;
    qr_svg: string;
    ticket_escpos_b64: string;
    printed: boolean;
}

export interface PrinterInfo {
    kind: "usb" | "serial" | "network";
    device_name: string;
    manufacturer: string;
    product?: string;
    serial?: string;
    bus?: number;
    address?: number;
    port?: string;
}

export interface DetectedPrinter {
    kind: "usb" | "serial" | "network";
    name: string;
    identifier: string;
    info: string;
}

export interface SyncConfig {
    supabase_url: string;
    supabase_key: string;
    poll_interval_s: number;
    enabled: boolean;
}

export interface SyncStatus {
    enabled: boolean;
    online: boolean;
    pending: number;
    last_run: string | null;
    last_error: string | null;
    last_synced: string | null;
    supabase: string | null;
}

export interface NetworkInfo {
    local_ip: string;
    port: number;
    api_key: string;
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

export const localApi = {
    // ---- DB ----
    async pingDb(): Promise<boolean> {
        return invoke<boolean>("db_ping");
    },
    async getRestaurant(): Promise<Restaurant | null> {
        return invoke<Restaurant | null>("db_get_default_restaurant");
    },

    // ---- PRINTER ----
    async listPrinters(): Promise<{ usb: DetectedPrinter[]; serial: DetectedPrinter[] }> {
        return invoke("printer_list_available");
    },
    async connectPrinter(args: {
        kind: "usb" | "serial" | "network";
        vendor_id?: number;
        product_id?: number;
        port?: string;
        baud?: number;
        host?: string;
        tcp_port?: number;
    }): Promise<PrinterInfo> {
        return invoke<PrinterInfo>("printer_connect", { args });
    },
    async disconnectPrinter(): Promise<void> {
        return invoke<void>("printer_disconnect");
    },
    async printerStatus(): Promise<PrinterInfo | null> {
        return invoke<PrinterInfo | null>("printer_status");
    },
    async printBytes(bytes: Uint8Array): Promise<number> {
        return invoke<number>("printer_write_raw", { bytes: Array.from(bytes) });
    },
    async openCashDrawer(): Promise<void> {
        return invoke<void>("printer_open_cash_drawer");
    },
    async printerInit(): Promise<void> {
        return invoke<void>("printer_init");
    },

    // ---- VERIFACTU ----
    async issueInvoice(args: {
        order_id: string;
        series: string;
        payment_method: "CASH" | "CARD" | "BIZUM" | "TRANSFER" | "OTHER";
        auto_print: boolean;
    }): Promise<IssueInvoiceResponse> {
        return invoke<IssueInvoiceResponse>("verifactu_issue_invoice", { args });
    },
    async chainStatus(): Promise<unknown> {
        return invoke<unknown>("verifactu_chain_status");
    },

    // ---- LAN ----
    async networkInfo(): Promise<NetworkInfo> {
        return invoke<NetworkInfo>("network_get_info");
    },

    // ---- SYNC ----
    async syncStatus(): Promise<SyncStatus> {
        return invoke<SyncStatus>("sync_get_status");
    },
    async configureSync(cfg: SyncConfig): Promise<void> {
        return invoke<void>("sync_configure", { cfg });
    },
    async triggerSyncNow(): Promise<void> {
        return invoke<void>("sync_trigger_now");
    },

    // ---- Eventos ----
    onEvent<T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> {
        return listen<T>(name, (e) => cb(e.payload));
    },
};

// ---------------------------------------------------------------------
// Helper: emitir bytes ESC/POS (puedes reusar EscposBuilder de la
// versión cloud y mandar el resultado por IPC).
// ---------------------------------------------------------------------

export async function printEscposBytes(bytes: Uint8Array): Promise<void> {
    await localApi.printBytes(bytes);
}
