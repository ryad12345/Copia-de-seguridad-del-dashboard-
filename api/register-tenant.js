// =====================================================================
// MOZONA TPV — /api/register-tenant (v3.3.0 — atómico con rollback)
// =====================================================================
// REGISTRO ATÓMICO con rollback:
//   1) Crear user con email_confirm=true
//   2) Crear tenant con owner_id=userId
//   3) Si tenant falla → DELETE user (rollback)
//   4) Telegram SOLO con tenantId real
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

function escapeMd(s) {
    if (!s) return "";
    return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&").slice(0, 200);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        return { ok: false, status: 0, _error: e?.message || "fetch failed" };
    }
}

async function sendTelegram(botToken, chatId, text, inlineKeyboard) {
    if (!botToken || !chatId) return;
    try {
        const body = {
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
        };
        if (inlineKeyboard) body.reply_markup = inlineKeyboard;
        await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }, 8000);
    } catch (_) {}
}

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://mozonatpv.vercel.app", "http://localhost:5173", "http://localhost:4173"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") return res.status(200).end();
        if (req.method !== "POST") return res.status(200).json({ ok: false, error: "Method not allowed" });
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        // Parsear body
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }
        const email = (body.email || "").toString().trim().toLowerCase();
        const password = (body.password || "").toString();
        const name = (body.name || body.businessName || "").toString().trim();
        const plan = (body.plan || "basic").toString();
        const businessType = (body.businessType || "").toString().trim();

        // Validaciones
        if (!email || !password) {
            return safeJson(200, { ok: false, step: "validation", error: "Email y contraseña son obligatorios" });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return safeJson(200, { ok: false, step: "validation", error: "Formato de email inválido" });
        }
        if (password.length < 6) {
            return safeJson(200, { ok: false, step: "validation", error: "La contraseña debe tener al menos 6 caracteres" });
        }

        // Rate limit
        const rl = getRateLimit();
        if (rl) {
            const ip = rl.getClientIp(req);
            const limit = rl.rateLimit(`register:${ip}`, 5, 10 * 60 * 1000);
            if (!limit.allowed) {
                return safeJson(200, { ok: false, step: "rate_limit", error: "Demasiados intentos. Espera unos minutos." });
            }
        }

        // Configurar Supabase
        const supabaseUrl = (ENV.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/$/, "");
        const serviceKey = ENV.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !serviceKey) {
            return safeJson(200, {
                ok: false,
                step: "config",
                error: "Sistema no configurado. El admin procesará tu solicitud.",
                message: "Hemos recibido tu solicitud. Te contactaremos en breve.",
            });
        }

        const headers = {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        };

        const gracePeriodEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // ════════════════════════════════════════════════════
        // PASO 1: Verificar/crear user
        // ════════════════════════════════════════════════════
        let userId = null;
        let userAlreadyExisted = false;

        try {
            const r = await fetchWithTimeout(
                `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`,
                { headers }, 15000
            );
            if (r.ok) {
                const data = await r.json();
                const users = data?.users || data || [];
                if (Array.isArray(users)) {
                    const existing = users.find(u => (u.email || "").toLowerCase() === email);
                    if (existing) {
                        userId = existing.id;
                        userAlreadyExisted = true;
                        // Actualizar password
                        await fetchWithTimeout(
                            `${supabaseUrl}/auth/v1/admin/users/${userId}`,
                            { method: "PUT", headers, body: JSON.stringify({ password, email_confirm: true }) },
                            10000
                        );
                    }
                }
            }
        } catch (_) {}

        if (!userId) {
            const r = await fetchWithTimeout(`${supabaseUrl}/auth/v1/admin/users`, {
                method: "POST", headers,
                body: JSON.stringify({
                    email, password, email_confirm: true,
                    user_metadata: { name, plan, businessType },
                }),
            }, 15000);

            if (r.ok) {
                const data = await r.json();
                userId = data?.id || data?.user?.id;
            } else {
                let errText = "";
                try { errText = await r.text(); } catch (_) {}
                return safeJson(200, {
                    ok: false,
                    step: "user_creation",
                    error: errText.slice(0, 300) || "No se pudo crear el usuario",
                });
            }
        }

        if (!userId) {
            return safeJson(200, { ok: false, step: "user_creation", error: "No se obtuvo userId" });
        }

        // ════════════════════════════════════════════════════
        // PASO 2: Verificar si ya existe tenant
        // ════════════════════════════════════════════════════
        let tenantId = null;

        try {
            const r = await fetchWithTimeout(
                `${supabaseUrl}/rest/v1/tenants?owner_id=eq.${userId}&select=id&limit=1`,
                { headers }, 10000
            );
            if (r.ok) {
                const arr = await r.json();
                if (arr && arr[0]) tenantId = arr[0].id;
            }
        } catch (_) {}

        // ════════════════════════════════════════════════════
        // PASO 3: Crear tenant (si no existe)
        // ════════════════════════════════════════════════════
        if (!tenantId) {
            const tenantBody = {
                owner_id: userId,
                name: name || email.split("@")[0],
                contact_email: email,
                business_name: name || email.split("@")[0],
                business_type: businessType || null,
                plan_selected: plan,
                plan: plan,
                activation_status: "pending_activation",
                grace_period_ends_at: gracePeriodEndsAt,
                subscription_status: "active",
                updated_at: new Date().toISOString(),
            };

            const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/tenants`, {
                method: "POST", headers, body: JSON.stringify(tenantBody),
            }, 15000);

            if (r.ok) {
                const arr = await r.json();
                tenantId = (Array.isArray(arr) ? arr[0] : arr)?.id || null;
            } else {
                let errText = "";
                try { errText = await r.text(); } catch (_) {}

                // ★ ROLLBACK: borrar user para evitar estado huérfano
                if (!userAlreadyExisted) {
                    try {
                        await fetchWithTimeout(
                            `${supabaseUrl}/auth/v1/admin/users/${userId}`,
                            { method: "DELETE", headers },
                            10000
                        );
                        console.log("[register-tenant] rollback: user deleted", userId);
                    } catch (e) {
                        console.warn("[register-tenant] rollback failed:", e?.message);
                    }
                }

                return safeJson(200, {
                    ok: false,
                    step: "tenant_creation",
                    error: errText.slice(0, 300),
                    userId,
                    message: "No se pudo crear el tenant. Inténtalo de nuevo.",
                });
            }
        }

        if (!tenantId) {
            return safeJson(200, { ok: false, step: "tenant_id_missing", error: "No se obtuvo tenantId" });
        }

        // ════════════════════════════════════════════════════
        // PASO 4: Notificar al admin (SOLO con tenantId real)
        // ════════════════════════════════════════════════════
        const BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN || "";
        const CHAT_ID = ENV.TELEGRAM_CHAT_ID || "";
        if (BOT_TOKEN && CHAT_ID) {
            const md = [
                "🆕 *Nueva solicitud de alta*",
                "",
                `👤 *Nombre:* ${escapeMd(name) || "—"}`,
                `📧 *Email:* \`${escapeMd(email)}\``,
                `📦 *Plan:* ${escapeMd(plan)}`,
                businessType ? `🏪 *Tipo:* ${escapeMd(businessType)}` : "",
                "",
                `🆔 *User ID:* \`${userId}\``,
                `🏢 *Tenant ID:* \`${tenantId}\``,
                "",
                `⏰ *Cortesía:* 24h desde ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
                "",
                "👇 *Pulsa para aprobar o rechazar:*",
            ].filter(Boolean).join("\n");

            const inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ APROBAR (1 CLICK)", callback_data: `approve_${tenantId}` },
                        { text: "❌ Rechazar", callback_data: `reject_${tenantId}` }
                    ]
                ]
            };

            await sendTelegram(BOT_TOKEN, CHAT_ID, md, inlineKeyboard);
        }

     return safeJson(200, {
            ok: true,
            tenantId,
            userId,
            userAlreadyExisted,
            method: "service_role",
            message: "Tu cuenta está creada. Te avisaremos cuando esté activa.",
        });
    } catch (e) {
        return safeJson(200, {
            ok: false,
            step: "exception",
            error: e?.message || String(e),
        });
    }
};
