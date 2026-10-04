// =====================================================================
// MOZONA TPV — Supabase Edge Function: register-tenant (v4.0.7-diag)
// =====================================================================
// Envía alerta a Telegram con 3 botones inline (callback_data puro)
//   ✅ Aprobar (30 días)  →  callback_data: approve_30d:<tenantId>
//   ⏱️ Aprobar (7 días)   →  callback_data: approve_7d:<tenantId>
//   ❌ Rechazar          →  callback_data: reject:<tenantId>
//
// ★ v4.0.7-diag: Devuelve en la respuesta el `reply_markup_sent` exacto
//   para verificar que NO hay 'url' y SÍ hay 'callback_data'.
// =====================================================================

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

function escapeMd(s: string): string {
    if (!s) return "";
    return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&").slice(0, 200);
}

// ★ v4.0.7-secure: CORS estricto (whitelist de orígenes)
const ALLOWED_ORIGINS = new Set([
    "https://mozonatpv.site",
    "https://www.mozonatpv.site",
    "https://mozona-tpv-v2-real.pages.dev",
    "http://localhost:5173",
    "http://localhost:4173",
]);

function getCorsHeaders(origin: string | null) {
    const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : Array.from(ALLOWED_ORIGINS)[0];
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name, x-application-version",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

const corsHeaders = getCorsHeaders(null);

function json(payload: any, status = 200) {
    return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status,
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });

    try {
        const body = await req.json().catch(() => ({}));
        const name = String(body.name || "");
        const email = String(body.email || "");
        const userId = String(body.userId || "N/A");
        const tenantId = String(body.tenantId || "N/A");
        const plan = String(body.plan || "basic");
        const businessType = String(body.businessType || "");

        if (!BOT_TOKEN || !CHAT_ID) {
            return json({ ok: false, error: "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados", ts: Date.now() });
        }

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
            "👇 *Pulsa para aprobar o rechazar:*",
        ].filter(Boolean).join("\n");

        // ★ v4.0.7: 3 botones inline con callback_data puro (sin URLs externas, sin flecha)
        //   ESTRICTAMENTE solo "callback_data", NUNCA "url"
        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ Aprobar (30 días)", callback_data: `approve_30d:${tenantId}` },
                    { text: "⏱️ Aprobar (7d / Trial)", callback_data: `approve_7d:${tenantId}` },
                ],
                [
                    { text: "❌ Rechazar", callback_data: `reject:${tenantId}` },
                ],
            ],
        };

        const tgBody = {
            chat_id: CHAT_ID,
            text: md,
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard,
        };

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tgBody),
        });

        const tgJson = await tgRes.json().catch(() => ({}));
        const ok = tgJson?.ok === true;
        const messageId = tgJson?.result?.message_id;

        // ★ Diagnóstico: validar que NO hay 'url' y SÍ hay 'callback_data'
        const hasUrl = JSON.stringify(inlineKeyboard).includes('"url"');
        const hasCallbackData = JSON.stringify(inlineKeyboard).includes('"callback_data"');

        return json({
            ok,
            tg: ok,
            message_id: messageId,
            reply_markup_sent: inlineKeyboard,
            diagnostic: {
                has_url_property: hasUrl,
                has_callback_data_property: hasCallbackData,
                buttons: inlineKeyboard.inline_keyboard.flat().map((b: any) => Object.keys(b)),
            },
            error: ok ? undefined : tgJson?.description || "Telegram no aceptó el mensaje",
            ts: Date.now(),
        });
    } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e), ts: Date.now() });
    }
});
