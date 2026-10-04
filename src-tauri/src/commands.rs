// =====================================================================
// MOZONA TPV — commands.rs: comandos Tauri expuestos al frontend React
// =====================================================================
// Cada `#[tauri::command]` es invocable desde JS con `invoke(name, args)`.
// La capa de transporte es IPC (memory-safe, no stringify JSON manual).
//
// Convenciones de nombres: <verbo>_<entorno>_<objeto>
// =====================================================================

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbPool;
use crate::error::AppResult;
use crate::network::{self, AppState, RealtimeEvent};
use crate::printer::{
    self, DetectedPrinter, PrinterInfo, PrinterState, TransportKind,
};
use crate::sync::{SyncConfig, SyncState, SyncStatus};
use crate::verifactu::{self, IssuedInvoice, Invoice};

// =====================================================================
// DB
// =====================================================================

#[tauri::command]
pub async fn db_ping(pool: State<'_, DbPool>) -> AppResult<bool> {
    crate::db::ping(pool.inner())
}

#[tauri::command]
pub async fn db_get_default_restaurant(
    pool: State<'_, DbPool>,
) -> AppResult<Option<serde_json::Value>> {
    crate::db::get_default_restaurant(pool.inner())
}

// =====================================================================
// PRINTER
// =====================================================================

#[derive(Debug, Serialize)]
pub struct PrinterDetectionResult {
    pub usb:    Vec<DetectedPrinter>,
    pub serial: Vec<DetectedPrinter>,
}

#[tauri::command]
pub async fn printer_list_available() -> AppResult<PrinterDetectionResult> {
    Ok(PrinterDetectionResult {
        usb:    printer::list_usb_printers().unwrap_or_default(),
        serial: printer::list_serial_ports().unwrap_or_default(),
    })
}

#[derive(Deserialize)]
pub struct ConnectArgs {
    /// "usb" | "serial" | "network"
    pub kind:        String,
    /// Vendor USB (opcional, filtra)
    pub vendor_id:   Option<u16>,
    pub product_id:  Option<u16>,
    /// Path del puerto serie (p.ej. "/dev/ttyUSB0")
    pub port:        Option<String>,
    /// Baudios del puerto serie
    pub baud:        Option<u32>,
    /// Host:puerto para red
    pub host:        Option<String>,
    pub tcp_port:    Option<u16>,
}

#[tauri::command]
pub async fn printer_connect(
    args: ConnectArgs,
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<PrinterInfo> {
    match args.kind.as_str() {
        "usb" => printer_state.connect_usb(args.vendor_id, args.product_id),
        "serial" => {
            let port = args.port.ok_or_else(|| {
                crate::error::AppError::Validation("port requerido para conexión serie".into())
            })?;
            printer_state.connect_serial(&port, args.baud.unwrap_or(9600))
        }
        "network" => {
            let host = args.host.ok_or_else(|| {
                crate::error::AppError::Validation("host requerido para conexión red".into())
            })?;
            printer_state.connect_network(&host, args.tcp_port.unwrap_or(9100))
        }
        other => Err(crate::error::AppError::Validation(
            format!("Tipo de transporte no soportado: {}", other)
        )),
    }
}

#[tauri::command]
pub async fn printer_disconnect(
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<()> {
    printer_state.disconnect();
    Ok(())
}

#[tauri::command]
pub async fn printer_status(
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<Option<PrinterInfo>> {
    Ok(printer_state.info())
}

#[tauri::command]
pub async fn printer_write_raw(
    bytes: Vec<u8>,
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<usize> {
    printer_state.write(&bytes)
}

/// Atajo: abre cajón portamonedas
#[tauri::command]
pub async fn printer_open_cash_drawer(
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<()> {
    printer_state.write(&[0x1B, 0x70, 0x00, 0x19, 0xFA])?;
    Ok(())
}

/// Inicializa la impresora
#[tauri::command]
pub async fn printer_init(
    printer_state: State<'_, Arc<PrinterState>>,
) -> AppResult<()> {
    printer_state.write(&[0x1B, 0x40])?;
    Ok(())
}

// =====================================================================
// VERIFACTU
// =====================================================================

#[derive(Deserialize)]
pub struct IssueInvoiceArgs {
    pub order_id:       String,
    pub series:         String,
    pub payment_method: String,
    /// Si true, también imprime el ticket en la impresora activa
    pub auto_print:     bool,
}

#[derive(Serialize)]
pub struct IssueInvoiceResponse {
    pub invoice:    Invoice,
    pub qr_url:     String,
    pub qr_svg:     String,
    /// Bytes ESC/POS listos para enviar (los mismos que usa auto_print)
    pub ticket_escpos_b64: String,
    pub printed:    bool,
}

#[tauri::command]
pub async fn verifactu_issue_invoice(
    args: IssueInvoiceArgs,
    pool: State<'_, DbPool>,
    printer_state: State<'_, Arc<PrinterState>>,
    app_state:     State<'_, AppState>,
) -> AppResult<IssueInvoiceResponse> {
    let IssuedInvoice { invoice, qr_url, qr_svg } =
        verifactu::issue_invoice(pool.inner(), &args.order_id,
                                 &args.series, &args.payment_method)?;

    // Datos del restaurante para el ticket
    let rest = crate::db::get_default_restaurant(pool.inner())?
        .ok_or_else(|| crate::error::AppError::NotFound("Restaurante no configurado".into()))?;
    let bytes = verifactu::build_ticket_bytes(
        &invoice,
        rest["business_name"].as_str().unwrap_or(""),
        rest["address"].as_str().unwrap_or(""),
        rest["ticket_footer_msg"].as_str().unwrap_or("¡Gracias!"),
    );

    let mut printed = false;
    if args.auto_print && printer_state.is_connected() {
        printer_state.write(&bytes)?;
        printed = true;
    }

    // Broadcast LAN
    let state_clone = app_state.inner().clone();
    tokio::spawn(async move {
        state_clone.broadcast(RealtimeEvent::InvoiceIssued {
            invoice_id: invoice.id.clone(),
            total:      invoice.total_amount,
        });
    });

    Ok(IssueInvoiceResponse {
        qr_svg,
        qr_url,
        ticket_escpos_b64: base64_encode(&bytes),
        printed,
        invoice,
    })
}

#[tauri::command]
pub async fn verifactu_chain_status(
    pool: State<'_, DbPool>,
) -> AppResult<serde_json::Value> {
    let conn = pool.get()?;
    let last_per_series = conn.prepare(
        "SELECT series, number, current_hash, created_at
         FROM invoices
         WHERE (series, number) IN (
             SELECT series, MAX(number) FROM invoices GROUP BY series
         )",
    )?;
    let mut out = Vec::new();
    for row in last_per_series.query_map([], |r| {
        Ok(serde_json::json!({
            "series":       r.get::<_, String>(0)?,
            "last_number":  r.get::<_, i64>(1)?,
            "last_hash":    r.get::<_, String>(2)?,
            "issued_at":    r.get::<_, String>(3)?,
        }))
    })? {
        out.push(row?);
    }
    Ok(serde_json::json!({ "chains": out }))
}

// =====================================================================
// LAN / SYNC
// =====================================================================

#[tauri::command]
pub async fn network_get_info(
    app_state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({
        "local_ip": app_state.local_ip,
        "port":     app_state.port,
        "api_key":  app_state.api_key,
    }))
}

#[tauri::command]
pub async fn sync_get_status(
    sync_state: State<'_, Arc<SyncState>>,
) -> AppResult<SyncStatus> {
    Ok(sync_state.status())
}

#[tauri::command]
pub async fn sync_configure(
    cfg: SyncConfig,
    sync_state: State<'_, Arc<SyncState>>,
) -> AppResult<()> {
    sync_state.configure(cfg);
    Ok(())
}

#[tauri::command]
pub async fn sync_trigger_now(
    sync_state: State<'_, Arc<SyncState>>,
) -> AppResult<()> {
    sync_state.poke();
    Ok(())
}

// =====================================================================
// Helpers
// =====================================================================

fn base64_encode(bytes: &[u8]) -> String {
    use std::io::Write;
    let mut out = Vec::new();
    {
        let mut enc = base64::write::EncoderWriter::new(&mut out, base64::engine::general_purpose::STANDARD);
        enc.write_all(bytes).unwrap();
    }
    String::from_utf8(out).unwrap_or_default()
}

// Necesitamos base64. La añado al Cargo más abajo.
