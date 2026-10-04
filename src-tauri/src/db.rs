// =====================================================================
// MOZONA TPV — db.rs: pool SQLite + migrador
// =====================================================================

use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use log::{info, warn};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};

use crate::error::{AppError, AppResult};

/// Tipo de conexión de alto nivel (cheap de clonar).
pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

// ---------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------

pub fn open_pool(db_path: &Path) -> AppResult<DbPool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(db_path)
        .with_init(|c| {
            // WAL = lecturas y escrituras concurrentes sin bloquearse entre sí
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous  = NORMAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 5000;
                 PRAGMA temp_store   = MEMORY;
                 PRAGMA mmap_size    = 268435456;",
            )
        });
    let pool = Pool::builder()
        .max_size(8)
        .connection_timeout(Duration::from_secs(5))
        .build(manager)?;
    Ok(pool)
}

// ---------------------------------------------------------------------
// Migrador
// ---------------------------------------------------------------------

/// Busca archivos `NNN_*.sql` en `migrations/` y aplica los que no
/// estén registrados en la tabla `_migrations`.
pub fn run_migrations(pool: &DbPool, migrations_dir: &Path) -> AppResult<()> {
    let conn = pool.get()?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id          INTEGER PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            applied_at  TEXT NOT NULL
        )",
        [],
    )?;

    let mut stmt = conn.prepare("SELECT name FROM _migrations")?;
    let applied: std::collections::HashSet<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    if !migrations_dir.exists() {
        warn!("No existe el directorio de migraciones: {:?}", migrations_dir);
        return Ok(());
    }

    let mut entries: Vec<PathBuf> = std::fs::read_dir(migrations_dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("sql"))
        .collect();
    entries.sort();

    for path in entries {
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| AppError::Migration("Archivo sin nombre".into()))?
            .to_string();

        if applied.contains(&name) {
            info!("Migración ya aplicada: {}", name);
            continue;
        }

        info!("Aplicando migración: {}", name);
        let sql = std::fs::read_to_string(&path)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(&sql)?;
        tx.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
            params![name, Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        info!("  ✓ {}", name);
    }

    Ok(())
}

// ---------------------------------------------------------------------
// Helpers de uso común
// ---------------------------------------------------------------------

/// Recupera el restaurante por defecto (único en local-first).
pub fn get_default_restaurant(pool: &DbPool) -> AppResult<Option<serde_json::Value>> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, slug, business_name, cif_nif, address, phone,
                    primary_color, ticket_footer_msg, created_at
             FROM restaurants
             ORDER BY created_at ASC
             LIMIT 1",
            [],
            |r| {
                Ok(serde_json::json!({
                    "id":               r.get::<_, String>(0)?,
                    "slug":             r.get::<_, String>(1)?,
                    "business_name":    r.get::<_, String>(2)?,
                    "cif_nif":          r.get::<_, String>(3)?,
                    "address":          r.get::<_, String>(4)?,
                    "phone":            r.get::<_, Option<String>>(5)?,
                    "primary_color":    r.get::<_, String>(6)?,
                    "ticket_footer_msg":r.get::<_, String>(7)?,
                    "created_at":       r.get::<_, String>(8)?,
                }))
            },
        )
        .optional()?;
    Ok(row)
}

/// Test rápido de salud: ¿la DB responde?
pub fn ping(pool: &DbPool) -> AppResult<bool> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row("SELECT 1", [], |r| r.get(0))?;
    Ok(n == 1)
}
