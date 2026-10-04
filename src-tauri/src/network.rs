// =====================================================================
// MOZONA TPV — network.rs: servidor HTTP/WebSocket local
// =====================================================================
// Sirve la API REST en la red local (0.0.0.0:7421) para que los
// camareros se conecten desde sus móviles a través de la Wi-Fi del
// restaurante.
//
// Endpoints:
//   GET  /api/health
//   GET  /api/restaurant
//   GET  /api/menu
//   GET  /api/tables
//   POST /api/orders            (crear pedido)
//   GET  /api/orders/:id
//   POST /api/orders/:id/items  (añadir línea)
//   POST /api/invoices          (emitir VeriFactu local)
//   GET  /api/invoices/:id
//   WS   /ws                    (eventos realtime para móviles)
//
// La autenticación es por API key compartida (configurable en la UI
// de la TPV principal) y enviada por header `X-Mozona-Key`.
// =====================================================================

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use local_ipaddress::list_afinet_netifas;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::verifactu;

// ---------------------------------------------------------------------
// Estado compartido
// ---------------------------------------------------------------------

#[derive(Clone)]
pub struct AppState {
    pub pool:         DbPool,
    pub api_key:      Arc<String>,
    pub events_tx:    broadcast::Sender<RealtimeEvent>,
    pub local_ip:     Arc<String>,
    pub port:         u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEvent {
    OrderCreated    { order_id: String, table: String },
    OrderUpdated    { order_id: String, status: String },
    InvoiceIssued   { invoice_id: String, total: f64 },
    MenuUpdated     { version: u64 },
    PrinterStatus   { connected: bool, info: Option<String> },
}

impl AppState {
    pub fn broadcast(&self, ev: RealtimeEvent) {
        // ignore error: significa que no hay suscriptores activos
        let _ = self.events_tx.send(ev);
    }
}

// ---------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------

pub async fn serve(pool: DbPool, port: u16) -> AppResult<()> {
    let api_key = std::env::var("MOZONA_LAN_KEY")
        .unwrap_or_else(|_| format!("mozona-{}", random_key()));
    let local_ip = detect_local_ip();

    let (tx, _rx) = broadcast::channel::<RealtimeEvent>(128);

    let state = AppState {
        pool: pool.clone(),
        api_key: Arc::new(api_key),
        events_tx: tx,
        local_ip: Arc::new(local_ip),
        port,
    };
    serve_with_state(state).await
}

/// Variante que reusa un AppState ya creado (registrado en Tauri).
pub async fn serve_with_state(state: AppState) -> AppResult<()> {
    let port = state.port;
    log::info!("LAN server arrancando en 0.0.0.0:{}  (ip={})", port, state.local_ip);

    let app = router(state.clone());
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    log::info!("LAN HTTP server listening on http://0.0.0.0:{}", port);

    axum::serve(listener, app)
        .await
        .map_err(|e| AppError::Validation(format!("LAN server: {}", e)))?;
    Ok(())
}

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)        // LAN: cualquier origen
        .allow_methods(Any)
        .allow_headers(Any);

    let protected = Router::new()
        .route("/api/restaurant",          get(get_restaurant))
        .route("/api/menu",                get(get_menu))
        .route("/api/tables",              get(get_tables))
        .route("/api/orders",              post(create_order))
        .route("/api/orders/:id",          get(get_order))
        .route("/api/orders/:id/items",    post(add_order_item))
        .route("/api/orders/:id/pay",      post(close_and_invoice))
        .route("/api/invoices/:id",        get(get_invoice))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_api_key,
        ));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/network-info", get(network_info))
        .route("/ws", get(ws_handler))
        .merge(protected)
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------

async fn health(State(s): State<AppState>) -> Json<Value> {
    let db_ok = crate::db::ping(&s.pool).unwrap_or(false);
    Json(json!({
        "status":   "ok",
        "db":       db_ok,
        "version":  env!("CARGO_PKG_VERSION"),
    }))
}

async fn network_info(State(s): State<AppState>) -> Json<Value> {
    Json(json!({
        "local_ip": s.local_ip,
        "port":     s.port,
        "urls":     [
            format!("http://{}.local:{}", s.local_ip, s.port),
            format!("http://{}:{}", s.local_ip, s.port),
        ],
    }))
}

async fn get_restaurant(State(s): State<AppState>) -> AppResult<Json<Value>> {
    match crate::db::get_default_restaurant(&s.pool)? {
        Some(r) => Ok(Json(r)),
        None => Err(AppError::NotFound("No hay restaurante configurado".into())),
    }
}

async fn get_menu(State(s): State<AppState>) -> AppResult<Json<Value>> {
    let conn = s.pool.get()?;
    let cats = conn.prepare(
        "SELECT id, name, sort_order FROM categories ORDER BY sort_order, name",
    )?;
    let mut result = Vec::new();
    for cat_row in cats.query_map([], |r| {
        Ok(json!({
            "id":         r.get::<_, String>(0)?,
            "name":       r.get::<_, String>(1)?,
            "sort_order": r.get::<_, i64>(2)?,
        }))
    })? {
        let mut cat = cat_row?;
        let cat_id = cat["id"].as_str().unwrap().to_string();
        let prods = conn.prepare(
            "SELECT id, name, description, price, tax_rate, is_available
             FROM products WHERE category_id = ?1
             ORDER BY name",
        )?;
        let mut prods_arr = Vec::new();
        for p in prods.query_map([&cat_id], |r| {
            Ok(json!({
                "id":           r.get::<_, String>(0)?,
                "name":         r.get::<_, String>(1)?,
                "description":  r.get::<_, Option<String>>(2)?,
                "price":        r.get::<_, f64>(3)?,
                "tax_rate":     r.get::<_, f64>(4)?,
                "is_available": r.get::<_, i64>(5)? == 1,
            }))
        })? {
            prods_arr.push(p?);
        }
        cat["products"] = json!(prods_arr);
        result.push(cat);
    }
    Ok(Json(json!({ "categories": result })))
}

async fn get_tables(State(s): State<AppState>) -> AppResult<Json<Value>> {
    let conn = s.pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.zone_id, z.name, t.table_number, t.status
         FROM tables t LEFT JOIN zones z ON z.id = t.zone_id
         ORDER BY z.name, t.table_number",
    )?;
    let arr: Vec<Value> = stmt.query_map([], |r| {
        Ok(json!({
            "id":           r.get::<_, String>(0)?,
            "zone_id":      r.get::<_, Option<String>>(1)?,
            "zone":         r.get::<_, Option<String>>(2)?,
            "table_number": r.get::<_, String>(3)?,
            "status":       r.get::<_, String>(4)?,
        }))
    })?.collect::<rusqlite::Result<_>>()?;
    Ok(Json(json!({ "tables": arr })))
}

#[derive(Deserialize)]
struct CreateOrderBody {
    table_id: String,
    items: Vec<OrderItemInput>,
}

#[derive(Deserialize)]
struct OrderItemInput {
    product_id: String,
    quantity:   i64,
    notes:      Option<String>,
}

async fn create_order(
    State(s): State<AppState>,
    Json(body): Json<CreateOrderBody>,
) -> AppResult<Json<Value>> {
    let mut conn = s.pool.get()?;
    let tx = conn.transaction()?;

    let restaurant_id: String = tx.query_row(
        "SELECT restaurant_id FROM tables WHERE id = ?1",
        [&body.table_id],
        |r| r.get(0),
    ).map_err(|_| AppError::NotFound("Mesa no encontrada".into()))?;

    let order_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO orders (id, restaurant_id, table_id, status, created_at)
         VALUES (?1, ?2, ?3, 'OPEN', ?4)",
        rusqlite::params![order_id, restaurant_id, body.table_id, now],
    )?;

    // Marcar mesa ocupada
    tx.execute(
        "UPDATE tables SET status = 'OCCUPIED' WHERE id = ?1",
        [&body.table_id],
    )?;

    for it in &body.items {
        let (price, _name): (f64, String) = tx.query_row(
            "SELECT price, name FROM products WHERE id = ?1",
            [&it.product_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|_| AppError::NotFound(format!("Producto {} no existe", it.product_id)))?;

        let item_id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO order_items
                (id, order_id, product_id, quantity, unit_price, notes, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                item_id, order_id, it.product_id,
                it.quantity, price, it.notes, now
            ],
        )?;
    }

    tx.commit()?;

    let table_num: String = s.pool.get()?
        .query_row("SELECT table_number FROM tables WHERE id = ?1",
            [&body.table_id], |r| r.get(0)).unwrap_or_default();
    s.broadcast(RealtimeEvent::OrderCreated {
        order_id: order_id.clone(),
        table:    table_num,
    });

    Ok(Json(json!({ "order_id": order_id })))
}

async fn get_order(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let conn = s.pool.get()?;
    let order: Value = conn.query_row(
        "SELECT id, restaurant_id, table_id, status, created_at
         FROM orders WHERE id = ?1",
        [&id], |r| Ok(json!({
            "id":            r.get::<_, String>(0)?,
            "restaurant_id": r.get::<_, String>(1)?,
            "table_id":      r.get::<_, Option<String>>(2)?,
            "status":        r.get::<_, String>(3)?,
            "created_at":    r.get::<_, String>(4)?,
        })),
    ).map_err(|_| AppError::NotFound("Pedido no encontrado".into()))?;

    let mut stmt = conn.prepare(
        "SELECT oi.id, p.name, oi.quantity, oi.unit_price, oi.notes
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?1 ORDER BY oi.created_at",
    )?;
    let items: Vec<Value> = stmt.query_map([&id], |r| {
        Ok(json!({
            "id":         r.get::<_, String>(0)?,
            "name":       r.get::<_, Option<String>>(1)?,
            "quantity":   r.get::<_, i64>(2)?,
            "unit_price": r.get::<_, f64>(3)?,
            "notes":      r.get::<_, Option<String>>(4)?,
        }))
    })?.collect::<rusqlite::Result<_>>()?;

    Ok(Json(json!({
        "order": order,
        "items": items,
    })))
}

async fn add_order_item(
    State(s): State<AppState>,
    Path(order_id): Path<String>,
    Json(it): Json<OrderItemInput>,
) -> AppResult<Json<Value>> {
    let conn = s.pool.get()?;
    let price: f64 = conn.query_row(
        "SELECT price FROM products WHERE id = ?1", [&it.product_id], |r| r.get(0),
    ).map_err(|_| AppError::NotFound("Producto no existe".into()))?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, notes, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![id, order_id, it.product_id, it.quantity, price,
                          it.notes, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
struct PayBody {
    series:         String,
    payment_method: String,
}

async fn close_and_invoice(
    State(s): State<AppState>,
    Path(order_id): Path<String>,
    Json(body): Json<PayBody>,
) -> AppResult<Json<Value>> {
    let issued = verifactu::issue_invoice(&s.pool, &order_id, &body.series, &body.payment_method)?;
    s.broadcast(RealtimeEvent::InvoiceIssued {
        invoice_id: issued.invoice.id.clone(),
        total:      issued.invoice.total_amount,
    });
    Ok(Json(serde_json::to_value(&issued)?))
}

async fn get_invoice(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let conn = s.pool.get()?;
    let row: Value = conn.query_row(
        "SELECT id, series, number, subtotal, tax_amount, total_amount,
                payment_method, previous_hash, current_hash, created_at,
                sync_status
         FROM invoices WHERE id = ?1",
        [&id], |r| Ok(json!({
            "id":            r.get::<_, String>(0)?,
            "series":        r.get::<_, String>(1)?,
            "number":        r.get::<_, i64>(2)?,
            "subtotal":      r.get::<_, f64>(3)?,
            "tax_amount":    r.get::<_, f64>(4)?,
            "total_amount":  r.get::<_, f64>(5)?,
            "payment_method":r.get::<_, String>(6)?,
            "previous_hash": r.get::<_, String>(7)?,
            "current_hash":  r.get::<_, String>(8)?,
            "created_at":    r.get::<_, String>(9)?,
            "sync_status":   r.get::<_, String>(10)?,
        })),
    ).map_err(|_| AppError::NotFound("Factura no encontrada".into()))?;
    Ok(Json(row))
}

// ---------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
) -> Response {
    let mut rx = s.events_tx.subscribe();
    ws.on_upgrade(move |socket| async move {
        let _ = handle_ws(socket, &mut rx).await;
    })
}

async fn handle_ws(
    mut socket: WebSocket,
    rx: &mut broadcast::Receiver<RealtimeEvent>,
) -> AppResult<()> {
    loop {
        match rx.recv().await {
            Ok(ev) => {
                let txt = serde_json::to_string(&ev).unwrap_or_default();
                if socket.send(Message::Text(txt)).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Middleware: autenticación por API key
// ---------------------------------------------------------------------

async fn require_api_key(
    State(s): State<AppState>,
    headers: HeaderMap,
    req: axum::extract::Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    let provided = headers
        .get("x-mozona-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided != s.api_key.as_str() {
        return Err((StatusCode::UNAUTHORIZED, "API key inválida".into()));
    }
    Ok(next.run(req).await)
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------

fn detect_local_ip() -> String {
    if let Ok(ifaces) = list_afinet_netifas() {
        // Busca la primera IPv4 privada (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        for (name, ip) in &ifaces {
            if name == "lo" { continue; }
            if ip.starts_with("192.168.") || ip.starts_with("10.") {
                if !(ip.starts_with("127.")) {
                    return ip.clone();
                }
            }
        }
        for (_, ip) in &ifaces {
            if !ip.starts_with("127.") && !ip.contains(':') {
                return ip.clone();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn random_key() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let s: String = (0..16)
        .map(|_| {
            let c: u8 = rng.gen_range(b'a'..=b'z');
            c as char
        })
        .collect();
    s
}
