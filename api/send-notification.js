// =====================================================================
// MOZONA TPV — /api/send-notification (v4.0.1)
// =====================================================================
// Servicio corporativo de envio de emails/whatsapp.
// SIN logos de Supabase, Vercel, Postgres ni infraestructura.
// Remitente: 'Mozona TPV <seguridad@mozonatpv.com>'
// Relais SMTP/WhatsApp configurados via env vars (nuestra infra).
// =====================================================================

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js");
const ENV = require("./_env.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
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
        return { ok: false, status: 0, error: e };
    }
}

// ★ Plantilla HTML corporativa (modo oscuro elegante, sin logos tecnicos)
function emailTemplate({ title, body, ctaUrl, ctaText }) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
    body { margin: 0; padding: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .container { max-width: 560px; margin: 32px auto; padding: 0 16px; }
    .card { background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.3); }
    .header { background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%); padding: 28px 32px; text-align: center; }
    .brand { font-size: 22px; font-weight: 900; color: white; letter-spacing: -0.02em; margin: 0; }
    .brand-sub { font-size: 12px; color: rgba(255,255,255,0.8); margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }
    .body { padding: 40px 32px; color: #cbd5e1; font-size: 15px; line-height: 1.7; }
    .body h1 { color: #f1f5f9; font-size: 24px; font-weight: 800; margin: 0 0 16px; line-height: 1.3; }
    .body p { margin: 0 0 14px; }
    .otp { background: #0f172a; border: 2px solid #7c3aed; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; margin-bottom: 8px; }
    .otp-code { font-size: 36px; font-weight: 900; color: #f1f5f9; letter-spacing: 8px; font-family: 'Courier New', monospace; }
    .cta { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%); color: white; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 14px; margin: 16px 0; }
    .divider { border: none; border-top: 1px solid #334155; margin: 24px 0; }
    .small { font-size: 12px; color: #64748b; line-height: 1.6; }
    .footer { background: #0a0f1c; padding: 24px 32px; text-align: center; color: #475569; font-size: 12px; line-height: 1.6; }
    .footer a { color: #94a3b8; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
<div class="card">
    <div class="header">
        <div class="brand">Mozona TPV</div>
        <div class="brand-sub">Seguridad</div>
    </div>
    <div class="body">
        <h1>${title}</h1>
        ${body}
        ${ctaUrl ? `
        <div style="text-align: center; margin: 28px 0;">
            <a href="${ctaUrl}" class="cta">${ctaText || 'Continuar'}</a>
        </div>
        ` : ''}
        <hr class="divider">
        <p class="small">
            Este mensaje fue enviado a tu correo porque intentaste acceder a tu cuenta.
            Si no has sido tú, puedes ignorar este aviso sin problema.
        </p>
    </div>
    <div class="footer">
        <div>© ${new Date().getFullYear()} Mozona TPV · Tu negocio, simple</div>
        <div style="margin-top: 8px;">
            <a href="https://app.mozonatpv.com">app.mozonatpv.com</a>
        </div>
    </div>
</div>
</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://app.mozonatpv.com"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    if (req.method !== "POST") return safeJson(200, { ok: false, error: "POST requerido" });

    // ★ Servicio de correo CORPORATIVO via nuestro relay
    const EMAIL_RELAY_URL = (ENV.EMAIL_RELAY_URL || "https://mail.mozonatpv.com").replace(/\/$/, "");
    const EMAIL_FROM_NAME = ENV.EMAIL_FROM_NAME || "Mozona TPV - Seguridad";
    const EMAIL_FROM_ADDR = ENV.EMAIL_FROM_ADDR || "seguridad@mozonatpv.com";
    const WHATSAPP_RELAY_URL = (ENV.WHATSAPP_RELAY_URL || "https://wa.mozonatpv.com").replace(/\/$/, "");

    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }

    try {
        const type = body.type || "email";
        const recipient = body.to || body.email || "";

        // ═══════════════════════════════════════════════════════════════
        // EMAIL OTP (Corporativo, sin logos tecnicos)
        // ═══════════════════════════════════════════════════════════════
        if (type === "email_otp") {
            const code = body.code || "000000";
            const subject = body.subject || "Tu codigo de verificacion";
            const html = emailTemplate({
                title: "Verifica tu cuenta",
                body: `
                    <p>Hola,</p>
                    <p>Para terminar de acceder a tu cuenta, usa este codigo:</p>
                    <div class="otp">
                        <div class="otp-label">Tu codigo de verificacion</div>
                        <div class="otp-code">${code}</div>
                    </div>
                    <p>Este codigo caduca en <strong>10 minutos</strong>.</p>
                    <p>Si no has solicitado este codigo, puedes ignorar este mensaje.</p>
                `,
            });

            const r = await fetchWithTimeout(`${EMAIL_RELAY_URL}/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Service-Secret": ENV.EMAIL_RELAY_SECRET || "" },
                body: JSON.stringify({
                    from: { name: EMAIL_FROM_NAME, address: EMAIL_FROM_ADDR },
                    to: recipient,
                    subject,
                    html,
                }),
            }, 10000);

            if (!r || !r.ok) {
                return safeJson(200, { ok: false, error: "El servicio de correo no está disponible. Contacta con soporte." });
            }

            return safeJson(200, { ok: true, message: "Código enviado a tu correo" });
        }

        // ═══════════════════════════════════════════════════════════════
        // EMAIL BIENVENIDA (tras verificar OTP)
        // ═══════════════════════════════════════════════════════════════
        if (type === "email_welcome") {
            const businessName = body.businessName || "tu negocio";
            const html = emailTemplate({
                title: "¡Bienvenido a Mozona TPV!",
                body: `
                    <p>Tu cuenta de <strong>${businessName}</strong> está lista.</p>
                    <p>Ya puedes empezar a usar el TPV desde el panel de tu local.</p>
                    <p>Si necesitas ayuda, abre el chat Riyad dentro de la plataforma.</p>
                `,
                ctaUrl: "https://app.mozonatpv.com/app",
                ctaText: "Entrar a mi TPV",
            });

            await fetchWithTimeout(`${EMAIL_RELAY_URL}/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Service-Secret": ENV.EMAIL_RELAY_SECRET || "" },
                body: JSON.stringify({
                    from: { name: EMAIL_FROM_NAME, address: EMAIL_FROM_ADDR },
                    to: recipient,
                    subject: "¡Bienvenido a Mozona TPV!",
                    html,
                }),
            }, 10000);

            return safeJson(200, { ok: true });
        }

        // ═══════════════════════════════════════════════════════════════
        // WHATSAPP (vía nuestro relay)
        // ═══════════════════════════════════════════════════════════════
        if (type === "whatsapp") {
            const message = body.message || "";
            const r = await fetchWithTimeout(`${WHATSAPP_RELAY_URL}/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to: recipient,
                    message,
                    from: "Mozona TPV",
                }),
            }, 10000);
            if (!r || !r.ok) return safeJson(200, { ok: false, error: "WhatsApp relay no disponible" });
            return safeJson(200, { ok: true });
        }

        
// ★ ACTION: telegram (consolidado desde notify-telegram.js)
if (type === "telegram") {
    const message = body.message || body.text || "";
    const chatId = body.chatId || ENV.TELEGRAM_CHAT_ID || "";
    const botToken = ENV.TELEGRAM_BOT_TOKEN || "";

    if (!botToken || !chatId) {
        return safeJson(200, { ok: false, error: "Telegram no configurado" });
    }

    const replyMarkup = body.reply_markup || null;
    const inlineKeyboard = body.inline_keyboard || null;

    let reply_markup;
    if (inlineKeyboard && Array.isArray(inlineKeyboard)) {
        reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
    } else if (replyMarkup) {
        reply_markup = JSON.stringify(replyMarkup);
    }

    const tgBody = {
        chat_id: chatId,
        text: message.slice(0, 4000),
        parse_mode: body.parse_mode || undefined,
    };
    if (reply_markup) tgBody.reply_markup = reply_markup;

    const r = await fetchWithTimeout(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tgBody),
        },
        10000
    );

    if (!r || !r.ok) {
        return safeJson(200, { ok: false, error: "Telegram no respondio" });
    }

    return safeJson(200, { ok: true });
}

return safeJson(200, { ok: false, error: `Tipo de notificacion no soportado: ${type}` });

    } catch (e) {
        return safeJson(200, { ok: false, error: "El servicio no responde. Reintenta en unos segundos." });
    }
};
