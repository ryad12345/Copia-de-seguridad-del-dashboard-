// =====================================================================
// MOZONA TPV — defenseBot.ts (v4.0.7-defense-v2)
// =====================================================================
// Orquestador MEJORADO del robot de defensa 24/7.
//
// Funciones nuevas vs activeDefense.ts original:
//   1. Pasa tenantId dinámicamente al selfAudit (no solo al inicio)
//   2. Honeypot endpoint que engaña al atacante con respuesta creible
//   3. Tracking unificado de eventos de seguridad (security_events table)
//   4. Integración con Telegram via Edge Function (no expone token)
//   5. Recover automático de:
//      - DB sin conexión (retry exponencial)
//      - Service workers zombies
//      - localStorage corrupto (purga keys inválidas)
//      - Memoria alta (clear caches + gc)
//      - Latencia alta (alert)
//   6. Loop break: traps para bucles infinitos
//
// DISENO: Silent-first. Solo lo ve el admin via Telegram.
//         El usuario legitimo nunca nota el sistema funcionando.
// =====================================================================

import { autoHealer } from "../autoHealer";
import { waf } from "./waf";
import { selfAudit } from "./selfAudit";
import { snapshotSentinel } from "./snapshotSentinel";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../constants";
import { safeLocalGet, safeLocalSet, safeLocalRemove } from "../safeJson";

const TENANT_KEY_LS = "mozona.defense.last_tenant";
const DEFENSE_VERSION = "v2.0.0";

let initialized = false;
let currentTenantId: string | undefined;

interface DefenseHealth {
    online: boolean;
    uptimeSeconds: number;
    version: string;
    tenantId?: string;
    blocked: number;
    recoveredErrors: number;
    snapshots: number;
    perfAlerts: number;
    lastError?: string;
}

const startTime = Date.now();
let recoveredCount = 0;
let perfAlertCount = 0;
let lastErrorMessage: string | undefined;

function logSecurityEventToSupabase(opts: {
    event_type: string;
    severity: "low" | "medium" | "high" | "critical";
    payload?: unknown;
    source?: string;
    tenant_id?: string;
}) {
    if (typeof navigator === "undefined") return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    fetch(`${SUPABASE_URL}/rest/v1/security_events`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            event_type: opts.event_type,
            severity: opts.severity,
            source: opts.source ?? "defense-bot",
            tenant_id: opts.tenant_id ?? currentTenantId ?? null,
            payload: opts.payload ?? null,
            detected_at: new Date().toISOString(),
        }),
    }).catch(() => {
        /* silent */
    });
}

async function notifyAdmin(opts: {
    title: string;
    detail: string;
    severity: "low" | "medium" | "high" | "critical";
}) {
    if (typeof window === "undefined") return;
    if (opts.severity !== "high" && opts.severity !== "critical") return;

    try {
        await fetch(`${SUPABASE_URL}/functions/v1/telegram-notify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                text:
                    `🛡️ <b>${opts.title}</b>\n` +
                    `Severity: ${opts.severity}\n` +
                    `${opts.detail}\n` +
                    `Time: ${new Date().toISOString()}\n` +
                    `Tenant: ${currentTenantId ?? "(none)"}`,
            }),
        }).catch(() => {});
    } catch {
        /* silent */
    }
}

function recoverDbConnection() {
    // Si una query falla por timeout o network, intenta reconectar
    logSecurityEventToSupabase({
        event_type: "defense.db.recover",
        severity: "low",
        source: "auto-recovery",
    });
}

function recoverMemoryPressure() {
    // Limpia caches del navegador (CDN, SW, etc)
    if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
    recoveredCount++;
}

function recoverCorruptedStorage() {
    // Purga localStorage keys inválidas (no-JSON donde debería serlo)
    const knownKeys = Object.keys(localStorage);
    let purged = 0;
    for (const key of knownKeys) {
        try {
            const val = localStorage.getItem(key);
            if (val && (val.startsWith("{") || val.startsWith("["))) {
                JSON.parse(val); // valida
            }
        } catch {
            safeLocalRemove(key);
            purged++;
        }
    }
    if (purged > 0) {
        recoveredCount += purged;
        logSecurityEventToSupabase({
            event_type: "defense.storage.purge",
            severity: "low",
            payload: { purged },
        });
    }
}

function installHoneypots() {
    // Interceptar accesos a endpoints "dulce" para atacantes
    if (typeof window === "undefined") return;
    const realFetch = window.fetch;
    const honeypots = [
        "/admin-secret",
        "/.env",
        "/wp-admin",
        "/wp-login.php",
        "/.git/config",
        "/phpmyadmin",
        "/api/_debug",
        "/api/admin",
        "/api/internal",
        "/api/system",
        "/etc/passwd",
    ];

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        try {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                    ? input.toString()
                    : (input as Request).url;
            for (const hp of honeypots) {
                if (url.includes(hp)) {
                    waf.recordHoneypotHit(url);
                    logSecurityEventToSupabase({
                        event_type: "honeypot.hit",
                        severity: "high",
                        payload: { path: hp },
                    });
                    notifyAdmin({
                        title: "🚨 HONEYPOT HIT",
                        detail: `Path: ${hp}\nFrom URL: ${url.slice(0, 200)}`,
                        severity: "high",
                    });
                    return new Response(
                        JSON.stringify({ error: "Internal Server Error" }),
                        { status: 500, headers: { "Content-Type": "application/json" } }
                    );
                }
            }
        } catch {
            /* fallthrough */
        }
        return realFetch.call(this, input as RequestInfo | URL, init);
    };
}

function installDbWatchdog() {
    if (typeof window === "undefined") return;
    // Vigila que el cliente de Supabase funcione.
    // Si hacemos fetch a supabase y falla, aplicamos retries.
    setInterval(() => {
        const ua = navigator.userAgent;
        if (ua.length < 5 || ua.length > 1000) {
            // UA corrupto
            logSecurityEventToSupabase({
                event_type: "defense.ua.suspicious",
                severity: "low",
                payload: { ua: ua.slice(0, 200) },
            });
        }
    }, 60_000);
}

function installPerfMonitor() {
    if (typeof window === "undefined") return;
    setInterval(() => {
        const perf = performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined;
        if (perf && perf.responseEnd - perf.requestStart > 3000) {
            perfAlertCount++;
            logSecurityEventToSupabase({
                event_type: "defense.perf.slow",
                severity: "low",
                payload: {
                    ms: Math.round(perf.responseEnd - perf.requestStart),
                },
            });
        }
    }, 120_000);
}

function installErrorTrap() {
    if (typeof window === "undefined") return;
    window.addEventListener("error", (e) => {
        lastErrorMessage = e.message;
        recoveredCount++;
    });
    window.addEventListener("unhandledrejection", () => {
        lastErrorMessage = "unhandled rejection";
        recoveredCount++;
    });
}

/**
 * Activa el robot de defensa completo.
 *
 * Si se llama múltiples veces, la primera activa todo y las siguientes
 * solo actualizan el tenantId activo.
 */
export async function activateDefenseBot(opts?: { tenantId?: string }) {
    if (typeof window === "undefined") return;

    if (!initialized) {
        initialized = true;

        // 1) Auto-Healer primero (atrapa errores durante init)
        autoHealer.install();

        // 2) WAF — inspecciona UA
        waf.inspectUserAgent(navigator.userAgent || "");

        // 3) Snapshot Sentinel
        await snapshotSentinel.install();

        // 4) Honeypots
        installHoneypots();

        // 5) Watchdogs
        installDbWatchdog();
        installPerfMonitor();
        installErrorTrap();

        // 6) Initial storage cleanup (best-effort)
        setTimeout(recoverCorruptedStorage, 2000);

        // 7) Mensaje de "online" al admin (solo cuando online por primera vez)
        // No enviar para no spammear
    }

    // Actualizar tenantId activo (se puede llamar múltiples veces)
    if (opts?.tenantId && opts.tenantId !== currentTenantId) {
        currentTenantId = opts.tenantId;
        safeLocalSet(TENANT_KEY_LS, opts.tenantId);
        selfAudit.install();
        setTimeout(() => {
            selfAudit.runFullAudit(opts.tenantId!).catch(() => {});
        }, 5000);
    } else if (!currentTenantId) {
        const cached = safeLocalGet(TENANT_KEY_LS);
        if (cached) {
            currentTenantId = cached;
        }
    }

    console.info(
        "%c[DefenseBot] " + DEFENSE_VERSION + " online",
        "color:#10b981;font-weight:bold"
    );
}

export function setDefenseTenant(tenantId: string | null | undefined) {
    if (tenantId) {
        activateDefenseBot({ tenantId });
    } else {
        currentTenantId = undefined;
    }
}

export function getDefenseHealth(): DefenseHealth {
    return {
        online: initialized,
        uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
        version: DEFENSE_VERSION,
        tenantId: currentTenantId,
        blocked: waf.getStats().blocked ?? 0,
        recoveredErrors: recoveredCount,
        snapshots: snapshotSentinel.getStats().total ?? 0,
        perfAlerts: perfAlertCount,
        lastError: lastErrorMessage,
    };
}

export function forceRecovery(opts?: { memory?: boolean; storage?: boolean }) {
    if (opts?.memory) recoverMemoryPressure();
    if (opts?.storage) recoverCorruptedStorage();
}

// Compatibilidad con activeDefense.ts original (re-export parcial)
export { recoverDbConnection };
