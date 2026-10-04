// =====================================================================
// MOZONA TPV — safeFetch (v4.0.7-json-safe + v4.0.7-jwt-auto)
// =====================================================================
// Helper de fetch que NUNCA lanza SyntaxError por respuestas no-JSON.
// Verifica content-type antes de parsear y devuelve un objeto
// estructurado consistente en caso de error.
//
// ★ v4.0.7-jwt-auto: Si la URL va a Supabase REST (/rest/v1/), inyecta
// automáticamente el JWT del usuario activo en Authorization. Esto
// desbloquea RLS para queries autenticadas sin que cada componente
// tenga que añadir el header manualmente.
// =====================================================================

export interface SafeFetchOptions extends RequestInit {
    timeoutMs?: number;
}

export interface SafeFetchResult<T = any> {
    ok: boolean;
    status: number;
    data: T | null;
    error: string | null;
    friendly_message?: string;
    contentType: string;
    _rawPreview?: string;
}

// ★ v4.0.7-jwt-auto: detectar Supabase REST y auto-inyectar JWT
// ★ v4.6.0-jwt-api: también inyectamos el JWT en las llamadas al backend
//   propio (/api/*) para que los endpoints serverless (Vercel) puedan
//   verificar la identidad. Los headers tipo `x-admin-email`/
//   `x-user-email` son spoofables y ya NO se usan.
function shouldAutoInjectJWT(url: string): boolean {
    if (typeof url !== "string") return false;
    if (url.includes("/auth/v1/")) return false;
    return url.includes(".supabase.co/rest/v1/") || /^\/api\//.test(url);
}

async function buildAuthHeaders(original: HeadersInit | undefined): Promise<HeadersInit> {
    const headers: Record<string, string> = {};
    if (original instanceof Headers) {
        original.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(original)) {
        for (const [k, v] of original) headers[k] = v;
    } else if (original) {
        Object.assign(headers, original);
    }

    // Solo inyectar si NO hay Authorization ya (no pisar lo del usuario)
    if (!headers["Authorization"] && !headers["authorization"]) {
        try {
            const { supabase, isSupabaseConfigured } = await import("./supabase");
            if (isSupabaseConfigured) {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }
            }
        } catch {
            // ignore — usar anon key si existe
        }
    }
    return headers;
}

/**
 * Fetch seguro que nunca lanza SyntaxError.
 * Si la respuesta no es JSON válido, devuelve { ok: false, error: "..." }
 * con un friendly_message para mostrar al usuario.
 */
export async function safeFetch<T = any>(
    url: string,
    options: SafeFetchOptions = {}
): Promise<SafeFetchResult<T>> {
    const { timeoutMs = 15000, ...fetchOptions } = options;

    // ★ v4.0.7-jwt-auto: Inyectar JWT si va a Supabase REST
    let finalOptions = { ...fetchOptions };
    if (shouldAutoInjectJWT(url)) {
        finalOptions.headers = await buildAuthHeaders(fetchOptions.headers);
    }

    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
            response = await fetch(url, {
                ...finalOptions,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(tid);
        }

        const contentType = response.headers.get("content-type") || "";

        // ★ Si no es JSON, leer como texto y devolver error estructurado
        if (!contentType.includes("application/json") && !contentType.includes("text/json")) {
            const text = await response.text().catch(() => "");
            return {
                ok: false,
                status: response.status,
                data: null,
                error: `Respuesta no JSON (${contentType || "sin content-type"})`,
                friendly_message: "El servicio no responde correctamente. Reintenta en unos segundos.",
                contentType,
                _rawPreview: text.slice(0, 300),
            };
        }

        // ★ Intentar parsear JSON
        try {
            const data = await response.json();
            if (!response.ok) {
                return {
                    ok: false,
                    status: response.status,
                    data,
                    error: data?.error || data?.message || `HTTP ${response.status}`,
                    friendly_message: data?.friendly_message || "El servicio no responde correctamente.",
                    contentType,
                };
            }
            return {
                ok: true,
                status: response.status,
                data,
                error: null,
                contentType,
            };
        } catch (e: any) {
            const text = await response.text().catch(() => "");
            return {
                ok: false,
                status: response.status,
                data: null,
                error: `JSON malformado: ${e?.message || "unknown"}`,
                friendly_message: "El servicio respondió de forma inesperada. Reintenta en unos segundos.",
                contentType,
                _rawPreview: text.slice(0, 300),
            };
        }
    } catch (e: any) {
        // ★ Network error, timeout, etc
        const isTimeout = e?.name === "AbortError";
        return {
            ok: false,
            status: 0,
            data: null,
            error: isTimeout ? "Timeout" : (e?.message || "Network error"),
            friendly_message: isTimeout
                ? "La operación ha tardado demasiado. Reintenta en unos segundos."
                : "No pudimos conectar con el servicio. Revisa tu conexión a internet.",
            contentType: "",
        };
    }
}
