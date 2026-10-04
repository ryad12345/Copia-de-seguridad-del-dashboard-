// =====================================================================
// MOZONA TPV — Tipos de error
// =====================================================================

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("DB: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Pool: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("Migración: {0}")]
    Migration(String),

    #[error("IO: {0}")]
    Io(#[from] std::io::Error),

    #[error("USB: {0}")]
    Usb(#[from] rusb::Error),

    #[error("Puerto serie: {0}")]
    Serial(#[from] serialport::Error),

    #[error("HTTP: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("VeriFactu: {0}")]
    VeriFactu(String),

    #[error("Validación: {0}")]
    Validation(String),

    #[error("Conflicto: {0}")]
    Conflict(String),

    #[error("Not found: {0}")]
    NotFound(String),
}

pub type AppResult<T> = Result<T, AppError>;

// Conversión a String para Tauri commands (que serializan a JSON en el IPC).
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
