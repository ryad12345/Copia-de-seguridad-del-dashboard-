// =====================================================================
// MOZONA TPV — sync.rs: sincronización opcional con Supabase Cloud
// =====================================================================
// Cuando la TPV detecta conexión a Internet, procesa la cola
// `sync_outbox` empujando cada elemento a la nube con backoff
// exponencial. La nube es la "réplica" de seguridad: el local es la
// fuente de verdad legal para las facturas VeriFactu.
//
// Dirección del sync:
//   • INVOICE_PUSH  : local → cloud (cadena de hashes validada en cloud)
//   • ORDER_PUSH    : local → cloud (estado del pedido)
//   • MENU_PULL     : cloud → local (sólo si la versión es más nueva)
//   • CATEGORIES_PULL / PRODUCTS_PULL / TABLES_PULL: cloud → local
//
// Concurrencia: un solo worker a la vez (evita pisarse en la numeración).
// El worker duerme `POLL_INTERVAL` segundos entre pasadas, y se activa
// on-demand cuando llega un evento de red.
// =====================================================================

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Notify;

use crate::db::DbPool;
use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------
// Configuración (inyectada desde el frontend o env vars)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// URL de Supabase (https://xxx.supabase.co)
    pub supabase_url:    String,
    /// Service role key (NUNCA exponer al frontend web; aquí está en
    /// la TPV local, que es un dispositivo confiable del restaurante).
    pub supabase_key:    String,
    /// Cada cuántos segundos en vacío revisamos la cola.
    pub poll_interval_s: u64,
    /// Si está habilitada la sync (false = local-only).
    pub enabled:         bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            supabase_url:    std::env::var("VITE_SUPABASE_URL").unwrap_or_default(),
            supabase_key:    std::env::var("MOZONA_SUPABASE_SERVICE_KEY").unwrap_or_default(),
            poll_interval_s: 30,
            enabled:         false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub enabled:     bool,
    pub online:      bool,
    pub pending:     i64,
    pub last_run:    Option<String>,
    pub last_error:  Option<String>,
    pub last_synced: Option<String>,
    pub supabase:    Option<String>,
}

// ---------------------------------------------------------------------
// Estado del worker
// ---------------------------------------------------------------------

pub struct SyncState {
    pub config: Mutex<SyncConfig>,
    pub status: Mutex<SyncStatus>,
    pub wake:   Notify,
    pub pool:   DbPool,
}

impl SyncState {
    pub fn new(pool: DbPool, config: SyncConfig) -> Self {
        let status = SyncStatus {
            enabled:     config.enabled,
            online:      false,
            pending:     0,
            last_run:    None,
            last_error:  None,
            last_synced: None,
            supabase:    if config.supabase_url.is_empty() {
                None
            } else {
                Some(config.supabase_url.clone())
            },
        };
        Self {
            config: Mutex::new(config),
            status: Mutex::new(status),
            wake:   Notify::new(),
            pool,
        }
    }

    pub fn configure(&self, cfg: SyncConfig) {
        let mut s = self.status.lock();
        s.enabled = cfg.enabled;
        s.supabase = if cfg.supabase_url.is_empty() {
            None
        } else {
            Some(cfg.supabase_url.clone())
        };
        drop(s);
        *self.config.lock() = cfg;
        self.wake.notify_one();
    }

    pub fn status(&self) -> SyncStatus {
        self.status.lock().clone()
    }

    /// Notifica al worker para que haga un pase inmediato.
    pub fn poke(&self) {
        self.wake.notify_one();
    }
}

// ---------------------------------------------------------------------
// Worker principal
// ---------------------------------------------------------------------

pub async fn run_worker(state: Arc<SyncState>) {
    loop {
        let cfg = state.config.lock().clone();
        if !cfg.enabled || cfg.supabase_url.is_empty() || cfg.supabase_key.is_empty() {
            // Espera唤醒 pasiva
            state.wake.notified().await;
            continue;
        }

        // Hacemos UN pase
        match run_once(&state, &cfg).await {
            Ok(processed) => {
                let mut s = state.status.lock();
                s.last_run = Some(Utc::now().to_rfc3339());
                if processed > 0 {
                    s.last_synced = Some(Utc::now().to_rfc3339());
                }
                s.last_error = None;
                drop(s);
            }
            Err(e) => {
                let mut s = state.status.lock();
                s.last_run = Some(Utc::now().to_rfc3339());
                s.last_error = Some(e.to_string());
                drop(s);
                log::warn!("Sync pase falló: {}", e);
            }
        }

        // Espera el intervalo o un poke externo
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(cfg.poll_interval_s)) => {}
            _ = state.wake.notified() => {}
        }
    }
}

async fn run_once(state: &SyncState, cfg: &SyncConfig) -> AppResult<usize> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    // 1) Ping de salud
    let health_url = format!("{}/rest/v1/", cfg.supabase_url);
    let ping = http.get(&health_url)
        .header("apikey", &cfg.supabase_key)
        .header("Authorization", format!("Bearer {}", cfg.supabase_key))
        .send().await;
    let online = ping.map(|r| r.status().is_success()).unwrap_or(false);
    {
        let mut s = state.status.lock();
        s.online = online;
    }
    if !online {
        return Err(AppError::Validation("Supabase no alcanzable".into()));
    }

    // 2) Procesa outbox
    let pending = fetch_pending(&state.pool)?;
    let mut processed = 0;
    for item in pending {
        if let Err(e) = push_one(&http, cfg, &item).await {
            mark_failure(&state.pool, &item, &e.to_string())?;
        } else {
            mark_done(&state.pool, &item)?;
            processed += 1;
        }
    }

    // 3) Pull de menú (versión)
    if let Err(e) = pull_menu(&http, cfg, &state.pool).await {
        log::warn!("Pull menu falló: {}", e);
    }

    // 4) Actualizar contador pending
    let new_count = count_pending(&state.pool)?;
    state.status.lock().pending = new_count;

    Ok(processed)
}

// ---------------------------------------------------------------------
// Operaciones outbox
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct OutboxItem {
    id:        i64,
    kind:      String,
    payload:   String,
    attempts:  i64,
}

fn fetch_pending(pool: &DbPool) -> AppResult<Vec<OutboxItem>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, payload, attempts FROM sync_outbox
          WHERE status IN ('PENDING','FAILED')
            AND next_retry_at <= ?1
          ORDER BY id ASC
          LIMIT 100",
    )?;
    let now = Utc::now().to_rfc3339();
    let items = stmt.query_map([&now], |r| {
        Ok(OutboxItem {
            id: r.get(0)?, kind: r.get(1)?,
            payload: r.get(2)?, attempts: r.get(3)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

fn mark_done(pool: &DbPool, item: &OutboxItem) -> AppResult<()> {
    pool.get()?.execute(
        "UPDATE sync_outbox SET status = 'DONE' WHERE id = ?1",
        params![item.id],
    )?;
    // Si es una factura, marcarla como sincronizada
    if item.kind == "INVOICE_PUSH" {
        let payload: Value = serde_json::from_str(&item.payload)?;
        if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
            pool.get()?.execute(
                "UPDATE invoices SET sync_status = 'SYNCED', synced_at = ?1
                  WHERE id = ?2",
                params![Utc::now().to_rfc3339(), id],
            )?;
        }
    }
    Ok(())
}

fn mark_failure(pool: &DbPool, item: &OutboxItem, err: &str) -> AppResult<()> {
    // Backoff exponencial: 1m, 5m, 30m, 2h, 12h, 1d
    let delays_min = [1, 5, 30, 120, 720, 1440];
    let idx = (item.attempts as usize).min(delays_min.len() - 1);
    let next = Utc::now() + chrono::Duration::minutes(delays_min[idx]);

    pool.get()?.execute(
        "UPDATE sync_outbox
            SET status = 'FAILED',
                attempts = attempts + 1,
                last_error = ?1,
                next_retry_at = ?2
          WHERE id = ?3",
        params![err, next.to_rfc3339(), item.id],
    )?;

    if item.kind == "INVOICE_PUSH" {
        let payload: Value = serde_json::from_str(&item.payload)?;
        if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
            // Si falla 6+ veces, marcamos CONFLICT (requiere intervención)
            let new_status = if item.attempts + 1 >= 6 { "CONFLICT" } else { "PENDING" };
            pool.get()?.execute(
                "UPDATE invoices SET sync_status = ?1, sync_error = ?2
                  WHERE id = ?3",
                params![new_status, err, id],
            )?;
        }
    }
    Ok(())
}

fn count_pending(pool: &DbPool) -> AppResult<i64> {
    let n: i64 = pool.get()?.query_row(
        "SELECT COUNT(*) FROM sync_outbox
          WHERE status IN ('PENDING','FAILED')",
        [], |r| r.get(0),
    )?;
    Ok(n)
}

// ---------------------------------------------------------------------
// Push: envía UN item a Supabase
// ---------------------------------------------------------------------

async fn push_one(http: &reqwest::Client, cfg: &SyncConfig, item: &OutboxItem) -> AppResult<()> {
    let (table, body) = match item.kind.as_str() {
        "INVOICE_PUSH" => ("invoices", item.payload.clone()),
        "ORDER_PUSH"   => ("orders",   item.payload.clone()),
        other => return Err(AppError::Validation(format!("kind desconocido: {}", other))),
    };

    let url = format!("{}/rest/v1/{}", cfg.supabase_url, table);
    let res = http.post(&url)
        .header("apikey", &cfg.supabase_key)
        .header("Authorization", format!("Bearer {}", cfg.supabase_key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=ignore-duplicates")
        .body(body)
        .send().await?;

    if !res.status().is_success() {
        let status = res.status();
        let txt = res.text().await.unwrap_or_default();
        return Err(AppError::Conflict(format!("HTTP {}: {}", status, txt)));
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Pull: trae la carta desde la nube
// ---------------------------------------------------------------------

async fn pull_menu(http: &reqwest::Client, cfg: &SyncConfig, pool: &DbPool) -> AppResult<()> {
    // Estrategia: si hay al menos una categoría local, no tocamos.
    // Si no hay nada, descargamos el menú del tenant.
    let count: i64 = pool.get()?.query_row(
        "SELECT COUNT(*) FROM categories", [], |r| r.get(0),
    )?;
    if count > 0 {
        return Ok(());  // el local ya tiene datos
    }

    let url = format!(
        "{}/rest/v1/categories?select=id,name,sort_order,products(id,name,description,price,tax_rate)",
        cfg.supabase_url
    );
    let res = http.get(&url)
        .header("apikey", &cfg.supabase_key)
        .header("Authorization", format!("Bearer {}", cfg.supabase_key))
        .send().await?;
    if !res.status().is_success() {
        return Err(AppError::Validation(format!("Pull menu: HTTP {}", res.status())));
    }
    let cats: Value = res.json().await?;

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    if let Some(arr) = cats.as_array() {
        for cat in arr {
            let id   = cat["id"].as_str().unwrap_or_default().to_string();
            let name = cat["name"].as_str().unwrap_or_default().to_string();
            let sort = cat["sort_order"].as_i64().unwrap_or(0);
            tx.execute(
                "INSERT OR IGNORE INTO categories (id, name, sort_order)
                 VALUES (?1,?2,?3)",
                params![id, name, sort],
            )?;
            if let Some(prods) = cat["products"].as_array() {
                for p in prods {
                    let pid  = p["id"].as_str().unwrap_or_default().to_string();
                    let pname = p["name"].as_str().unwrap_or_default().to_string();
                    let desc = p["description"].as_str().unwrap_or_default().to_string();
                    let price = p["price"].as_f64().unwrap_or(0.0);
                    let tax  = p["tax_rate"].as_f64().unwrap_or(10.0);
                    tx.execute(
                        "INSERT OR IGNORE INTO products
                            (id, name, description, price, tax_rate, is_available)
                         VALUES (?1,?2,?3,?4,?5,1)",
                        params![pid, pname, desc, price, tax],
                    )?;
                }
            }
        }
    }
    tx.commit()?;
    Ok(())
}
