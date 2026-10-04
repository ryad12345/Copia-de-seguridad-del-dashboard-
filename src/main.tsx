// =====================================================================
// MOZONA TPV — main.tsx (entry point) v4.0.9-stable
// =====================================================================
// Reglas:
// 1. App SIEMPRE renderiza, aunque TODO lo demas falle
// 2. Modulos opcionales se cargan con dynamic import() + .catch()
// 3. require() NO funciona en browser — uso import() y string ids
// 4. Pantalla blanca PROHIBIDA: fallback minimo SIEMPRE
// =====================================================================

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import { escapeHtml } from "./lib/htmlEscape";

console.log("[MOZONA] v4.0.9-stable loaded at", new Date().toISOString());

// ----------------------------------------------------------------------------
// Defensa: desregistrar service workers viejos (idempotente)
// ----------------------------------------------------------------------------
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
        const nav = navigator as any;
        if (typeof nav.serviceWorker?.getRegistrations === "function") {
            nav.serviceWorker.getRegistrations()
                .then((regs: any[]) => { try { regs.forEach((r: any) => r.unregister()); } catch {} })
                .catch(() => {});
        }
        if ("caches" in window && typeof (window as any).caches?.keys === "function") {
            (window as any).caches.keys()
                .then((keys: string[]) => { try { keys.forEach((k: string) => (window as any).caches.delete(k)); } catch {} })
                .catch(() => {});
        }
    } catch {}
}

// ----------------------------------------------------------------------------
// Render fallback en HTML puro (funciona incluso si React falla)
// ----------------------------------------------------------------------------
const rootEl = document.getElementById("root");

function renderFallback(message: string) {
    try {
        if (!rootEl) return;
        rootEl.innerHTML = `
            <div style="
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: system-ui, -apple-system, sans-serif;
                padding: 20px;
            ">
                <div style="
                    background: white;
                    padding: 32px;
                    border-radius: 16px;
                    max-width: 420px;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                ">
                    <div style="
                        background: linear-gradient(135deg, #7c3aed, #2563eb);
                        color: white;
                        font-weight: 900;
                        font-size: 24px;
                        padding: 12px 20px;
                        border-radius: 12px;
                        margin-bottom: 20px;
                        display: inline-block;
                    ">MOZONA TPV</div>
                    <h1 style="font-size: 18px; color: #1e293b; margin-bottom: 8px;">Iniciando...</h1>
                    <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">${escapeHtml(message)}</p>
                    <button onclick="window.location.reload()" style="
                        background: #2563eb;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                    ">Recargar aplicacion</button>
                </div>
            </div>
        `;
    } catch {}
}

// Pantalla minima anti-blanca inmediatamente
renderFallback("Cargando MOZONA TPV...");

// ----------------------------------------------------------------------------
// Modulos opcionales (no bloquean render)
// ----------------------------------------------------------------------------
try {
    import("./lib/supabase-health").then((m: any) => {
        try {
            if (m && typeof m.startHealthMonitor === "function") {
                m.startHealthMonitor();
            }
        } catch {}
    }).catch(() => {});
} catch {}

try {
    import("./lib/security/defenseBot").then((m: any) => {
        try {
            if (m && typeof m.activateDefenseBot === "function") {
                m.activateDefenseBot();
            }
        } catch {}
    }).catch(() => {});
} catch {}

try {
    import("./lib/debug-pos").catch(() => {});
} catch {}

// ★ v4.2.7: tenant realtime sync (config de empresa al instante en otras pestañas)
try {
    import("./lib/tenant-realtime-sync").then((m: any) => {
        try {
            if (m && typeof m.startTenantRealtimeSync === "function") {
                m.startTenantRealtimeSync().catch(() => {});
            }
        } catch {}
    }).catch(() => {});
} catch {}

// ★ v4.3.0: aplicar tema al DOM al cargar (instantáneo, sin flash)
try {
    import("./lib/theme").then((m: any) => {
        try {
            if (m && typeof m.applyThemeToDOM === "function") {
                const saved = (() => {
                    try {
                        const raw = localStorage.getItem("mozona.theme");
                        if (raw) return JSON.parse(raw);
                    } catch {}
                    return m.DEFAULT_THEME;
                })();
                m.applyThemeToDOM(saved || m.DEFAULT_THEME);
            }
        } catch {}
    }).catch(() => {});
} catch {}

// ----------------------------------------------------------------------------
// Render React — INTENTARLO PRIMERO, si falla usar fallback
// ----------------------------------------------------------------------------
if (rootEl) {
    try {
        createRoot(rootEl).render(
            <StrictMode>
                <App />
            </StrictMode>
        );
    } catch (err) {
        try { console.error("[MOZONA] FATAL render error:", err); } catch {}
        renderFallback("Error al iniciar la aplicacion. Por favor recarga.");
    }
}

// ----------------------------------------------------------------------------
// Error trap global: solo log
// ----------------------------------------------------------------------------
if (typeof window !== "undefined") {
    try {
        window.addEventListener("error", (e) => {
            try {
                const msg = String((e as ErrorEvent).message || "");
                if (msg.includes("Minified React error")) {
                    console.warn("[MOZONA] React error capturado:", msg);
                }
            } catch {}
        });
        window.addEventListener("unhandledrejection", (e) => {
            try { console.warn("[MOZONA] Unhandled rejection:", (e as PromiseRejectionEvent).reason); } catch {}
        });
    } catch {}
}
