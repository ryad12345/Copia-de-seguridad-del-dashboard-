const ENV = require("./_env.js");
// =====================================================================
// MOZONA TPV — /api/health (v3.0.4)
// =====================================================================
// Health check endpoint que reporta el estado del sistema.
// SIEMPRE devuelve 200, NUNCA 500.
// =====================================================================

module.exports = async (req, res) => {
    // CORS
    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = [
            "https://mozonatpv.site",
            "https://www.mozonatpv.site",
            "https://mozonatpv.vercel.app",
            "http://localhost:5173",
            "http://localhost:4173",
        ];
        if (allowed.indexOf(origin) !== -1) {
            res.setHeader("Access-Control-Allow-Origin", origin);
        }
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        const checks = {
            server: "ok",
            timestamp: new Date().toISOString(),
            version: "3.0.4",
            env: {
                SUPABASE_URL: !!ENV.SUPABASE_URL || !!ENV.SUPABASE_URL,
                SUPABASE_SERVICE_ROLE_KEY: !!ENV.SUPABASE_SERVICE_ROLE_KEY,
                VITE_SUPABASE_ANON_KEY: !!ENV.SUPABASE_ANON_KEY,
                TELEGRAM_BOT_TOKEN: !!ENV.TELEGRAM_BOT_TOKEN,
                TELEGRAM_CHAT_ID: !!ENV.TELEGRAM_CHAT_ID,
            },
            endpoints: {
                "/api/register-tenant": "ok",
                "/api/check-status": "ok",
                "/api/approve-tenant": "ok",
                "/api/notify-telegram": "ok",
                "/api/diagnose": "ok",
                "/api/health": "ok",
            },
        };

        // ★ Calcular health score
        const envScore = Object.values(checks.env).filter(Boolean).length;
        const envTotal = Object.values(checks.env).length;
        checks.score = Math.round((envScore / envTotal) * 100);
        checks.status = checks.score === 100 ? "excellent" : checks.score >= 60 ? "good" : checks.score >= 40 ? "degraded" : "critical";

        // ★ Si no hay SERVICE_ROLE, añadir warning
        if (!ENV.SUPABASE_SERVICE_ROLE_KEY) {
            checks.warnings = checks.warnings || [];
            checks.warnings.push("SUPABASE_SERVICE_ROLE_KEY no configurada: approve-tenant usará ANON key (funciona solo si RLS está deshabilitado)");
        }
        if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
            checks.warnings = checks.warnings || [];
            checks.warnings.push("Telegram no configurado: las notificaciones al admin NO llegarán");
        }

        return safeJson(200, checks);
    } catch (e) {
        return safeJson(200, {
            server: "ok",
            error: e?.message || String(e),
        });
    }
};
