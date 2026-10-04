// =====================================================================
// MOZONA TPV — Constantes globales (v4.0.7)
// =====================================================================
// Centraliza URLs hardcoded, claves, etc.
// =====================================================================

export const SUPABASE_URL =
    (import.meta.env.VITE_SUPABASE_URL as string) || "https://hcqkpokodrqimkulporw.supabase.co";

export const SUPABASE_ANON_KEY =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "sb_publishable_9kWDFdbRaIuTrc1HSzpr3Q_0e6vfoO2";

export const TELEGRAM_BOT_USERNAME = "Mozonatpvbot";

// ★ v4.0.7: TELEGRAM_BOT_TOKEN y CHAT_ID son solo referenciales.
//    El envio real se hace via Edge Function o via api.telegram.org con el token
//    que se inyecta en runtime. NUNCA hardcodear secrets en el bundle.
export const TELEGRAM_ADMIN_CHAT_ID = "6899028846";
