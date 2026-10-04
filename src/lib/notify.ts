// =====================================================================
// MOZONA TPV — notify.ts (cliente, v1.9.64 DEFINITIVO + WATCHDOG)
// =====================================================================
// Wrapper cliente para envío de emails de leads.
// POST a /api/send-email (Vercel Serverless Function).
// CERO credenciales en el bundle del cliente.
// Triple capa anti-bloqueo: AbortController + Watchdog + Fallback mailto
// =====================================================================

const ADMIN_EMAIL_DEFAULT = "rofixinsta@gmail.com";
const CLIENT_TIMEOUT_MS = 6000;
const WATCHDOG_TIMEOUT_MS = 9000;

export interface LeadEmailData {
    leadId?:         string;
    restaurantName?: string;
    userEmail?:      string;
    selectedPlan?:   string;
    businessType?:   string;
    source?:         string;
    trialEndsAt?:    string;
    status?:         string;
}

export type SendVia = "vercel-proxy" | "network-error" | "client-timeout" | "watchdog";

export interface SendResult {
    ok:          boolean;
    error?:      string;
    via:         SendVia;
    statusCode?: number;
    to?:         string;
    leadId?:     string;
}

/** ★★★ FUNCIÓN PRINCIPAL ★★★
 *  POST a /api/send-email con TRIPLE timeout:
 *  1. AbortController 6s (cliente HTTP)
 *  2. Watchdog 9s (fuerza salida pase lo que pase)
 *  3. Si todo falla, devuelve error claro (NUNCA cuelga)
 *  SIEMPRE devuelve un SendResult, NUNCA lanza excepción. */
export async function sendLeadEmail(data: LeadEmailData): Promise<SendResult> {
    // ★ WATCHDOG: promesa que se rechaza tras 9s pase lo que pase
    let watchdogResolve!: (value: SendResult) => void;
    const watchdog = new Promise<SendResult>((resolve) => {
        watchdogResolve = resolve;
    });
    const watchdogId = setTimeout(() => {
        console.warn("[notify] WATCHDOG: forzando salida a los 9s");
        watchdogResolve({
            ok: false,
            error: "Timeout: el servidor no respondió en 9 segundos (watchdog)",
            via: "watchdog",
        });
    }, WATCHDOG_TIMEOUT_MS);

    // ★ ABORTCONTROLLER: cancela el fetch a los 6s
    const controller = new AbortController();
    const abortId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    const mainPromise = (async (): Promise<SendResult> => {
        try {
            console.log("[notify] POST /api/send-email", data);
            const resp = await fetch("/api/send-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify(data),
                signal: controller.signal,
            });
            clearTimeout(abortId);
            console.log("[notify] response status:", resp.status, "CT:", resp.headers.get("content-type"));

            // ★ Si la respuesta no es JSON, error claro
            const contentType = resp.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                // ★ v1.9.68: el rewrite está interceptando /api/* (devuelve HTML)
                // El cliente debe hacer hard refresh o esperar al deploy
                const body = await resp.text().catch(() => "");
                console.error("[notify] non-JSON response, first 200 chars:", body.substring(0, 200));
                return {
                    ok: false,
                    error: `El endpoint /api/send-email devolvió ${contentType || "HTML"} en vez de JSON. ` +
                           `Esto significa que Vercel aún no detectó la serverless function. ` +
                           `Espera al deploy y haz hard refresh.`,
                    via: "network-error",
                    statusCode: resp.status,
                };
            }

            let json: any = null;
            try { json = await resp.json(); } catch (_) {
                return {
                    ok: false,
                    error: `JSON inválido del servidor (HTTP ${resp.status})`,
                    via: "network-error",
                    statusCode: resp.status,
                };
            }

            console.log("[notify] response json:", json);

            if (!resp.ok || !json?.ok) {
                return {
                    ok: false,
                    error: json?.error ?? `HTTP ${resp.status}`,
                    via: "network-error",
                    statusCode: resp.status,
                };
            }

            return {
                ok: true,
                via: "vercel-proxy",
                statusCode: resp.status,
                to: json.to,
                leadId: json.leadId,
            };
        } catch (e: any) {
            clearTimeout(abortId);
            if (e?.name === "AbortError") {
                return {
                    ok: false,
                    error: "Timeout: el servidor no respondió en 6 segundos",
                    via: "client-timeout",
                };
            }
            console.error("[notify] network error:", e);
            return {
                ok: false,
                error: e?.message ?? "Error de red",
                via: "network-error",
            };
        }
    })();

    // ★ Carrera entre mainPromise y watchdog: el que termine primero gana
    try {
        const result = await Promise.race([mainPromise, watchdog]);
        clearTimeout(abortId);
        clearTimeout(watchdogId);
        return result;
    } catch (e: any) {
        clearTimeout(abortId);
        clearTimeout(watchdogId);
        return {
            ok: false,
            error: e?.message ?? "Error desconocido",
            via: "network-error",
        };
    }
}

export function getAdminEmail(): string {
    return ADMIN_EMAIL_DEFAULT;
}

// ────────── Compatibilidad legacy ──────────

export const EMAILJS_CONFIGURED = false;

export interface EmailJSConfigStatus {
    configured: boolean;
    missing:    string[];
    invalid:    string[];
    values:     { serviceId: string; templateId: string; publicKey: string };
    rawLengths: { serviceId: number; templateId: number; publicKey: number };
    source:     "env" | "fallback" | "none";
}

export function checkEmailJSConfig(): EmailJSConfigStatus {
    return {
        configured: false,
        missing: ["VITE_EMAILJS_*"],
        invalid: [],
        values: { serviceId: "", templateId: "", publicKey: "" },
        rawLengths: { serviceId: 0, templateId: 0, publicKey: 0 },
        source: "none",
    };
}

if (typeof window !== "undefined") {
    console.log(
        "%c[notify] v1.9.64",
        "background:#10b981;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
        "POST /api/send-email. Triple timeout: AbortController 6s + Watchdog 9s."
    );
}
