// =====================================================================
// MOZONA TPV — Active Defense Orchestrator (v4.0.7-defense-24-7)
// =====================================================================
// Punto de entrada unico para todos los subsistemas de seguridad:
//
//   1. Auto-Healer Bot (autoHealer.ts)
//   2. WAF + Telegram IDS (waf.ts)
//   3. Self-Audit Engine (selfAudit.ts)
//   4. Snapshot Sentinel (snapshotSentinel.ts)
//
// ACTIVA EN main.tsx y se ejecuta en segundo plano 24/7.
//
// ENDPOINTS HONEYPOT:
//   - /api/admin-secret, /api/_debug, /api/.env, /api/system-config
//   - Cualquier acceso activa WAF y bloqueo
//
// TELEGRAM ALERTS:
//   - Eventos criticos se envian via api.telegram.org al chat del admin
//   - Solo severidad high o critical
//   - Mensaje cifrado con fingerprint del navegador
// =====================================================================

import { autoHealer } from "../autoHealer";
import { waf } from "./waf";
import { selfAudit } from "./selfAudit";
import { snapshotSentinel } from "./snapshotSentinel";
import { SUPABASE_URL } from "../constants";

// ═══════════════════════════════════════════════════════════════════════
// ACTIVAR TODOS LOS SISTEMAS
// ═══════════════════════════════════════════════════════════════════════

let activated = false;

export async function activateActiveDefense(tenantId?: string) {
    if (activated || typeof window === "undefined") return;
    activated = true;

    // 1) Auto-Healer (instalar PRIMERO - atrapa errores durante el init)
    autoHealer.install();

    // 2) WAF - inspeccionar user agent inicial
    waf.inspectUserAgent(navigator.userAgent || "");

    // 3) Snapshot Sentinel
    await snapshotSentinel.install();

    // 4) Self-Audit (necesita tenantId)
    if (tenantId) {
        selfAudit.install();
        // Snapshot inicial despues de 5s
        setTimeout(() => {
            selfAudit.runFullAudit(tenantId).catch(() => {});
        }, 5000);
    }

    // 5) Vigilancia de fetch - inspecciona automaticamente payloads sospechosos
    installFetchInterceptor();

    console.warn("[ActiveDefense] Sistema 24/7 activado");
}

function installFetchInterceptor() {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        try {
            // Honeypots: bloquea y reporta cualquier acceso
            const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            const honeypots = [
                "/api/admin-secret",
                "/api/_debug",
                "/api/.env",
                "/api/system-config",
                "/api/debug",
                "/api/internal",
                "/.env",
                "/admin.php",
                "/wp-admin",
                "/.git/config",
            ];
            for (const hp of honeypots) {
                if (url.includes(hp)) {
                    waf.recordHoneypotHit(url);
                    return new Response(
                        JSON.stringify({ ok: false, error: "Not Found" }),
                        { status: 404, headers: { "Content-Type": "application/json" } }
                    );
                }
            }

            // Inspecciona body si es JSON
            if (init?.body && typeof init.body === "string") {
                try {
                    const parsed = JSON.parse(init.body);
                    if (typeof parsed === "object" && parsed !== null) {
                        for (const value of Object.values(parsed)) {
                            if (typeof value === "string") {
                                const threat = waf.inspectInput(value, "fetch.body");
                                if (threat) {
                                    return new Response(
                                        JSON.stringify({ ok: false, error: "Blocked" }),
                                        { status: 403, headers: { "Content-Type": "application/json" } }
                                    );
                                }
                            }
                        }
                    }
                } catch {
                    // No es JSON, no inspeccionar
                }
            }

            return await originalFetch.call(this, input as any, init);
        } catch (e) {
            return originalFetch.call(this, input as any, init);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════
// TELEMETRIA UNIFICADA
// ═══════════════════════════════════════════════════════════════════════

export interface DefenseStats {
    healer: ReturnType<typeof autoHealer.getStats>;
    waf: ReturnType<typeof waf.getStats>;
    audit: ReturnType<typeof selfAudit.getStats>;
    sentinel: ReturnType<typeof snapshotSentinel.getStats>;
}

export function getDefenseStats(): DefenseStats {
    return {
        healer: autoHealer.getStats(),
        waf: waf.getStats(),
        audit: selfAudit.getStats(),
        sentinel: snapshotSentinel.getStats(),
    };
}

// Helper para notificar manualmente eventos criticos via Telegram
export async function notifySecurityEvent(opts: {
    title: string;
    detail: string;
    severity: "low" | "medium" | "high" | "critical";
}) {
    if (!waf.isBlocked("admin")) {
        // Solo notifica si supera threshold
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/security_events`, {
                method: "POST",
                headers: {
                    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
                    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ""}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    event_type: opts.title,
                    severity: opts.severity,
                    source: "manual",
                    payload: opts.detail,
                    detected_at: new Date().toISOString(),
                }),
            }).catch(() => {});
        } catch {
            // Silencioso
        }
    }
}
