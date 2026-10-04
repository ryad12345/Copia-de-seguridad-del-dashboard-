// =====================================================================
// MOZONA TPV — /api/check-status (v3.0.6 — fetch puro, sin supabase-js)
// =====================================================================
// Polling endpoint para la sala de espera. Solo fetch directo.
// =====================================================================

let _rateLimitLib = undefined;
function getRateLimit() {
    if (_rateLimitLib !== undefined) return _rateLimitLib;
    try { _rateLimitLib = require("./_rateLimit.js");
const ENV = require("./_env.js"); } catch (_) { _rateLimitLib = null; }
    return _rateLimitLib;
}

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

module.exports = async (req, res) => {
    // ★ Headers de seguridad
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    // CORS
    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://mozonatpv.vercel.app", "http://localhost:5173", "http://localhost:4173"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        // ★ Aceptar email por query o body
        let email = "";
        try {
            if (req.query && req.query.email) email = String(req.query.email).trim().toLowerCase();
            else if (req.body) {
                let body = req.body;
                if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }
                email = (body.email || "").toString().trim().toLowerCase();
            }
        } catch (_) {}

        if (!email) return safeJson(200, { ok: false, error: "email required" });

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return safeJson(200, { ok: false, error: "Formato de email inválido" });
        }

        // Rate limit
        const rl = getRateLimit();
        if (rl) {
            const ip = rl.getClientIp(req);
            const limit = rl.rateLimit(`status:${ip}:${email}`, 30, 60 * 1000);
            if (!limit.allowed) {
                return safeJson(200, { ok: false, step: "rate_limit", error: "Demasiadas consultas.", retryAfterMs: limit.resetIn });
            }
        }

        // Configurar Supabase
        const supabaseUrl = ENV.SUPABASE_URL || ENV.SUPABASE_URL || "";
        const serviceKey  = ENV.SUPABASE_SERVICE_ROLE_KEY || "";
        const anonKey     = ENV.SUPABASE_ANON_KEY || "";

        if (!supabaseUrl) {
            return safeJson(200, { ok: true, tenant: null, method: "no_config" });
        }

        const apiKey = serviceKey || anonKey;
        const useServiceRole = !!serviceKey;
        const headers = {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        };

        let tenant = null;
        let userId = null;
        let method = "not_found";

        // ★ Con SERVICE_ROLE: buscar user por email via admin API
        if (useServiceRole) {
            try {
                const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`, { headers });
                if (r.ok) {
                    const data = await r.json();
                    const users = data?.users || data || [];
                    if (Array.isArray(users)) {
                        const user = users.find(u => (u.email || "").toLowerCase() === email);
                        if (user) userId = user.id;
                    }
                }
            } catch (_) {}
        }

        // ★ Buscar tenant (intentar varias estrategias)
        if (userId) {
            // Por owner_id
            try {
                const r = await fetch(
                    `${supabaseUrl}/rest/v1/tenants?owner_id=eq.${userId}&select=*&limit=1`,
                    { headers }
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr[0]) {
                        tenant = arr[0];
                        method = "service_role";
                    }
                }
            } catch (_) {}
        }

        if (!tenant) {
            // Por contact_email
            try {
                const r = await fetch(
                    `${supabaseUrl}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
                    { headers }
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr[0]) {
                        tenant = arr[0];
                        method = "contact_email";
                    }
                }
            } catch (_) {}
        }

        if (!tenant) {
            // Heurística: el más reciente
            try {
                const r = await fetch(
                    `${supabaseUrl}/rest/v1/tenants?select=*&order=created_at.desc&limit=5`,
                    { headers }
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr.length > 0) {
                        const match = arr.find(t => t.contact_email && t.contact_email.toLowerCase() === email);
                        if (match) {
                            tenant = match;
                            method = "heuristic_match";
                        } else {
                            tenant = arr[0];
                            method = "heuristic_recent";
                        }
                    }
                }
            } catch (_) {}
        }

        // Calcular tiempo restante de cortesía
        let graceRemainingMs = 24 * 60 * 60 * 1000;
        if (tenant?.grace_period_ends_at) {
            const end = new Date(tenant.grace_period_ends_at).getTime();
            graceRemainingMs = Math.max(0, end - Date.now());
        }

        return safeJson(200, {
            ok: true,
            tenant,
            userId,
            method,
            graceRemainingMs,
            status: tenant?.activation_status || tenant?.subscription_status || "pending_activation",
        });
    } catch (e) {
        return safeJson(200, { ok: false, error: "Ha ocurrido un error", debug: e?.message });
    }
};
