// =====================================================================
// MOZONA TPV — /api/_env (helper)
// =====================================================================
// Centraliza la lectura de variables de entorno con valores por defecto.
// Asi, si las env vars NO estan configuradas en Vercel, las funciones
// siguen funcionando con valores razonables para que el sitio no se caiga.
// =====================================================================

// ★ SUPABASE - valores publicos del frontend
const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "https://hcqkpokodrqimkulporw.supabase.co";

const SUPABASE_ANON_KEY =
    process.env.VITE_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcWtwb2tvZHJxaW1rdWxwb3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzM3NzI5NjAsImV4cCI6MjA0OTM0ODk2MH0.JK1S_wqIUVGcj9Z4yJ8rAaPmm9oW7Y1f4Z7X0hAaPgg";

// ★ SUPABASE SERVICE ROLE - SOLO usar en backend. Si no esta configurada,
// las funciones que la requieren devuelven ok=false con mensaje claro.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ★ TELEGRAM - opcional
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID || "";

// ★ EMAIL RELAY - opcional, si no esta usa el corporativo
const EMAIL_RELAY_URL    = (process.env.EMAIL_RELAY_URL || "https://mail.mozonatpv.com").replace(/\/$/, "");
const EMAIL_RELAY_SECRET = process.env.EMAIL_RELAY_SECRET || "";
const EMAIL_FROM_NAME    = process.env.EMAIL_FROM_NAME || "Mozona TPV - Seguridad";
const EMAIL_FROM_ADDR    = process.env.EMAIL_FROM_ADDR || "seguridad@mozonatpv.com";

// ★ WHATSAPP RELAY - opcional
const WHATSAPP_RELAY_URL = (process.env.WHATSAPP_RELAY_URL || "https://wa.mozonatpv.com").replace(/\/$/, "");

// ★ AI BACKEND - opcional (si no esta, la IA funciona via SQL nativo)
const AI_BACKEND_URL = (process.env.AI_BACKEND_URL || "https://ai.mozonatpv.com").replace(/\/$/, "");

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
    EMAIL_RELAY_URL,
    EMAIL_RELAY_SECRET,
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDR,
    WHATSAPP_RELAY_URL,
    AI_BACKEND_URL,
    has,
    status,
};
