// =====================================================================
// MOZONA TPV — /api/_env (helper)
// =====================================================================
// Centraliza la lectura de variables de entorno con valores por defecto.
// Asi, si las env vars NO estan configuradas en Vercel, las funciones
// siguen funcionando con valores razonables para que el sitio no se caiga.
// =====================================================================

// ★ SUPABASE — v4.6.0: sin secretos embebidos. Deben venir de env.
//   (Evita fijar accidentalmente un proyecto/credencial en el código.)
const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";

const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "";

// ★ SUPABASE SERVICE ROLE - SOLO usar en backend. Si no esta configurada,
// las funciones que la requieren devuelven ok=false con mensaje claro.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ★ TELEGRAM - opcional
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID || "";

// ★ v4.6.0 — secreto del webhook de Telegram (cabecera
//   X-Telegram-Bot-Api-Secret-Token). Si está definido, el webhook rechaza
//   cualquier update que no lo traiga. Recomendado en producción.
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

// ★ v4.6.0 — secreto compartido para autorizar /api/send-notification
//   (cabecera x-service-secret). Sustituye al relay abierto.
const NOTIFY_SERVICE_SECRET = process.env.NOTIFY_SERVICE_SECRET || "";

// ★ EMAIL RELAY - opcional, si no esta usa el corporativo
const EMAIL_RELAY_URL    = (process.env.EMAIL_RELAY_URL || "https://mail.mozonatpv.com").replace(/\/$/, "");
const EMAIL_RELAY_SECRET = process.env.EMAIL_RELAY_SECRET || "";
const EMAIL_FROM_NAME    = process.env.EMAIL_FROM_NAME || "Mozona TPV - Seguridad";
const EMAIL_FROM_ADDR    = process.env.EMAIL_FROM_ADDR || "seguridad@mozonatpv.com";

// ★ WHATSAPP RELAY - opcional
const WHATSAPP_RELAY_URL = (process.env.WHATSAPP_RELAY_URL || "https://wa.mozonatpv.com").replace(/\/$/, "");

// ★ AI BACKEND - opcional (si no esta, la IA funciona via SQL nativo)
const AI_BACKEND_URL = (process.env.AI_BACKEND_URL || "https://ai.mozonatpv.com").replace(/\/$/, "");

// ★ SUPERADMIN — allowlist de emails con acceso al panel de administración.
//   Coma-separado. v4.6.0: sustituye a los tokens estáticos retirados.
const SUPERADMIN_EMAILS = process.env.SUPERADMIN_EMAILS || process.env.SUPERADMIN_EMAIL || "rofixinsta@gmail.com";

// ★ HELPERS
function has(name) {
    return !!process.env[name];
}

function status() {
    return {
        SUPABASE_URL:              !!SUPABASE_URL,
        SUPABASE_ANON_KEY:         !!SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
        TELEGRAM_BOT_TOKEN:        !!TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID:          !!TELEGRAM_CHAT_ID,
        TELEGRAM_WEBHOOK_SECRET:   !!TELEGRAM_WEBHOOK_SECRET,
        NOTIFY_SERVICE_SECRET:     !!NOTIFY_SERVICE_SECRET,
        EMAIL_RELAY_URL:           !!EMAIL_RELAY_URL,
        WHATSAPP_RELAY_URL:        !!WHATSAPP_RELAY_URL,
        AI_BACKEND_URL:            !!AI_BACKEND_URL,
    };
}

module.exports = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TELEGRAM_WEBHOOK_SECRET,
    NOTIFY_SERVICE_SECRET,
    EMAIL_RELAY_URL,
    EMAIL_RELAY_SECRET,
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDR,
    WHATSAPP_RELAY_URL,
    AI_BACKEND_URL,
    SUPERADMIN_EMAILS,
    has,
    status,
};
