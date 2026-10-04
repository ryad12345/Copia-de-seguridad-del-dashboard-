// =====================================================================
// MOZONA TPV — /api/approve-tenant (v3.0.6 — fetch puro, sin supabase-js)
// =====================================================================
// Aprueba un tenant y le concede 7 días de trial. Solo fetch directo.
// =====================================================================

const ENV = require("./_env.js");
const AUTH = require("./_auth.js");
const { rateLimit, getClientIp } = require("./_rateLimit.js");

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
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    // ★ Rate limit por IP
    const rl = rateLimit(`approve-tenant:${getClientIp(req)}`, 30, 60_000);
    if (!rl.allowed) {
        return safeJson(429, { ok: false, error: "Demasiadas peticiones. Reintenta en un minuto." });
    }

    try {
        // Verificar autorización SERVER-SIDE (JWT + allowlist de superadmin)
        const authCheck = await AUTH.requireSuperadmin(req);
        if (!authCheck.ok) {
            return safeJson(authCheck.status, { ok: false, error: authCheck.error });
        }

        // Parsear body
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }
        const tenantId = (body.tenantId || req.query?.tenantId || "").toString();
        const email    = (body.email    || req.query?.email    || "").toString().trim().toLowerCase();
        const approvedBy = (body.approvedBy || "superadmin").toString();

        if (!tenantId && !email) {
            return safeJson(200, { ok: false, error: "tenantId o email requerido" });
        }

        const supabaseUrl = (ENV.SUPABASE_URL || "").replace(/\/$/, "");
        const serviceKey  = ENV.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !serviceKey) {
            return safeJson(200, { ok: false, error: "Sistema no configurado" });
        }

        const apiKey = serviceKey;
        const useServiceRole = true;
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const headers = {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        };

        // Resolver tenantId
        let targetTenantId = tenantId;
        if (!targetTenantId && email) {
            try {
                const r = await fetch(
                    `${supabaseUrl}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=id,name&limit=1`,
                    { headers }
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr[0]) targetTenantId = arr[0].id;
                }
            } catch (_) {}

            if (!targetTenantId) {
                try {
                    const r = await fetch(`${supabaseUrl}/rest/v1/tenants?order=created_at.desc&limit=5`, { headers });
                    if (r.ok) {
                        const arr = await r.json();
                        const match = arr.find(t => t.contact_email && t.contact_email.toLowerCase() === email);
                        if (match) targetTenantId = match.id;
                        else if (arr[0]) targetTenantId = arr[0].id;
                    }
                } catch (_) {}
            }
        }

        if (!targetTenantId) {
            return safeJson(200, {
                ok: false,
                error: "Tenant no encontrado",
                email,
                manualInstructions: {
                    step1: "Ve a https://supabase.com/dashboard",
                    step2: "Table Editor → tenants",
                    step3: `Busca la fila con contact_email = "${email}"`,
                    step4: "Cambia activation_status a 'active_trial'",
                    step5: `Rellena trial_ends_at con: ${trialEndsAt}`,
                },
            });
        }

        // Actualizar
        const updateBody = {
            activation_status: "active_trial",
            approved_at: new Date().toISOString(),
            approved_by: approvedBy,
            trial_ends_at: trialEndsAt,
            updated_at: new Date().toISOString(),
        };

        let updated = null;
        let updateErr = null;
        try {
            const r = await fetch(
                `${supabaseUrl}/rest/v1/tenants?id=eq.${targetTenantId}`,
                { method: "PATCH", headers, body: JSON.stringify(updateBody) }
            );
            if (r.ok) {
                const arr = await r.json();
                updated = (Array.isArray(arr) ? arr[0] : arr) || { id: targetTenantId, ...updateBody };
            } else {
                updateErr = await r.text().catch(() => "");
            }
        } catch (e) {
            updateErr = e?.message;
        }

        if (updateErr) {
            return safeJson(200, {
                ok: false,
                error: `Error actualizando: ${updateErr.slice(0, 200)}`,
                tenantId: targetTenantId,
                manualInstructions: {
                    step1: "Ve a https://supabase.com/dashboard",
                    step2: "Table Editor → tenants",
                    step3: `Busca la fila con id = "${targetTenantId}"`,
                    step4: "Cambia activation_status a 'active_trial'",
                    step5: `Rellena trial_ends_at con: ${trialEndsAt}`,
                },
            });
        }

        // Notificar al admin
        const BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN || "";
        const CHAT_ID   = ENV.TELEGRAM_CHAT_ID || "";
        if (BOT_TOKEN && CHAT_ID) {
            try {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: CHAT_ID,
                        text: `✅ *Alta aprobada*\n\n🏢 ${updated.name || email}\n🆔 \`${updated.id}\`\n⏰ Trial hasta: ${trialEndsAt.slice(0, 16).replace("T", " ")} UTC\n\n_7 días de prueba activados._`,
                        parse_mode: "Markdown",
                    }),
                });
            } catch (_) {}
        }

        return safeJson(200, {
            ok: true,
            tenant: updated,
            trialEndsAt,
            method: useServiceRole ? "service_role" : "anon_key",
            message: "Alta aprobada, 7 días de trial activados. El usuario puede hacer login ahora.",
        });
    } catch (e) {
        console.error("[approve-tenant] error:", e?.message || e);
        return safeJson(200, { ok: false, error: "Ha ocurrido un error" });
    }
};
