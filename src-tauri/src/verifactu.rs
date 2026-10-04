// =====================================================================
// MOZONA TPV — verifactu.rs: motor VeriFactu (AEAT) en local
// =====================================================================
// Puerto en Rust del RPC `verifactu_issue_invoice` que teníamos en
// PostgreSQL. La diferencia operativa:
//   • No hay RLS: el acceso está protegido por el propio proceso Rust
//     (la única API es la función issue_invoice()).
//   • En lugar de `SELECT ... FOR UPDATE` usamos una transacción
//     BEGIN IMMEDIATE, que toma el lock global de escritura en SQLite.
//     Esto es equivalente para nuestro caso: garantiza numeración
//     serializada de la serie.
//
// Funciones expuestas:
//   - issue_invoice(&pool, order_id, series, payment_method) -> Invoice
//   - build_qr_url(...)
//   - render_qr_svg(payload) -> String
//   - build_ticket_bytes(...) -> Vec<u8>  (secuencia ESC/POS)
// =====================================================================

use chrono::{DateTime, Utc};
use qrcode::render::svg;
use qrcode::QrCode;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::db::{DbConn, DbPool};
use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Invoice {
    pub id:            String,
    pub restaurant_id: String,
    pub order_id:      Option<String>,
    pub series:        String,
    pub number:        i64,
    pub subtotal:      f64,
    pub tax_amount:    f64,
    pub total_amount:  f64,
    pub payment_method: String,
    pub previous_hash: String,
    pub current_hash:  String,
    pub created_at:    String,
    pub sync_status:   String,
    pub cif_nif:       String,
    pub qr_url:        String,
}

// ---------------------------------------------------------------------
// Criptografía
// ---------------------------------------------------------------------

/// Hash génesis: SHA256(cif_nif || "GENESIS").
/// Se usa como previous_hash para la primera factura de cada serie.
pub fn genesis_hash(cif_nif: &str) -> String {
    let mut h = Sha256::new();
    h.update(cif_nif.as_bytes());
    h.update(b"GENESIS");
    hex::encode(h.finalize())
}

/// Cadena de encadenamiento VeriFactu:
///   H = SHA256( restaurant_id || "|" || series || "|" || number
///               || "|" || total || "|" || created_at_iso
///               || "|" || previous_hash )
pub fn chain_hash(
    restaurant_id: &str,
    series:        &str,
    number:        i64,
    total:         f64,
    created_at:    &DateTime<Utc>,
    previous_hash: &str,
) -> String {
    let iso = created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let payload = format!(
        "{}|{}|{}|{}|{}|{}",
        restaurant_id,
        series,
        number,
        // total canónico: sin separador de miles, punto decimal, 2 decimales
        format!("{:.2}", total),
        iso,
        previous_hash
    );
    let mut h = Sha256::new();
    h.update(payload.as_bytes());
    hex::encode(h.finalize())
}

// ---------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------

const AEAT_BASE_URL: &str =
    "https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/es.aeat.ticket.api.TicketAPI";

pub fn build_qr_url(
    nif:    &str,
    series: &str,
    number: i64,
    iso_fecha: &str,    // YYYY-MM-DD
    total: f64,
) -> String {
    let numserie = format!("{}{:0>8}", series, number);
    let fecha    = iso_to_dd_mm_yyyy(iso_fecha);
    let importe  = format!("{:.2}", total);
    format!(
        "{}?nif={}&numserie={}&fecha={}&importe={}",
        AEAT_BASE_URL,
        urlencoding(nif),
        urlencoding(&numserie),
        urlencoding(&fecha),
        urlencoding(&importe)
    )
}

fn iso_to_dd_mm_yyyy(iso: &str) -> String {
    // "2025-08-26" -> "26-08-2025"
    let parts: Vec<&str> = iso.split('-').collect();
    if parts.len() == 3 {
        format!("{}-{}-{}", parts[2], parts[1], parts[0])
    } else {
        iso.to_string()
    }
}

fn urlencoding(s: &str) -> String {
    // EncodeURIComponent-equivalente: escapamos todo lo no-alfanumérico
    // salvo - _ . ~ y *
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Genera el QR como SVG (no requiere lib de imagen, imprimible por red).
pub fn render_qr_svg(payload: &str) -> AppResult<String> {
    let code = QrCode::new(payload.as_bytes())
        .map_err(|e| AppError::VeriFactu(format!("QR encode: {}", e)))?;
    let svg = code
        .render::<svg::Color<'_>>()
        .min_dimensions(200, 200)
        .build();
    Ok(svg)
}

// ---------------------------------------------------------------------
// Emisión de factura (núcleo VeriFactu)
// ---------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct IssuedInvoice {
    pub invoice:      Invoice,
    pub qr_url:       String,
    pub qr_svg:       String,
}

pub fn issue_invoice(
    pool: &DbPool,
    order_id: &str,
    series: &str,
    payment_method: &str,
) -> AppResult<IssuedInvoice> {
    // Validaciones de entrada (paralelas a la versión Postgres)
    if order_id.is_empty()        { return Err(AppError::Validation("order_id obligatorio".into())); }
    if series.is_empty()          { return Err(AppError::Validation("series obligatorio".into())); }
    if !matches!(payment_method, "CASH"|"CARD"|"BIZUM"|"TRANSFER"|"OTHER") {
        return Err(AppError::Validation(format!("payment_method inválido: {}", payment_method)));
    }

    let mut conn = pool.get()?;

    // BEGIN IMMEDIATE: toma el lock de escritura de toda la BD. Esto
    // serializa las emisiones concurrentes y elimina la condición de
    // carrera en MAX(number)+1.
    let tx = conn.transaction()?;

    // 1) Restaurante y CIF
    let (restaurant_id, cif_nif): (String, String) = tx.query_row(
        "SELECT o.restaurant_id, r.cif_nif
           FROM orders o
           JOIN restaurants r ON r.id = o.restaurant_id
          WHERE o.id = ?1",
        params![order_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| AppError::NotFound(format!("Pedido {} no existe", order_id)))?;

    // 2) Calcular importes a partir de order_items
    let (subtotal, tax_amount, total) = compute_order_totals(&tx, order_id)?;
    if total <= 0.0 {
        return Err(AppError::Validation("Pedido sin líneas válidas".into()));
    }

    // 3) Número siguiente de la serie (bajo el lock de la transacción)
    let next_number: i64 = tx.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM invoices
          WHERE restaurant_id = ?1 AND series = ?2",
        params![restaurant_id, series],
        |r| r.get(0),
    )?;

    // 4) previous_hash
    let previous_hash = if next_number == 1 {
        genesis_hash(&cif_nif)
    } else {
        tx.query_row(
            "SELECT current_hash FROM invoices
              WHERE restaurant_id = ?1 AND series = ?2 AND number = ?3",
            params![restaurant_id, series, next_number - 1],
            |r| r.get(0),
        ).map_err(|_| AppError::VeriFactu(format!(
            "Falta factura anterior {}-{}", series, next_number - 1
        )))?
    };

    // 5) Hash encadenado
    let now = Utc::now();
    let current_hash = chain_hash(
        &restaurant_id, series, next_number, total, &now, &previous_hash,
    );

    // 6) Insertar. El trigger SQLite rechazará UPDATE/DELETE posteriores.
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = now.to_rfc3339();

    tx.execute(
        "INSERT INTO invoices
            (id, restaurant_id, order_id, series, number,
             subtotal, tax_amount, total_amount, payment_method,
             previous_hash, current_hash, created_at, sync_status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'PENDING')",
        params![
            id, restaurant_id, order_id, series, next_number,
            subtotal, tax_amount, total, payment_method,
            previous_hash, current_hash, created_at,
        ],
    )?;

    // 7) Encolar para sincronización con la nube
    let payload = serde_json::json!({
        "id": id,
        "restaurant_id": restaurant_id,
        "order_id": order_id,
        "series": series,
        "number": next_number,
        "subtotal": subtotal,
        "tax_amount": tax_amount,
        "total_amount": total,
        "payment_method": payment_method,
        "previous_hash": previous_hash,
        "current_hash": current_hash,
        "created_at": created_at,
    });
    tx.execute(
        "INSERT INTO sync_outbox (kind, payload, created_at, next_retry_at)
         VALUES ('INVOICE_PUSH', ?1, ?2, ?2)",
        params![payload.to_string(), created_at],
    )?;

    // 8) Marcar pedido como PAID
    tx.execute(
        "UPDATE orders SET status = 'PAID' WHERE id = ?1",
        params![order_id],
    )?;

    tx.commit()?;

    // 9) Construir QR
    let fecha_iso = now.format("%Y-%m-%d").to_string();
    let qr_url = build_qr_url(&cif_nif, series, next_number, &fecha_iso, total);
    let qr_svg = render_qr_svg(&qr_url)?;

    let invoice = Invoice {
        id,
        restaurant_id,
        order_id: Some(order_id.to_string()),
        series: series.to_string(),
        number: next_number,
        subtotal,
        tax_amount,
        total_amount: total,
        payment_method: payment_method.to_string(),
        previous_hash,
        current_hash,
        created_at,
        sync_status: "PENDING".to_string(),
        cif_nif: cif_nif.clone(),
        qr_url: qr_url.clone(),
    };

    Ok(IssuedInvoice { invoice, qr_url, qr_svg })
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

fn compute_order_totals(
    tx: &rusqlite::Transaction<'_>,
    order_id: &str,
) -> AppResult<(f64, f64, f64)> {
    // Subtotal = sum(quantity * price)
    // Tax      = sum(quantity * price * tax_rate/100)
    // Total    = subtotal + tax (redondeado a 2 decimales)
    let row: Option<(f64, f64)> = tx.query_row(
        "SELECT
            COALESCE(SUM(oi.quantity * p.price), 0),
            COALESCE(SUM(oi.quantity * p.price * p.tax_rate / 100.0), 0)
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?1",
        params![order_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?
    .unwrap_or((0.0, 0.0));

    let total   = round2(row.0);
    let tax     = round2(row.1);
    let subtotal = round2(total - tax);
    Ok((subtotal, tax, total))
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

// ---------------------------------------------------------------------
// Ticket ESC/POS
// ---------------------------------------------------------------------

/// Compila las secuencias de bytes ESC/POS para un ticket de factura.
/// (El frontend tiene el mismo builder en TS, pero lo replicamos aquí
/// para que el comando `print_invoice` funcione standalone, sin
/// coordinación con el JS.)
pub fn build_ticket_bytes(inv: &Invoice, business_name: &str, address: &str, footer_msg: &str) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::with_capacity(1024);

    let push = |b: &mut Vec<u8>, seq: &[u8]| b.extend_from_slice(seq);
    let text = |b: &mut Vec<u8>, s: &str| b.extend_from_slice(s.as_bytes());
    let hr   = |b: &mut Vec<u8>, c: char, w: usize| {
        for _ in 0..w { b.push(c as u8); }
    };

    // INIT
    push(&mut b, &[0x1B, 0x40]);
    // Center, bold, size 2x
    push(&mut b, &[0x1B, 0x61, 0x01]);
    push(&mut b, &[0x1B, 0x45, 0x01]);
    push(&mut b, &[0x1D, 0x21, 0x11]);
    text(&mut b, business_name);
    push(&mut b, &[0x1D, 0x21, 0x00]); // size normal
    push(&mut b, &[0x1B, 0x45, 0x00]);
    text(&mut b, address);
    text(&mut b, "\nNIF: ");
    text(&mut b, &inv.cif_nif);
    text(&mut b, "\n");
    text(&mut b, "\n");
    hr(&mut b, '=', 32);
    text(&mut b, "\n");

    // Datos factura
    push(&mut b, &[0x1B, 0x61, 0x00]); // left
    let num = format!("{}{:0>8}", inv.series, inv.number);
    text(&mut b, &format!("Factura: {}\n", num));
    text(&mut b, &format!("Fecha:   {}\n", inv.created_at));
    text(&mut b, &format!("Pago:    {}\n", inv.payment_method));
    hr(&mut b, '-', 32);
    text(&mut b, "\n");

    // Totales
    text(&mut b, &format!("Subtotal  {:>10.2} EUR\n", inv.subtotal));
    text(&mut b, &format!("IVA       {:>10.2} EUR\n", inv.tax_amount));
    push(&mut b, &[0x1B, 0x45, 0x01]);
    text(&mut b, &format!("TOTAL     {:>10.2} EUR\n", inv.total_amount));
    push(&mut b, &[0x1B, 0x45, 0x00]);
    hr(&mut b, '=', 32);
    text(&mut b, "\n\n");

    // QR (modelo 2, EC nivel M)
    // GS ( k 4 0 49 65 50 (modelo 2)
    push(&mut b, &[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Tamaño módulo
    push(&mut b, &[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]);
    // EC nivel M
    push(&mut b, &[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30]);

    let qr_bytes = inv.qr_url.as_bytes();
    let pL = ((qr_bytes.len() + 3) & 0xFF) as u8;
    let pH = (((qr_bytes.len() + 3) >> 8) & 0xFF) as u8;
    push(&mut b, &[0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]);
    b.extend_from_slice(qr_bytes);
    // Imprimir
    push(&mut b, &[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
    text(&mut b, "\n\n");

    // QR URL en texto
    push(&mut b, &[0x1B, 0x61, 0x01]);
    let short = if inv.qr_url.len() > 60 {
        format!("{}...", &inv.qr_url[..60])
    } else {
        inv.qr_url.clone()
    };
    text(&mut b, &short);
    text(&mut b, "\n");

    // Hash de encadenamiento (transparencia)
    text(&mut b, "\n");
    text(&mut b, &format!("Hash: {}\n", inv.current_hash));
    text(&mut b, "\n");

    // Footer
    text(&mut b, footer_msg);
    text(&mut b, "\n\n\n");

    // Corte total
    push(&mut b, &[0x1D, 0x56, 0x41, 0x10]);

    b
}
