// =====================================================================
// MOZONA TPV — telegramAuto.ts (v4.0.7-defender)
// =====================================================================
// Wrapper client-side para enviar mensajes a Telegram.
// ⚠️ El bot_token NUNCA viaja al cliente.
//    Se usa la Edge Function `telegram-notify` que lee el token de los
//    secrets de Supabase desde el servidor.
// =====================================================================

const TG_CHAT_KEY = "mozona.telegram.chat_id";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./constants";

interface TelegramResult {
    ok: boolean;
    error?: string;
    chatId?: string;
}

function envChatId(): string {
    return (import.meta.env.VITE_TELEGRAM_CHAT_ID as string) ?? "";
}

/**
 * Devuelve el chat_id a usar (cache en localStorage > env > vacío).
 * El bot_token queda server-side; nunca se devuelve al cliente.
 */
export function getTelegramChatId(): string {
    try {
        const cached = (typeof localStorage !== "undefined"
            ? localStorage.getItem(TG_CHAT_KEY)
            : null) || "";
        const env = envChatId();
        if (env && !env.startsWith("PENDING")) return env;
        return cached.trim();
    } catch {
        return "";
    }
}

export function setTelegramChatId(chatId: string): void {
    try {
        localStorage.setItem(TG_CHAT_KEY, chatId);
    } catch {
        /* ignore */
    }
}

/**
 * Envía un mensaje al chat configurado. Si no hay chat_id y el usuario
 * está autenticado, se autodetecta en el backend (requiere que el admin
 * haya escrito /start al bot previamente).
 */
export async function sendTelegramMessage(
    text: string,
    inlineKeyboard?: unknown
): Promise<TelegramResult> {
    let chatId = getTelegramChatId();

    try {
        const authHeader = readAuthHeader();
        if (!authHeader) {
            // Permitir service_role/anon si la edge function está sin auth
            // pero exigir al menos un header identificable.
        }

        const r = await fetch(`${SUPABASE_URL}/functions/v1/telegram-notify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_ANON_KEY,
                Authorization: authHeader ?? `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                text,
                chat_id: chatId || undefined,
                inline_keyboard: inlineKeyboard,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }),
        });

        const data = await r.json().catch(() => ({}));
        if (r.ok && data?.ok !== false) {
            if (data?.chat_id) setTelegramChatId(String(data.chat_id));
            return { ok: true, chatId };
        }
        return {
            ok: false,
            error: data?.error ?? data?.reason ?? `HTTP ${r.status}`,
        };
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : typeof e === "string" ? e : "Network error";
        return { ok: false, error: message };
    }
}

function readAuthHeader(): string | null {
    try {
        const anon = `Bearer ${SUPABASE_ANON_KEY}`;
        // Si tenemos un JWT en localStorage del cliente, lo prefiere
        const stored = typeof localStorage !== "undefined"
            ? localStorage.getItem("mozona.jwt") || ""
            : "";
        if (stored) return `Bearer ${stored}`;
    } catch {
        /* ignore */
    }
    return null;
}
