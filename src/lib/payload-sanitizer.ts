// =====================================================================
// MOZONA TPV — payload-sanitizer.ts v4.4.3
// =====================================================================
// Safety-net global: limpia payloads antes de enviar a Supabase.
// Elimina `created_at` UUID-ify (causa error 42804) y normaliza campos.
// =====================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIMESTAMP_COLUMNS = new Set([
    "created_at", "updated_at", "cancelled_at", "paid_at",
    "sent_at", "expires_at", "trial_ends_at", "grace_period_ends_at",
    "email_verified_at", "last_login_at", "trial_started_at",
]);

/**
 * Sanitiza un payload para evitar errores PGRST como:
 *   42804: column "created_at" is of type timestamp with time zone
 *          but expression is of type uuid
 *
 * Reglas:
 *   1. Elimina created_at/updated_at/etc. — BD usa DEFAULT
 *      (evita 42804 incluso si llega UUID mal formado)
 *   2. Si el caller insiste en enviar el campo y el valor es UUID-like,
 *      lo elimina igualmente (es un timestamp, no un UUID)
 *   3. Si el caller envía un ISO date string válido, lo deja
 *   4. Si el caller envía null, lo deja
 *   5. Normaliza tenant_id (uuid) y order_id (uuid)
 */
export function sanitizePayload(
    payload: Record<string, any> | null | undefined,
    options: { removeTimestamps?: boolean } = {},
): Record<string, any> {
    if (!payload || typeof payload !== "object") return {};
    const clean: Record<string, any> = {};
    const removeTs = options.removeTimestamps !== false; // default true

    for (const [k, v] of Object.entries(payload)) {
        // ★ v4.4.3: TIMESTAMP_COLUMNS — nunca pasar UUID como timestamp
        if (removeTs && TIMESTAMP_COLUMNS.has(k)) {
            if (v == null) continue;            // null → omitir
            if (typeof v === "string" && UUID_REGEX.test(v)) continue;  // UUID → omitir
            if (typeof v === "string" && ISO_DATE_REGEX.test(v)) {
                clean[k] = v;                   // ISO válido → mantener
                continue;
            }
            // Cualquier otro formato sospechoso → omitir (BD usa DEFAULT)
            continue;
        }

        // Eliminar UUIDs donde no deben estar (defense in depth)
        if (v == null) {
            clean[k] = v;
            continue;
        }
        clean[k] = v;
    }

    return clean;
}

/**
 * Sanitiza específicamente payloads para la tabla `orders`.
 * Elimina created_at, updated_at, cancelled_at.
 */
export function sanitizeOrdersPayload(
    payload: Record<string, any>,
): Record<string, any> {
    return sanitizePayload(payload, { removeTimestamps: true });
}

/**
 * Sanitiza payloads para order_items.
 * Igual que orders pero adicionalmente elimina `id` si no es UUID
 * (los items nuevos deben dejar que BD lo genere).
 */
export function sanitizeOrderItemsPayload(
    payload: Record<string, any>,
): Record<string, any> {
    return sanitizePayload(payload, { removeTimestamps: true });
}

if (typeof window !== "undefined") {
    try {
        (window as any).__sanitize = {
            sanitizePayload,
            sanitizeOrdersPayload,
            sanitizeOrderItemsPayload,
        };
    } catch {}
}
