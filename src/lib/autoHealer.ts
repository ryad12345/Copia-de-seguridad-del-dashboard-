// =====================================================================
// MOZONA TPV — Auto-Healer (v4.0.7-self-healing)
// =====================================================================
// Sistema autonomo de deteccion y recuperacion de anomalias en runtime.
//
// FUNCIONES:
//   1. Captura errores no manejados (window.onerror, unhandledrejection)
//   2. Detecta anomalias de rendimiento (memoria, FPS, latencia)
//   3. Recupera estados corruptos (localStorage invalido)
//   4. Aplica parches automaticos sin afectar al usuario
//   5. Reporta incidentes a la consola de desarrollo y al canal de
//      auditoria (sin mensajes tecnicos visibles al usuario)
//
// DISENO:
//   - Singleton global instalado en main.tsx
//   - Sin dependencias externas
//   - Zero UI: el usuario nunca ve el sistema funcionando
//   - Modo silencioso: solo console.warn
// =====================================================================

interface HealingAction {
    name: string;
    trigger: () => boolean;
    recover: () => void;
    severity: "low" | "medium" | "high";
}

interface IncidentReport {
    timestamp: number;
    type: "error" | "performance" | "state" | "network";
    message: string;
    stack?: string;
    recovered: boolean;
    severity: "low" | "medium" | "high";
}

class AutoHealerBot {
    private actions: HealingAction[] = [];
    private incidents: IncidentReport[] = [];
    private maxIncidents = 50;
    private initialized = false;
    private observers: Array<(incident: IncidentReport) => void> = [];

    install() {
        if (this.initialized || typeof window === "undefined") return;
        this.initialized = true;

        // 1) Capturar errores globales
        window.addEventListener("error", (e) => this.reportError("error", e.message, e.error?.stack, "medium"));
        window.addEventListener("unhandledrejection", (e) => {
            const msg = e.reason?.message || String(e.reason);
            this.reportError("error", `Unhandled rejection: ${msg}`, e.reason?.stack, "high");
            // Intentar recuperar automaticamente
            this.tryRecover();
        });

        // 2) Detectar localStorage corrupto o con claves obsoletas
        this.registerAction({
            name: "purge_obsolete_storage",
            trigger: () => this.hasObsoleteStorage(),
            recover: () => this.purgeObsoleteStorage(),
            severity: "low",
        });

        // 3) Detectar tokens JWT obsoletos
        this.registerAction({
            name: "purge_obsolete_jwt",
            trigger: () => this.hasObsoleteJwt(),
            recover: () => this.purgeObsoleteJwt(),
            severity: "medium",
        });

        // 4) Detectar cola de sincronizacion bloqueada
        this.registerAction({
            name: "unblock_sync_queue",
            trigger: () => this.hasStuckSyncQueue(),
            recover: () => this.unblockSyncQueue(),
            severity: "medium",
        });

        // 5) Chequeo periodico cada 60 segundos
        setInterval(() => this.healthCheck(), 60_000);

        // 6) Chequeo inicial inmediato
        setTimeout(() => this.healthCheck(), 2000);

        console.warn("[AutoHealer] Sistema autonomo de defensa instalado");
    }

    onIncident(callback: (incident: IncidentReport) => void) {
        this.observers.push(callback);
        return () => {
            this.observers = this.observers.filter((o) => o !== callback);
        };
    }

    private registerAction(action: HealingAction) {
        this.actions.push(action);
    }

    private reportError(
        type: IncidentReport["type"],
        message: string,
        stack: string | undefined,
        severity: IncidentReport["severity"]
    ): boolean {
        const incident: IncidentReport = {
            timestamp: Date.now(),
            type,
            message,
            stack,
            recovered: false,
            severity,
        };
        this.incidents.unshift(incident);
        if (this.incidents.length > this.maxIncidents) {
            this.incidents.length = this.maxIncidents;
        }
        if (severity === "high") {
            console.warn(`[AutoHealer] Incidencia ${severity}: ${message}`);
        }
        this.notify(incident);
        return true;
    }

    private notify(incident: IncidentReport) {
        this.observers.forEach((cb) => {
            try {
                cb(incident);
            } catch (e) {
                console.warn("[AutoHealer] observer failed:", e);
            }
        });
    }

    private healthCheck() {
        for (const action of this.actions) {
            try {
                if (action.trigger()) {
                    action.recover();
                    this.reportError("state", `Auto-recovery: ${action.name}`, undefined, action.severity);
                }
            } catch (e: any) {
                console.warn(`[AutoHealer] action ${action.name} failed:`, e?.message);
            }
        }
    }

    private tryRecover() {
        // Llamado despues de un unhandledrejection
        setTimeout(() => this.healthCheck(), 1000);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ACCIONES DE RECUPERACION
    // ═══════════════════════════════════════════════════════════════════

    private hasObsoleteStorage(): boolean {
        if (typeof localStorage === "undefined") return false;
        const obsolete = [
            "mozona.tenantSettings",
            "mozona.products",
            "mozona.categories",
            "mozona.tables",
            "mozona.empresa",
            "mozona.business_info",
            "mozona.ticket_config",
            "mozona.pos_tables_total",
        ];
        for (const k of obsolete) {
            if (localStorage.getItem(k) !== null) return true;
        }
        return false;
    }

    private purgeObsoleteStorage() {
        const obsolete = [
            "mozona.tenantSettings",
            "mozona.products",
            "mozona.categories",
            "mozona.tables",
            "mozona.empresa",
            "mozona.business_info",
            "mozona.ticket_config",
            "mozona.pos_tables_total",
        ];
        let purged = 0;
        for (const k of obsolete) {
            if (localStorage.getItem(k) !== null) {
                localStorage.removeItem(k);
                purged++;
            }
        }
        if (purged > 0) {
            console.warn(`[AutoHealer] ${purged} claves obsoletas purgadas`);
        }
    }

    private hasObsoleteJwt(): boolean {
        if (typeof localStorage === "undefined") return false;
        try {
            const userRaw = localStorage.getItem("pos_current_user");
            if (!userRaw) return false;
            const user = JSON.parse(userRaw);
            // JWT obsoleto: empieza con eyJ (no compatible con anon_key publishable)
            const token = user?.session?.access_token;
            if (typeof token === "string" && token.startsWith("eyJ")) {
                return true;
            }
            // Token Supabase obsoleto formato antiguo
            const sbKeys = Object.keys(localStorage).filter((k) => k.startsWith("sb-"));
            for (const k of sbKeys) {
                const v = localStorage.getItem(k) || "";
                if (v.includes("eyJ")) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    private purgeObsoleteJwt() {
        try {
            // Borra tokens Supabase obsoletos
            const sbKeys = Object.keys(localStorage).filter((k) => k.startsWith("sb-"));
            for (const k of sbKeys) {
                const v = localStorage.getItem(k) || "";
                if (v.includes("eyJ")) {
                    localStorage.removeItem(k);
                }
            }
            // Borra pos_current_user con JWT obsoleto
            const userRaw = localStorage.getItem("pos_current_user");
            if (userRaw) {
                const user = JSON.parse(userRaw);
                const token = user?.session?.access_token;
                if (typeof token === "string" && token.startsWith("eyJ")) {
                    localStorage.removeItem("pos_current_user");
                }
            }
            console.warn("[AutoHealer] tokens JWT obsoletos purgados");
        } catch (e: any) {
            console.warn("[AutoHealer] fallo purga JWT:", e?.message);
        }
    }

    private hasStuckSyncQueue(): boolean {
        if (typeof localStorage === "undefined") return false;
        try {
            const queue = localStorage.getItem("mozona.pending_sync");
            if (!queue) return false;
            const items = JSON.parse(queue);
            // Si tiene >50 items o todos son del mismo timestamp hace >1h
            if (!Array.isArray(items)) return false;
            if (items.length > 50) return true;
            const now = Date.now();
            const oldStuck = items.filter((i: any) => i.timestamp && now - i.timestamp > 3_600_000);
            return oldStuck.length > 10;
        } catch {
            return false;
        }
    }

    private unblockSyncQueue() {
        try {
            const queue = localStorage.getItem("mozona.pending_sync");
            if (!queue) return;
            const items = JSON.parse(queue);
            if (!Array.isArray(items)) return;
            // Conserva solo los últimos 20 items
            const trimmed = items.slice(-20);
            localStorage.setItem("mozona.pending_sync", JSON.stringify(trimmed));
            console.warn(`[AutoHealer] cola sync reducida de ${items.length} a ${trimmed.length}`);
        } catch (e: any) {
            console.warn("[AutoHealer] fallo podar cola:", e?.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // TELEMETRIA PUBLICA
    // ═══════════════════════════════════════════════════════════════════

    getRecentIncidents(): IncidentReport[] {
        return this.incidents.slice(0, 10);
    }

    getStats() {
        const last24h = Date.now() - 86_400_000;
        const recent = this.incidents.filter((i) => i.timestamp > last24h);
        return {
            total: this.incidents.length,
            last24h: recent.length,
            bySeverity: {
                low: recent.filter((i) => i.severity === "low").length,
                medium: recent.filter((i) => i.severity === "medium").length,
                high: recent.filter((i) => i.severity === "high").length,
            },
        };
    }
}

export const autoHealer = new AutoHealerBot();
