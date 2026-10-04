// =====================================================================
// MOZONA TPV — /api/admin (v3.1.4)
// =====================================================================
// Panel de control completo del superadmin.
// Acceso: header x-admin-email: rofixinsta@gmail.com O ?token=mozona-admin-2025
// =====================================================================

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js");
const ENV = require("./_env.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

const SUPERADMIN_EMAIL = "rofixinsta@gmail.com";
const VALID_TOKENS = new Set([
    "mozona-admin-2025",
    "mozona-approve-2025",
    "mozona-create-2025",
    "mozona-ryad-2025",
]);

function isAuthorized(req) {
    const adminEmail = (req.headers && req.headers["x-admin-email"] || "").toString().toLowerCase();
    const token = (req.query && req.query.token || "").toString();
    if (adminEmail === SUPERADMIN_EMAIL) return true;
    if (VALID_TOKENS.has(token)) return true;
    // ★ También aceptar Bearer token del usuario Supabase autenticado
    const auth = (req.headers && req.headers.authorization || "").toString();
    return false;
}

const supabaseFetch = async (path, options = {}, supabaseUrl, apiKey) => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    try {
        const r = await fetch(`${supabaseUrl}${path}`, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
};

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://mozonatpv.vercel.app", "http://localhost:5173"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-email, Authorization");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    // ★ Verificar autorización
    if (!isAuthorized(req)) {
        return safeJson(200, { ok: false, error: "No autorizado" });
    }

    // ★ Configurar Supabase
    const supabaseUrl = (ENV.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/$/, "");
    const serviceKey  = ENV.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !serviceKey) {
        return safeJson(200, {
            ok: false,
            error: "Sistema no configurado (SUPABASE_URL o SERVICE_ROLE_KEY faltan)",
        });
    }

    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
    };

    try {
        // ★ Parsear body
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }

        // ★ Determinar acción por método + path/param
        const action = (body.action || req.query?.action || "").toString();
        const tenantId = (body.tenantId || req.query?.tenantId || "").toString();
        const email = (body.email || "").toString().trim().toLowerCase();
        const userId = (body.userId || "").toString();

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: list — listar todos los tenants
        // ════════════════════════════════════════════════════
        if (action === "list" || (!action && req.method === "GET")) {
            const status = (req.query?.status || "").toString();
            const search = (req.query?.search || "").toString();
            let path = `/rest/v1/tenants?select=*&order=created_at.desc&limit=100`;
            if (status) path += `&activation_status=eq.${status}`;
            if (search) path += `&or=(name.ilike.*${encodeURIComponent(search)}*,contact_email.ilike.*${encodeURIComponent(search)}*,business_name.ilike.*${encodeURIComponent(search)}*)`;

            const r = await supabaseFetch(path, { headers }, supabaseUrl, serviceKey);
            if (!r.ok) {
                const err = await r.text().catch(() => "");
                return safeJson(200, { ok: false, error: `HTTP ${r.status}: ${err.slice(0, 200)}` });
            }
            const arr = await r.json();
            return safeJson(200, { ok: true, tenants: arr, count: arr?.length || 0 });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: get — obtener un tenant específico
        // ════════════════════════════════════════════════════
        if (action === "get") {
            if (!tenantId && !email) {
                return safeJson(200, { ok: false, error: "tenantId o email requerido" });
            }
            let path;
            if (tenantId) {
                path = `/rest/v1/tenants?id=eq.${tenantId}&select=*&limit=1`;
            } else {
                path = `/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=*&limit=1`;
            }
            const r = await supabaseFetch(path, { headers }, supabaseUrl, serviceKey);
            if (!r.ok) return safeJson(200, { ok: false, error: `HTTP ${r.status}` });
            const arr = await r.json();
            return safeJson(200, { ok: true, tenant: arr?.[0] || null });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: approve — aprobar tenant
        // ════════════════════════════════════════════════════
        if (action === "approve") {
            if (!tenantId && !email) {
                return safeJson(200, { ok: false, error: "tenantId o email requerido" });
            }
            // Resolver tenantId
            let targetId = tenantId;
            if (!targetId && email) {
                const r = await supabaseFetch(
                    `/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
                    { headers }, supabaseUrl, serviceKey
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr?.[0]) targetId = arr[0].id;
                }
            }
            if (!targetId) {
                return safeJson(200, { ok: false, error: "Tenant no encontrado" });
            }

            const trialDays = parseInt(body.trialDays || "7", 10);
            const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
            const plan = (body.plan || "active_trial").toString();
            const newStatus = plan === "vip" ? "vip" : (plan === "active" ? "active" : "active_trial");

            const r = await supabaseFetch(
                `/rest/v1/tenants?id=eq.${targetId}`,
                {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({
                        activation_status: newStatus,
                        plan: plan === "vip" ? "vip" : (body.plan || "plus_30"),
                        plan_selected: body.plan || "plus_30",
                        approved_at: new Date().toISOString(),
                        approved_by: SUPERADMIN_EMAIL,
                        trial_ends_at: newStatus === "active_trial" ? trialEndsAt : null,
                        updated_at: new Date().toISOString(),
                    }),
                }, supabaseUrl, serviceKey
            );
            if (!r.ok) return safeJson(200, { ok: false, error: await r.text().catch(() => "error") });
            const updated = await r.json();
            return safeJson(200, { ok: true, tenant: updated?.[0], trialEndsAt, status: newStatus });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: change-plan — cambiar plan
        // ════════════════════════════════════════════════════
        if (action === "change-plan") {
            if (!tenantId) {
                return safeJson(200, { ok: false, error: "tenantId requerido" });
            }
            const newPlan = (body.plan || "").toString();
            if (!newPlan) {
                return safeJson(200, { ok: false, error: "plan requerido" });
            }
            const r = await supabaseFetch(
                `/rest/v1/tenants?id=eq.${tenantId}`,
                {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({
                        plan: newPlan,
                        plan_selected: newPlan,
                        updated_at: new Date().toISOString(),
                    }),
                }, supabaseUrl, serviceKey
            );
            if (!r.ok) return safeJson(200, { ok: false, error: await r.text().catch(() => "error") });
            return safeJson(200, { ok: true, message: `Plan cambiado a ${newPlan}` });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: edit — editar datos del tenant
        // ════════════════════════════════════════════════════
        if (action === "edit") {
            if (!tenantId) {
                return safeJson(200, { ok: false, error: "tenantId requerido" });
            }
            const updates = {};
            if (body.name) updates.name = body.name;
            if (body.businessName || body.business_name) updates.business_name = body.businessName || body.business_name;
            if (body.businessType || body.business_type) updates.business_type = body.businessType || body.business_type;
            if (body.contactEmail || body.contact_email) updates.contact_email = body.contactEmail || body.contact_email;
            if (body.restaurantPhone || body.restaurant_phone) updates.restaurant_phone = body.restaurantPhone || body.restaurant_phone;
            if (body.restaurantAddress || body.restaurant_address) updates.restaurant_address = body.restaurantAddress || body.restaurant_address;
            updates.updated_at = new Date().toISOString();

            if (Object.keys(updates).length === 1) {
                return safeJson(200, { ok: false, error: "No hay cambios" });
            }

            const r = await supabaseFetch(
                `/rest/v1/tenants?id=eq.${tenantId}`,
                {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify(updates),
                }, supabaseUrl, serviceKey
            );
            if (!r.ok) return safeJson(200, { ok: false, error: await r.text().catch(() => "error") });
            return safeJson(200, { ok: true, message: "Datos actualizados" });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: reset-password — resetear password de un user
        // ════════════════════════════════════════════════════
        if (action === "reset-password") {
            if (!userId && !email) {
                return safeJson(200, { ok: false, error: "userId o email requerido" });
            }
            const newPassword = (body.newPassword || "").toString();
            if (newPassword.length < 6) {
                return safeJson(200, { ok: false, error: "newPassword debe tener al menos 6 caracteres" });
            }

            // Resolver userId si solo tenemos email
            let targetUserId = userId;
            if (!targetUserId && email) {
                const r = await supabaseFetch(
                    `/auth/v1/admin/users?page=1&per_page=100`,
                    { headers }, supabaseUrl, serviceKey
                );
                if (r.ok) {
                    const data = await r.json();
                    const users = data?.users || data || [];
                    if (Array.isArray(users)) {
                        const found = users.find(u => (u.email || "").toLowerCase() === email);
                        if (found) targetUserId = found.id;
                    }
                }
            }

            if (!targetUserId) {
                return safeJson(200, { ok: false, error: "User no encontrado" });
            }

            const r = await supabaseFetch(
                `/auth/v1/admin/users/${targetUserId}`,
                {
                    method: "PUT",
                    headers,
                    body: JSON.stringify({ password: newPassword, email_confirm: true }),
                }, supabaseUrl, serviceKey
            );
            if (!r.ok) return safeJson(200, { ok: false, error: await r.text().catch(() => "error") });
            return safeJson(200, { ok: true, userId: targetUserId, message: "Password actualizado y email confirmado" });
        }

        // ════════════════════════════════════════════════════
        // ★ ACCIÓN: stats — estadísticas generales
        // ════════════════════════════════════════════════════
        if (action === "stats") {
            const allR = await supabaseFetch(`/rest/v1/tenants?select=activation_status,plan`, { headers }, supabaseUrl, serviceKey);
            if (!allR.ok) return safeJson(200, { ok: false, error: "Error" });
            const all = await allR.json();
            const stats = {
                total: all.length,
                pending: all.filter(t => t.activation_status === "pending_activation").length,
                trial: all.filter(t => t.activation_status === "active_trial").length,
                active: all.filter(t => t.activation_status === "active").length,
                vip: all.filter(t => t.activation_status === "vip").length,
                expired: all.filter(t => t.activation_status === "expired").length,
            };
            return safeJson(200, { ok: true, stats });
        }

        return safeJson(200, { ok: false, error: "Acción no reconocida. Usa: list, get, approve, change-plan, edit, reset-password, stats" });
    } catch (e) {
        return safeJson(200, { ok: false, error: e?.message || String(e) });
    }
};
