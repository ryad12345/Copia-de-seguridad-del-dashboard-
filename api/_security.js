// =====================================================================
// MOZONA TPV — /api/_security (helper)
// =====================================================================
// Headers de seguridad para todas las respuestas.
// =====================================================================

function applySecurityHeaders(res) {
    // ★ Prevenir XSS
    res.setHeader("X-Content-Type-Options", "nosniff");
    // ★ Prevenir clickjacking
    res.setHeader("X-Frame-Options", "DENY");
    // ★ HSTS (forzar HTTPS)
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // ★ Política de referrers
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // ★ Permisos
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
}

module.exports = { applySecurityHeaders };
