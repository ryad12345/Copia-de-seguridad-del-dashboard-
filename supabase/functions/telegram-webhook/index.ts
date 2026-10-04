// =====================================================================
// MOZONA TPV — Supabase Edge Function: telegram-webhook (v4.0.8-secure)
// =====================================================================
// Procesa callback_query de Telegram cuando el admin pulsa:
//   - approve_30d:<tenantId>  → aprueba con 30 días (active)
//   - approve_7d:<tenantId>   → aprueba con 7 días de trial (active_trial)
//   - reject:<tenantId>       → marca como expired
// Acepta también el formato con `_` como separador (approve_30d_<tenantId>)
//
// HARDENING v4.0.8-secure:
//   - FAIL-CLOSED: si TELEGRAM_WEBHOOK_SECRET no está configurado, se rechaza
//     toda petición (antes se saltaba la validación por completo → cualquiera
//     podía forjar un callback con chat.id = ADMIN_CHAT_ID y aprobar tenants).
//   - Comparación del secret en tiempo constante (timingSafeEqual).
//   - No se filtran secretos ni stack traces en las respuestas.
// =====================================================================

import { timingSafeEqual } from "../_shared/security.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ADMIN_CHAT_ID = String(Deno.env.get("TELEGRAM_CHAT_ID") ?? "");
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

const sbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

async function answerCallback(callbackQueryId: string, text: string, showAlert = false) {
    if (!BOT_TOKEN) return;
    await fetchWithTimeout(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
        },
        8000
    );
}

async function editMessage(chatId: number | string, messageId: number | undefined, newText: string) {
    if (!BOT_TOKEN || !messageId) return;
    await fetchWithTimeout(
        `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: newText,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [] },
            }),
        },
        8000
    );
}

// ★ Aprobar tenant usando SQL real: now() + interval 'N days'
async function approveTenantByDays(tenantId: string, days: number): Promise<{ ok: boolean; trialEndsAt?: string; error?: string }> {
    // Vía PATCH directo (Supabase REST prefiere return=representation)
    // El cálculo se hace aquí en JS con timestamp exacto para garantizar precisión
    const trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
    const activation = days >= 30 ? "active" : "active_trial";

    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({
                activation_status: activation,
                approved_at: new Date().toISOString(),
                approved_by: `telegram-${days}d-1click`,
                trial_ends_at: trialEndsAt,
                updated_at: new Date().toISOString(),
            }),
        },
        15000
    );
    if (!r.ok) {
        // No devolver el cuerpo crudo (puede contener detalles de DB).
        return { ok: false, error: `HTTP ${r.status}` };
    }
    return { ok: true, trialEndsAt };
}

async function rejectTenant(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({
                activation_status: "expired",
                updated_at: new Date().toISOString(),
            }),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
}

Deno.serve(async (req: Request) => {
    try {
        if (req.method === "OPTIONS") return new Response("ok");

        // ★ v4.0.8-secure: validación FAIL-CLOSED del secret del webhook.
        //   Si no está configurado, no se procesa ningún callback.
        if (!WEBHOOK_SECRET) {
            console.error("[tg-webhook] FATAL: TELEGRAM_WEBHOOK_SECRET no configurado");
            return new Response(
                JSON.stringify({ ok: false, error: "webhook not configured" }),
                { status: 503, headers: { "Content-Type": "application/json" } }
            );
        }
        const provided = req.headers.get("x-telegram-bot-api-secret-token") || "";
        if (!timingSafeEqual(provided, WEBHOOK_SECRET)) {
            return new Response(
                JSON.stringify({ ok: false, error: "Unauthorized" }),
                { status: 403, headers: { "Content-Type": "application/json" } }
            );
        }

        const body = await req.json().catch(() => ({}));

        // ★ Callback query (botón pulsado)
        if (body.callback_query) {
            const cb = body.callback_query;
            const data = String(cb.data || "");
            const chatId = cb.message?.chat?.id;
            const messageId = cb.message?.message_id;

            // Parsear callback_data con `:` o `_` como separador
            // Formatos: approve_30d:<id>, approve_7d:<id>, reject:<id>
            // o con _:  approve_30d_<id>
            let action = data;
            let target = "";
            if (data.includes(":")) {
                [action, target] = data.split(":");
            } else if (data.includes("_")) {
                const parts = data.split("_");
                if (parts.length === 2) {
                    [action, target] = parts;
                } else {
                    // 3 partes: approve_30d_<id>
                    action = parts.slice(0, 2).join("_"); // "approve_30d"
                    target = parts.slice(2).join("_");
                }
            }

            console.log("[tg-webhook] callback:", { action, target });

            // Solo el admin autorizado puede pulsar
            if (String(chatId) !== ADMIN_CHAT_ID) {
                await answerCallback(cb.id, "⛔ No autorizado", true);
                return new Response("ok");
            }

            // ★ Aprobar 30 días
            if (action === "approve_30d") {
                await answerCallback(cb.id, "⏳ Aprobando 30 días...", false);
                if (cb.message) {
                    await editMessage(
                        chatId,
                        messageId,
                        `✅ *APROBADO 30 DÍAS*\n\n🆔 \`${target}\`\n📅 Expira: ${new Date(Date.now() + 30 * 86400000).toLocaleDateString("es-ES")}\n🔓 Plan: ACTIVO`
                    );
                }
                const result = await approveTenantByDays(target, 30);
                if (result.ok) {
                    await answerCallback(cb.id, "✅ Aprobado por 30 días", false);
                } else {
                    await answerCallback(cb.id, `❌ Error: ${result.error?.slice(0, 100)}`, true);
                }
                return new Response("ok");
            }

            // ★ Aprobar 7 días (Trial)
            if (action === "approve_7d") {
                await answerCallback(cb.id, "⏳ Aprobando trial 7 días...", false);
                if (cb.message) {
                    await editMessage(
                        chatId,
                        messageId,
                        `⏱️ *APROBADO TRIAL 7 DÍAS*\n\n🆔 \`${target}\`\n📅 Expira: ${new Date(Date.now() + 7 * 86400000).toLocaleDateString("es-ES")}\n🎁 Plan: ACTIVE_TRIAL`
                    );
                }
                const result = await approveTenantByDays(target, 7);
                if (result.ok) {
                    await answerCallback(cb.id, "✅ Trial 7 días activado", false);
                } else {
                    await answerCallback(cb.id, `❌ Error: ${result.error?.slice(0, 100)}`, true);
                }
                return new Response("ok");
            }

            // ★ Rechazar
            if (action === "reject") {
                await answerCallback(cb.id, "⏳ Rechazando...", false);
                if (cb.message) {
                    await editMessage(
                        chatId,
                        messageId,
                        `❌ *RECHAZADO*\n\n🆔 \`${target}\``
                    );
                }
                const result = await rejectTenant(target);
                if (result.ok) {
                    await answerCallback(cb.id, "❌ Rechazado", false);
                } else {
                    await answerCallback(cb.id, `❌ Error: ${result.error?.slice(0, 100)}`, true);
                }
                return new Response("ok");
            }

            // Acción no reconocida
            await answerCallback(cb.id, `⚠️ Acción no reconocida: ${action}`, true);
            return new Response("ok");
        }

        return new Response("ok");
    } catch (e) {
        console.error("[tg-webhook] error:", e);
        return new Response("ok");
    }
});
