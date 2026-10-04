// =====================================================================
// MOZONA TPV — /api/create-user (v3.1.0)
// =====================================================================
// Crea un usuario en Supabase Auth con email_confirm: true.
// Acceso: header x-admin-email o ?token=mozona-create-2025
// =====================================================================

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js");
const ENV = require("./_env.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

const SUPERADMIN_EMAIL = "rofixinsta@gmail.com";
const VALID_TOKENS = new Set(["mozona-create-2025", "mozona-approve-2025", "mozona-ryad-2025"]);

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://mozonatpv.vercel.app", "http://localhost:5173"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-email");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        // ★ Verificar autorización
        const adminEmail = (req.headers && req.headers["x-admin-email"] || "").toString().toLowerCase();
        const token = (req.query && req.query.token || "").toString();
        if (adminEmail !== SUPERADMIN_EMAIL && !VALID_TOKENS.has(token)) {
            return safeJson(200, { ok: false, error: "No autorizado" });
        }

        // ★ Parsear body
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }

        const email = (body.email || "").toString().trim().toLowerCase();
        const password = (body.password || "").toString();
        const name = (body.name || "").toString().trim();

        if (!email || !password) {
            return safeJson(200, { ok: false, error: "email y password son obligatorios" });
        }

        // ★ Validar formato email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return safeJson(200, { ok: false, error: "Formato de email inválido" });
        }

        if (password.length < 6) {
            return safeJson(200, { ok: false, error: "La contraseña debe tener al menos 6 caracteres" });
        }

        // ★ Configurar Supabase
        // ⚠️ Usar SOLO VITE_SUPABASE_URL (validada en consola, dominio correcto)
        //    NO usar SUPABASE_URL sin prefijo porque puede estar mal configurada
        const supabaseUrl = (ENV.SUPABASE_URL || "").replace(/\/$/, "");
        const serviceKey  = ENV.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !serviceKey) {
            return safeJson(200, {
                ok: false,
                error: "Sistema no configurado. SUPABASE_SERVICE_ROLE_KEY requerida.",
                manualInstructions: {
                    step1: "Ve a https://supabase.com/dashboard",
                    step2: "Authentication → Users → Add user",
                    step3: `Email: ${email}, Password: ${password}, Auto Confirm: ON`,
                    step4: "Click 'Create user'",
                },
            });
        }

        const headers = {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
        };

        // ★ Buscar si ya existe
        let existingUser = null;
        try {
            console.log("[create-user] buscando user existente...");
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 15000);
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`, {
                headers,
                signal: controller.signal,
            });
            clearTimeout(tid);
            console.log("[create-user] buscar status:", r.status);
            if (r.ok) {
                const data = await r.json();
                const users = data?.users || data || [];
                if (Array.isArray(users)) {
                    existingUser = users.find(u => (u.email || "").toLowerCase() === email);
                    console.log("[create-user] user existe:", !!existingUser);
                }
            }
        } catch (e) {
            console.log("[create-user] buscar error:", e?.message);
            return safeJson(200, {
                ok: false,
                error: `Error buscando: ${e?.message || "fetch failed"}. SUPABASE_URL=${supabaseUrl}, SERVICE_KEY length=${serviceKey.length}`,
            });
        }

        if (existingUser) {
            // ★ Actualizar password y email_confirm
            try {
                const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existingUser.id}`, {
                    method: "PUT",
                    headers,
                    body: JSON.stringify({
                        password,
                        email_confirm: true,
                        user_metadata: { name, ...(existingUser.user_metadata || {}) },
                    }),
                });
                if (r.ok) {
                    const data = await r.json();
                    return safeJson(200, {
                        ok: true,
                        userId: existingUser.id,
                        email,
                        alreadyExisted: true,
                        emailConfirmed: true,
                        message: "Usuario ya existía. Password actualizado y email confirmado.",
                    });
                }
                const err = await r.text().catch(() => "");
                return safeJson(200, { ok: false, error: `Error actualizando: ${err.slice(0, 200)}` });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ★ Crear nuevo
        try {
            const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: { name },
                }),
            });
            if (r.ok) {
                const data = await r.json();
                return safeJson(200, {
                    ok: true,
                    userId: data?.id || data?.user?.id,
                    email,
                    alreadyExisted: false,
                    emailConfirmed: true,
                    message: "Usuario creado y email confirmado. Ya puede hacer login.",
                });
            }
            const err = await r.text().catch(() => "");
            return safeJson(200, { ok: false, error: `Error creando: ${err.slice(0, 200)}` });
        } catch (e) {
            return safeJson(200, { ok: false, error: e?.message });
        }
    } catch (e) {
        return safeJson(200, { ok: false, error: e?.message });
    }
};
