// =====================================================================
// MOZONA TPV — Edge Function: telegram-notify (v4.0.8-secure)
// =====================================================================
// Envia un mensaje a Telegram desde el servidor.
// El bot_token NUNCA llega al cliente — se lee de los secrets de Supabase.
//
// HARDENING v4.0.8-secure:
//   - Ya NO se acepta la ANON KEY pública como "service role". La anon key se
//     distribuye a todos los clientes, por lo que aceptarla era un bypass
//     total de autenticación (cualquiera podía enviar mensajes arbitrarios).
//   - Sólo se admite: (a) el SERVICE ROLE KEY real (server-to-server, comparado
//     en tiempo constante), o (b) un JWT de usuario verificado server-side.
//   - Los llamantes no-service sólo pueden enviar al chat admin (no a un
//     chat_id arbitrario).
//   - CORS restringido a allowlist (nunca `*`).
//   - Errores genéricos (sin filtrar detalles internos).
// =====================================================================

import { corsHeaders, timingSafeEqual, verifyUser, clientIp, rateLimit } from "../_shared/security.ts";

declare const Deno: {
    env: { get(key: string): string | undefined };
    serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

interface NotifyPayload {
    text: string;
    chat_id?: string;
    inline_keyboard?: unknown;
    parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
    disable_web_page_preview?: boolean;
}

async function verifyJwtOrServiceRole(
    req: Request
): Promise<{ ok: boolean; user_id?: string; reason?: string; is_service_role?: boolean }> {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return { ok: false, reason: "missing auth header" };

    // ★ Bypass server-to-server SOLO con el SERVICE ROLE KEY real.
    //   (Nunca con la anon key pública; comparación en tiempo constante.)
    if (SERVICE_ROLE_KEY && timingSafeEqual(token, SERVICE_ROLE_KEY)) {
        return { ok: true, is_service_role: true };
    }

    // Resto: JWT de usuario verificado server-side.
    const verified = await verifyUser(req, SUPABASE_URL, SUPABASE_ANON_KEY || SERVICE_ROLE_KEY);
    if (!verified.ok) return { ok: false, reason: "invalid token" };
    return { ok: true, user_id: verified.user.id };
}

async function sendTelegram(
    chatId: string,
    text: string,
    inline_keyboard?: unknown,
    parse_mode = "HTML",
    disable_web_page_preview = true
): Promise<{ ok: boolean; error?: string }> {
    if (!BOT_TOKEN) {
        return { ok: false, error: "not configured" };
    }

    try {
        const body: Record<string, unknown> = {
            chat_id: chatId,
            text,
            parse_mode,
            disable_web_page_preview,
        };
        if (inline_keyboard) body.reply_markup = inline_keyboard;

        const r = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }
        );
        const data = await r.json();
        if (data.ok) return { ok: true };
        return { ok: false, error: data.description ?? `HTTP ${r.status}` };
    } catch (e) {
        return { ok: false, error: "send failed" };
    }
}

Deno.serve(async (req) => {
    const cors = corsHeaders(req, "POST, OPTIONS");

    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
    }

    const jsonOut = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
            status,
            headers: { ...cors, "Content-Type": "application/json" },
        });

    if (req.method !== "POST") {
        return jsonOut({ error: "method_not_allowed" }, 405);
    }

    // Verify auth
    const auth = await verifyJwtOrServiceRole(req);
    if (!auth.ok) {
        return jsonOut({ error: "unauthorized" }, 401);
    }

    let payload: NotifyPayload;
    try {
        payload = await req.json();
    } catch {
        return jsonOut({ error: "invalid_json" }, 400);
    }

    if (!payload.text) {
        return jsonOut({ error: "missing_text" }, 400);
    }

    // Rate limit básico en Edge (por usuario/IP) para llamantes no-service.
    if (!auth.is_service_role) {
        const key = auth.user_id ?? clientIp(req);
        if (!rateLimit(`tg-notify:${key}`, 30, 60_000)) {
            return jsonOut({ error: "rate_limited", retry_after: 60 }, 429);
        }
    }

    // ★ Los llamantes no-service sólo pueden enviar al chat admin.
    const chatId = auth.is_service_role ? (payload.chat_id ?? ADMIN_CHAT_ID) : ADMIN_CHAT_ID;
    if (!chatId) {
        return jsonOut({ error: "no_chat_id" }, 500);
    }

    const result = await sendTelegram(
        chatId,
        payload.text,
        payload.inline_keyboard,
        payload.parse_mode,
        payload.disable_web_page_preview
    );

    return jsonOut(result, result.ok ? 200 : 502);
});
