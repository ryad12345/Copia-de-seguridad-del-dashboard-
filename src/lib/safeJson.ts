// =====================================================================
// MOZONA TPV — safeJson.ts (v4.0.7-defender)
// =====================================================================
// Helpers para parseo JSON seguro con fallback y recuperación.
// =====================================================================

/**
 * Parsea un string JSON de forma segura. Si falla, devuelve `fallback`.
 * Si el resultado no es del tipo esperado (type guard), devuelve `fallback`.
 */
export function safeJsonParse<T>(
    raw: string | null | undefined,
    fallback: T,
    validator?: (v: unknown) => v is T
): T {
    if (!raw) return fallback;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (validator && !validator(parsed)) {
            console.warn("[safeJson] tipo inesperado, usando fallback");
            return fallback;
        }
        return parsed as T;
    } catch (e) {
        console.warn("[safeJson] parse error:", e instanceof Error ? e.message : String(e));
        return fallback;
    }
}

/**
 * Wrapper de localStorage.getItem que nunca lanza excepciones.
 * Útil cuando el navegador está en modo privado o tiene cuota llena.
 */
export function safeLocalGet(key: string): string | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

/**
 * Wrapper de localStorage.setItem que nunca lanza excepciones.
 */
export function safeLocalSet(key: string, value: string): boolean {
    try {
        if (typeof localStorage === "undefined") return false;
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn("[safeLocal] setItem error:", e instanceof Error ? e.message : String(e));
        return false;
    }
}

/**
 * Wrapper de localStorage.removeItem que nunca lanza excepciones.
 */
export function safeLocalRemove(key: string): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

/**
 * JSON.stringify con try/catch y manejo de referencias circulares.
 */
export function safeStringify(value: unknown, fallback = "{}"): string {
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_k, v) => {
            if (typeof v === "object" && v !== null) {
                if (seen.has(v as object)) return "[Circular]";
                seen.add(v as object);
            }
            return v;
        });
    } catch (e) {
        console.warn("[safeJson] stringify error:", e instanceof Error ? e.message : String(e));
        return fallback;
    }
}
