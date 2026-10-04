// =====================================================================
// MOZONA TPV — /api/telegram-webhook (v3.0.9 — robusto + 1-click approve)
// =====================================================================
// Recibe updates del bot de Telegram.
// Procesa:
//   - callback_query de botones inline (approve, reject, view)
//   - comandos /approve y /reject por texto
//
// ★ v3.0.9: 1-CLICK APPROVE
//   - Edita el mensaje original en Telegram
//   - Quita los botones
//   - Muestra "✅ Aprobado por [admin]"
//   - Devuelve 200 OK en <100ms
// =====================================================================

const ENV = require("./_env.js");
let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

const SUPERADMIN_CHAT_ID = ENV.TELEGRAM_CHAT_ID || "";
const BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN || "";
const SUPABASE_URL = (ENV.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = ENV.SUPABASE_ANON_KEY || "";

// ★ Fetch con timeout (10s)
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return r;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") {
            return { ok: false, status: 0, text: async () => "timeout" };
        }
        throw e;
    }
}

// ★ Telegram: enviar mensaje
async function sendMessage(chatId, text, options = {}) {
    if (!BOT_TOKEN) return;
    try {
        await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
                ...options,
            }),
        }, 8000);
    } catch (_) {}
}

// ★ Telegram: editar mensaje (quitar botones, mostrar "Aprobado")
async function editMessage(chatId, messageId, newText) {
    if (!BOT_TOKEN || !messageId) return;
    try {
        await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: newText,
                parse_mode: "Markdown",
                // ★ reply_markup vacío = quitar botones
                reply_markup: { inline_keyboard: [] },
            }),
        }, 8000);
    } catch (_) {}
}

// ★ Telegram: responder a callback query (toast)
async function answerCallback(callbackQueryId, text, showAlert = false) {
    if (!BOT_TOKEN) return;
    try {
        await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text,
                show_alert,
            }),
        }, 5000);
    } catch (_) {}
}

// ★ Aprobar tenant (idempotente)
async function approveTenant(tenantIdOrEmail, approvedBy) {
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (!SUPABASE_URL) {
        return { ok: false, error: "Supabase URL no configurada en Vercel" };
    }

    const apiKey = SERVICE_KEY || ANON_KEY;
    if (!apiKey) {
        return { ok: false, error: "Supabase API key no configurada" };
    }

    const headers = {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
    };

    // ★ Resolver tenantId
    let targetTenantId = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrEmail);

    if (isUuid) {
        targetTenantId = tenantIdOrEmail;
    } else {
        // Buscar por contact_email
        try {
            const r = await fetchWithTimeout(
                `${SUPABASE_URL}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(tenantIdOrEmail)}&select=id,name&limit=1`,
                { headers },
                20000
            );
            if (r.ok) {
                const arr = await r.json();
                if (arr && arr[0]) targetTenantId = arr[0].id;
            }
        } catch (e) {
            return { ok: false, error: "Error buscando tenant: " + (e?.message || "fetch failed") };
        }

        // Fallback heurístico
        if (!targetTenantId) {
            try {
                const r = await fetchWithTimeout(
                    `${SUPABASE_URL}/rest/v1/tenants?order=created_at.desc&limit=10`,
                    { headers },
                20000
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr.length > 0) {
                        const match = arr.find(t =>
                            t.contact_email && t.contact_email.toLowerCase() === tenantIdOrEmail.toLowerCase()
                        );
                        if (match) targetTenantId = match.id;
                        else if (arr[0]) targetTenantId = arr[0].id;
                    }
                }
            } catch (_) {}
        }
    }

    if (!targetTenantId) {
        return { ok: false, error: `Tenant no encontrado: ${tenantIdOrEmail}` };
    }

    // ★ Actualizar
    try {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/rest/v1/tenants?id=eq.${targetTenantId}`,
            {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                    activation_status: "active_trial",
                    approved_at: new Date().toISOString(),
                    approved_by: approvedBy,
                    trial_ends_at: trialEndsAt,
                    updated_at: new Date().toISOString(),
                }),
            },
            20000
        );
        if (r.ok) {
            return { ok: true, tenantId: targetTenantId, trialEndsAt };
        }
        let errText = "";
        try { errText = await r.text(); } catch (_) {}
        return { ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 200)}` };
    } catch (e) {
        return { ok: false, error: "fetch failed: " + (e?.message || e) };
    }
}

// ★ Rechazar tenant
async function rejectTenant(tenantIdOrEmail) {
    if (!SUPABASE_URL) return { ok: false, error: "Supabase URL no configurada" };
    const apiKey = SERVICE_KEY || ANON_KEY;
    if (!apiKey) return { ok: false, error: "API key no configurada" };

    const headers = {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
    };

    let targetTenantId = tenantIdOrEmail;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrEmail);
    if (!isUuid) {
        try {
            const r = await fetchWithTimeout(
                `${SUPABASE_URL}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(tenantIdOrEmail)}&select=id&limit=1`,
                { headers },
                20000
            );
            if (r.ok) {
                const arr = await r.json();
                if (arr && arr[0]) targetTenantId = arr[0].id;
            }
        } catch (_) {}
    }

    if (!targetTenantId) return { ok: false, error: "Tenant no encontrado" };

    try {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/rest/v1/tenants?id=eq.${targetTenantId}`,
            {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                    activation_status: "expired",
                    approved_by: "rejected",
                    updated_at: new Date().toISOString(),
                }),
            },
            20000
        );
        if (r.ok) return { ok: true, tenantId: targetTenantId };
        let errText = "";
        try { errText = await r.text(); } catch (_) {}
        return { ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 200)}` };
    } catch (e) {
        return { ok: false, error: "fetch failed: " + (e?.message || e) };
    }
}

module.exports = async (req, res) => {
    // ★ Headers de seguridad
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    // CORS
    try {
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    // ★ Responder RÁPIDO a Telegram (en <100ms) para que no reintente
    // El trabajo real se hace en background
    const ackEarly = () => {
        try { return res.status(200).json({ ok: true }); } catch (_) {}
    };

    try {
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }

        // ════════════════════════════════════════════════════
        // ★ CALLBACK_QUERY (botón inline)
        // ════════════════════════════════════════════════════
        if (body.callback_query) {
            const cb = body.callback_query;
            const chatId = cb.message?.chat?.id;
            const messageId = cb.message?.message_id;
            const data = cb.data || "";
            const [action, target] = data.split(":");

            // ★ Responder ACK inmediatamente
            ackEarly();

            // ★ Validar que es el admin
            if (String(chatId) !== String(SUPERADMIN_CHAT_ID)) {
                await answerCallback(cb.id, "⛔ No autorizado", true);
                return;
            }

            if (action === "approve") {
                // ★ Toast inmediato
                await answerCallback(cb.id, "⏳ Aprobando...", false);

                // ★ Editar mensaje (quitar botones, mostrar "Aprobado")
                if (messageId) {
                    await editMessage(chatId, messageId,
                        `✅ *APROBADO*\n\n🆔 \`${target}\`\n⏰ 7 días de trial activados\n\n_Procesado a las ${new Date().toLocaleString("es-ES")}_`
                    );
                }

                // ★ Aprobar en Supabase
                const result = await approveTenant(target, "telegram-1click");

                if (result.ok) {
                    // ★ Confirmar con toast
                    await answerCallback(cb.id, "✅ Aprobado: " + result.tenantId.slice(0, 8) + "...", false);
                } else {
                    // ★ Mostrar error en el mensaje
                    if (messageId) {
                        await editMessage(chatId, messageId,
                            `❌ *ERROR AL APROBAR*\n\n🆔 \`${target}\`\n⚠️ ${result.error}\n\n_Puedes intentar de nuevo con /approve ${target}_`
                        );
                    }
                    await answerCallback(cb.id, "❌ " + result.error, true);
                }
            } else if (action === "reject") {
                await answerCallback(cb.id, "⏳ Rechazando...", false);
                if (messageId) {
                    await editMessage(chatId, messageId,
                        `❌ *RECHAZADO*\n\n🆔 \`${target}\`\n\n_Procesado a las ${new Date().toLocaleString("es-ES")}_`
                    );
                }
                const result = await rejectTenant(target);
                if (result.ok) {
                    await answerCallback(cb.id, "❌ Rechazado", false);
                } else {
                    if (messageId) {
                        await editMessage(chatId, messageId,
                            `❌ *ERROR AL RECHAZAR*\n\n🆔 \`${target}\`\n⚠️ ${result.error}`
                        );
                    }
                    await answerCallback(cb.id, "❌ " + result.error, true);
                }
            } else if (action === "view") {
                await answerCallback(cb.id, "🔍 Abriendo...", false);
                await sendMessage(chatId, `🔍 *Detalles*\n\n🆔 \`${target}\`\n\n👁 [Panel admin](https://www.mozonatpv.site/admin/approve?token=mozona-approve-2025)`);
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // ★ MENSAJE DE TEXTO
        // ════════════════════════════════════════════════════
        if (body.message) {
            const msg = body.message;
            const chatId = msg.chat?.id;
            const text = (msg.text || "").trim();

            // ★ Solo procesar mensajes del admin
            if (String(chatId) !== String(SUPERADMIN_CHAT_ID)) {
                ackEarly();
                return;
            }

            // ★ ACK inmediato
            ackEarly();

            if (text === "/start" || text === "/help") {
                await sendMessage(chatId, [
                    "🤖 *MOZONA TPV — Bot de admin*",
                    "",
                    "Cuando alguien se registra, recibes un mensaje con *botones* (1-click).",
                    "",
                    "📋 *Comandos:*",
                    "`/approve <id|email>` — Aprobar",
                    "`/reject <id|email>` — Rechazar",
                    "`/pending` — Ver pendientes",
                    "`/status` — Estado sistema",
                    "",
                    "🌐 [Panel admin web](https://www.mozonatpv.site/admin/approve?token=mozona-approve-2025)",
                ].join("\n"));
            } else if (text === "/status") {
                await sendMessage(chatId, [
                    "📊 *Estado del sistema*",
                    "",
                    `Bot Telegram: ${BOT_TOKEN ? "✅" : "❌"}`,
                    `Supabase URL: ${SUPABASE_URL ? "✅" : "❌"}`,
                    `Service Role: ${SERVICE_KEY ? "✅" : "❌"}`,
                    `Anon Key: ${ANON_KEY ? "✅" : "❌"}`,
                    `Webhook: ${SUPERADMIN_CHAT_ID ? "✅" : "❌"}`,
                ].join("\n"));
            } else if (text === "/pending") {
                if (!SUPABASE_URL) {
                    await sendMessage(chatId, "❌ Supabase no configurado");
                } else {
                    const apiKey = SERVICE_KEY || ANON_KEY;
                    try {
                        const r = await fetchWithTimeout(
                            `${SUPABASE_URL}/rest/v1/tenants?activation_status=eq.pending_activation&select=id,name,contact_email,plan_selected,created_at&order=created_at.desc&limit=10`,
                            { headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } },
                            20000
                        );
                        if (r.ok) {
                            const arr = await r.json();
                            if (arr && arr.length > 0) {
                                const list = arr.map((t, i) =>
                                    `${i + 1}. *${t.name || "—"}* — \`${t.contact_email}\`\n   🆔 \`${t.id}\``
                                ).join("\n\n");
                                await sendMessage(chatId, `⏳ *Pendientes (${arr.length})*\n\n${list}`);
                            } else {
                                await sendMessage(chatId, "✅ No hay tenants pendientes");
                            }
                        } else {
                            await sendMessage(chatId, `❌ Error HTTP ${r.status}`);
                        }
                    } catch (e) {
                        await sendMessage(chatId, `❌ Error: ${e?.message}`);
                    }
                }
            } else if (text.startsWith("/approve")) {
                const target = text.replace(/^\/approve\s+/, "").trim();
                if (!target) {
                    await sendMessage(chatId, "⚠️ Uso: `/approve <tenantId o email>`");
                } else {
                    const result = await approveTenant(target, "telegram-command");
                    if (result.ok) {
                        await sendMessage(chatId, `✅ *Aprobado*\n\n🆔 \`${result.tenantId}\`\n⏰ Trial hasta: ${result.trialEndsAt.slice(0, 16).replace("T", " ")} UTC`);
                    } else {
                        await sendMessage(chatId, `❌ *Error*\n\n\`${result.error}\``);
                    }
                }
            } else if (text.startsWith("/reject")) {
                const target = text.replace(/^\/reject\s+/, "").trim();
                if (!target) {
                    await sendMessage(chatId, "⚠️ Uso: `/reject <tenantId o email>`");
                } else {
                    const result = await rejectTenant(target);
                    if (result.ok) {
                        await sendMessage(chatId, `❌ *Rechazado*\n\n🆔 \`${result.tenantId}\``);
                    } else {
                        await sendMessage(chatId, `❌ *Error*\n\n\`${result.error}\``);
                    }
                }
            } else if (text === "/setwebhook") {
                const host = (req.headers && req.headers.host) || "www.mozonatpv.site";
                const protocol = host.includes("localhost") ? "http" : "https";
                const webhookUrl = `${protocol}://${host}/api/telegram-webhook`;
                try {
                    const r = await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
                    }, 20000);
                    const json = await r.json();
                    if (json.ok) {
                        await sendMessage(chatId, `✅ Webhook configurado:\n${webhookUrl}`);
                    } else {
                        await sendMessage(chatId, `❌ Error: ${json.description}`);
                    }
                } catch (e) {
                    await sendMessage(chatId, `❌ Error: ${e?.message}`);
                }
            }
            return;
        }

        ackEarly();
    } catch (e) {
        // ★ SIEMPRE 200 a Telegram
        try { return res.status(200).json({ ok: true }); } catch (_) {}
    }
};
