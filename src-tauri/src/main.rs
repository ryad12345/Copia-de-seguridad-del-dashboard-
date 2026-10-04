// =====================================================================
// MOZONA TPV — main.rs: entry point del binario
// =====================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod error;
mod network;
mod printer;
mod sync;
mod verifactu;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crate::db::DbPool;
use crate::network::AppState;
use crate::printer::PrinterState;
use crate::sync::SyncState;

const DEFAULT_LAN_PORT: u16 = 7421;

fn main() {
    // Carga .env si existe (desarrollo)
    let _ = dotenvy::dotenv();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // ------------------------------------------------------------
            // 1) DB local (SQLite) en el directorio de datos de la app
            // ------------------------------------------------------------
            let data_dir = app.path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {}", e))?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("mozona.db");

            log::info!("DB local en: {}", db_path.display());

            let pool = db::open_pool(&db_path)
                .map_err(|e| format!("open_pool: {}", e))?;

            let migrations = migrations_dir();
            db::run_migrations(&pool, &migrations)
                .map_err(|e| format!("migrations: {}", e))?;

            // ------------------------------------------------------------
            // 2) Estado de la impresora
            // ------------------------------------------------------------
            let printer = Arc::new(PrinterState::new());

            // ------------------------------------------------------------
            // 3) Estado de la red LAN (servidor HTTP/WS)
            // ------------------------------------------------------------
            let port = std::env::var("MOZONA_LAN_PORT")
                .ok().and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_LAN_PORT);
            let api_key = std::env::var("MOZONA_LAN_KEY").unwrap_or_default();
            let local_ip = network::detect_local_ip();
            let (events_tx, _rx) = tokio::sync::broadcast::channel(128);

            let net_state = AppState {
                pool:         pool.clone(),
                api_key:      Arc::new(api_key),
                events_tx,
                local_ip:     Arc::new(local_ip.clone()),
                port,
            };
            app.manage(net_state.clone());

            // Lanza el servidor LAN en background
            let net_state_clone = net_state.clone();
            tokio::spawn(async move {
                if let Err(e) = network::serve_with_state(net_state_clone).await {
                    log::error!("Servidor LAN: {}", e);
                }
            });

            log::info!("✓ LAN server: http://{}:{}", local_ip, port);

            // ------------------------------------------------------------
            // 4) Estado de sincronización con Supabase
            // ------------------------------------------------------------
            let sync_cfg = sync::SyncConfig::default();
            let sync_state = Arc::new(SyncState::new(pool.clone(), sync_cfg));
            app.manage(sync_state.clone());

            // Worker de sync en background
            let sync_worker = sync_state.clone();
            tokio::spawn(async move {
                sync::run_worker(sync_worker).await;
            });

            // ------------------------------------------------------------
            // 5) Registra el resto de estados en Tauri
            // ------------------------------------------------------------
            app.manage(pool);
            app.manage(printer);

            log::info!("MOZONA TPV arrancado");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // DB
            commands::db_ping,
            commands::db_get_default_restaurant,
            // PRINTER
            commands::printer_list_available,
            commands::printer_connect,
            commands::printer_disconnect,
            commands::printer_status,
            commands::printer_write_raw,
            commands::printer_open_cash_drawer,
            commands::printer_init,
            // VERIFACTU
            commands::verifactu_issue_invoice,
            commands::verifactu_chain_status,
            // LAN
            commands::network_get_info,
            // SYNC
            commands::sync_get_status,
            commands::sync_configure,
            commands::sync_trigger_now,
        ])
        .run(tauri::generate_context!())
        .expect("Error arrancando Tauri");
}

fn migrations_dir() -> PathBuf {
    // En dev: src-tauri/migrations
    // En release: el bundle incluye estos archivos relativos al binario
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("migrations");
            if p.exists() { return p; }
        }
    }
    PathBuf::from("./migrations")
}
