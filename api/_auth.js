// =====================================================================
// MOZONA TPV — /api/_auth (helper)  v4.6.0
// =====================================================================
// Verificación de identidad SERVER-SIDE para endpoints críticos.
//
// Sustituye por completo el esquema antiguo basado en:
//   • tokens estáticos en el código (?token=mozona-admin-2025, ...)
//   • cabecera x-admin-email controlada por el cliente (spoofable)
//
// Ahora la autorización se decide validando el JWT de Supabase contra
// /auth/v1/user y comprobando que el email pertenece a la allowlist de
// superadmins (env SUPERADMIN_EMAILS, coma-separado).
//
// ⚠️  NUNCA confiar en cabeceras de identidad del cliente sin verificar
//     el JWT. Este helper es la única puerta de entrada de admin.
// =====================================================================

const crypto = require("crypto");

let _env = undefined;
function ENV() {
    if (_env !== undefined) return _env;
    try { _env = require("./_env.js"); } catch (_) { _env = {}; }
    return _env;
}

// ---------------------------------------------------------------------
// Comparación de secretos en tiempo constante (evita timing attacks)
// ---------------------------------------------------------------------
function timingSafeEqualStr(a, b) {
    const ba = Buffer.from(String(a == null ? "" : a), "utf8");
    const bb = Buffer.from(String(b == null ? "" : b), "utf8");
    if (ba.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

// ---------------------------------------------------------------------
// Allowlist de superadmins
// ---------------------------------------------------------------------
function superadminEmails() {
    const e = ENV();
    const raw = process.env.SUPERADMIN_EMAILS
        || e.SUPERADMIN_EMAIL
        || "rofixinsta@gmail.com";
    return new Set(
        String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
}

function isSuperadminEmail(email) {
    if (!email) return false;
    return superadminEmails().has(String(email).trim().toLowerCase());
}

// ---------------------------------------------------------------------
// Extracción del bearer token
// ---------------------------------------------------------------------
function bearerToken(req) {
    const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
    const m = /^Bearer\s+(.+)$/i.exec(String(h));
    return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------------
// Verificación del JWT contra Supabase Auth (server-side)
// ---------------------------------------------------------------------
async function getUserFromJwt(req) {
    const token = bearerToken(req);
    if (!token) return null;

    const e = ENV();
    const url = String(e.SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const anon = String(e.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "");
    if (!url || !anon) return null;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    try {
        const r = await fetch(`${url}/auth/v1/user`, {
            headers: { apikey: anon, Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
        clearTimeout(tid);
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        if (!u || !u.id) return null;
        return u;
    } catch (_) {
        clearTimeout(tid);
        return null;
    }
}

// ---------------------------------------------------------------------
// requireSuperadmin — puerta única para operaciones de admin
// ---------------------------------------------------------------------
async function requireSuperadmin(req) {
    const user = await getUserFromJwt(req);
    if (!user) return { ok: false, status: 401, error: "No autenticado" };
    const email = (user.email || "").toLowerCase();
    if (!isSuperadminEmail(email)) {
        return { ok: false, status: 403, error: "No autorizado" };
    }
    return { ok: true, user };
}

// ---------------------------------------------------------------------
// requireUser — exige un JWT válido (cualquier usuario autenticado)
// ---------------------------------------------------------------------
async function requireUser(req) {
    const user = await getUserFromJwt(req);
    if (!user) return { ok: false, status: 401, error: "No autenticado" };
    return { ok: true, user };
}

module.exports = {
    timingSafeEqualStr,
    superadminEmails,
    isSuperadminEmail,
    bearerToken,
    getUserFromJwt,
    requireSuperadmin,
    requireUser,
};
