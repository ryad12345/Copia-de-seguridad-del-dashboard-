// =====================================================================
// MOZONA TPV — /api/_rateLimit (helper)
// =====================================================================
// Rate limiting simple in-memory (para Vercel Serverless).
// ⚠️ En serverless, la memoria es por-instancia, no global.
//   Es suficiente para mitigar ataques simples. Para producción
//   seria, usar Upstash/Redis.
// =====================================================================

const buckets = new Map();

function rateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    // ★ Reset si la ventana expiró
    if (now >= bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    const allowed = bucket.count <= maxRequests;
    const resetIn = Math.max(0, bucket.resetAt - now);

    return { allowed, remaining, resetIn, count: bucket.count };
}

function getClientIp(req) {
    // Vercel expone la IP real en x-forwarded-for
    const xff = req.headers && req.headers["x-forwarded-for"];
    if (xff) {
        const parts = xff.split(",");
        return parts[0].trim();
    }
    return req.socket?.remoteAddress || "unknown";
}

module.exports = { rateLimit, getClientIp };
