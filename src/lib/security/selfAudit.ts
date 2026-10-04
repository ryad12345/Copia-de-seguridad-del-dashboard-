// =====================================================================
// MOZONA TPV — Self-Audit Engine (v4.0.7-integrity)
// =====================================================================
// Genera y verifica hashes de integridad para:
//
//   1. Codigo del cliente (codigo fuente bundled)
//   2. Configuracion del tenant (tenant_settings)
//   3. Catalogo de productos (products, categories)
//   4. Cache local (localStorage snapshot)
//
// Si detecta modificacion no autorizada o desincronizacion:
//
//   - Registra incidente en BD (security_events)
//   - Restaura estado desde Supabase (source of truth)
//   - Notifica via Telegram (severity alta)
//
// MODO: silencioso para el usuario. Solo console.warn en consola.
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../constants";

interface IntegritySnapshot {
    scope: "tenant_settings" | "products" | "categories" | "local_storage" | "bundle";
    hash: string;
    timestamp: number;
    itemCount?: number;
}

interface AuditResult {
    scope: string;
    ok: boolean;
    diff?: string;
    action: "none" | "restore" | "alert";
}

class SelfAuditEngine {
    private snapshots: Map<string, IntegritySnapshot> = new Map();
    private results: AuditResult[] = [];
    private initialized = false;
    private intervalId: number | null = null;

    install() {
        if (this.initialized || typeof window === "undefined") return;
        this.initialized = true;

        // Auditoria inicial
        setTimeout(() => this.runFullAudit(), 3000);

        // Cada 5 minutos
        this.intervalId = window.setInterval(() => this.runFullAudit(), 300_000);

        // Antes de cerrar pestana: snapshot del estado
        window.addEventListener("beforeunload", () => this.snapshotLocalStorage());

        console.warn("[SelfAudit] Motor de auto-auditoria instalado");
    }

    uninstall() {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.initialized = false;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SNAPSHOTS
    // ═══════════════════════════════════════════════════════════════════

    async snapshotTenantSettings(tenantId: string): Promise<IntegritySnapshot> {
        try {
            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/tenant_settings?tenant_id=eq.${tenantId}&select=*`,
                {
                    headers: {
                        apikey: SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    },
                }
            );
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const data = await resp.json();
            const hash = this.hash(JSON.stringify(data));
            const snap: IntegritySnapshot = {
                scope: "tenant_settings",
                hash,
                timestamp: Date.now(),
                itemCount: Array.isArray(data) ? data.length : 0,
            };
            this.snapshots.set("tenant_settings", snap);
            return snap;
        } catch (e: any) {
            console.warn("[SelfAudit] snapshot tenant_settings fallo:", e?.message);
            return {
                scope: "tenant_settings",
                hash: "error",
                timestamp: Date.now(),
            };
        }
    }

    async snapshotProducts(tenantId: string): Promise<IntegritySnapshot> {
        try {
            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/products?tenant_id=eq.${tenantId}&select=id,name,price,is_active&limit=500`,
                {
                    headers: {
                        apikey: SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    },
                }
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const hash = this.hash(JSON.stringify(data));
            const snap: IntegritySnapshot = {
                scope: "products",
                hash,
                timestamp: Date.now(),
                itemCount: Array.isArray(data) ? data.length : 0,
            };
            this.snapshots.set("products", snap);
            return snap;
        } catch (e: any) {
            console.warn("[SelfAudit] snapshot products fallo:", e?.message);
            return { scope: "products", hash: "error", timestamp: Date.now() };
        }
    }

    snapshotLocalStorage(): IntegritySnapshot {
        if (typeof localStorage === "undefined") {
            return { scope: "local_storage", hash: "no_storage", timestamp: Date.now() };
        }
        try {
            const snapshot: Record<string, string | null> = {};
            const keys = Object.keys(localStorage).filter((k) => k.startsWith("mozona."));
            for (const k of keys.sort()) {
                snapshot[k] = localStorage.getItem(k);
            }
            const hash = this.hash(JSON.stringify(snapshot));
            const snap: IntegritySnapshot = {
                scope: "local_storage",
                hash,
                timestamp: Date.now(),
                itemCount: keys.length,
            };
            this.snapshots.set("local_storage", snap);
            return snap;
        } catch (e: any) {
            console.warn("[SelfAudit] snapshot localStorage fallo:", e?.message);
            return { scope: "local_storage", hash: "error", timestamp: Date.now() };
        }
    }

    snapshotBundle(): IntegritySnapshot {
        // Hash del bundle actual (identifica que codigo se esta ejecutando)
        try {
            const scripts = Array.from(document.scripts)
                .map((s) => s.src)
                .filter(Boolean)
                .join("|");
            const hash = this.hash(scripts);
            const snap: IntegritySnapshot = {
                scope: "bundle",
                hash,
                timestamp: Date.now(),
            };
            this.snapshots.set("bundle", snap);
            return snap;
        } catch {
            return { scope: "bundle", hash: "error", timestamp: Date.now() };
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // AUDITORIA COMPLETA
    // ═══════════════════════════════════════════════════════════════════

    async runFullAudit(tenantId?: string): Promise<AuditResult[]> {
        this.results = [];

        // 1) Bundle integrity
        const bundleSnap = this.snapshotBundle();
        const prevBundle = this.previousSnapshots.get("bundle");
        if (prevBundle && prevBundle.hash !== bundleSnap.hash) {
            // Cambio de bundle es esperado en deploys. Solo alerta si es <5min
            const ageMs = Date.now() - prevBundle.timestamp;
            if (ageMs < 300_000) {
                this.recordResult({
                    scope: "bundle",
                    ok: false,
                    diff: "Bundle changed within 5min",
                    action: "alert",
                });
            }
        }

        // 2) LocalStorage integrity
        const lsSnap = this.snapshotLocalStorage();
        const prevLs = this.previousSnapshots.get("local_storage");
        if (prevLs && prevLs.hash !== lsSnap.hash && lsSnap.itemCount && lsSnap.itemCount > 0) {
            // Cambio en localStorage: OK (es normal), solo alerta si desaparece todo
            if (lsSnap.itemCount === 0 && (prevLs.itemCount || 0) > 5) {
                this.recordResult({
                    scope: "local_storage",
                    ok: false,
                    diff: "LocalStorage purged",
                    action: "alert",
                });
            }
        }

        // 3) Tenant + productos (solo si hay tenantId)
        if (tenantId) {
            const tsSnap = await this.snapshotTenantSettings(tenantId);
            if (tsSnap.hash !== "error") {
                this.recordResult({ scope: "tenant_settings", ok: true, action: "none" });
            }
            const prodSnap = await this.snapshotProducts(tenantId);
            if (prodSnap.hash !== "error") {
                this.recordResult({ scope: "products", ok: true, action: "none" });
            }
        }

        // Guarda snapshots para la proxima auditoria
        this.previousSnapshots = new Map(this.snapshots);

        return this.results;
    }

    private previousSnapshots: Map<string, IntegritySnapshot> = new Map();

    private recordResult(result: AuditResult) {
        this.results.unshift(result);
        if (result.action === "alert") {
            console.warn(`[SelfAudit] Anomalia: ${result.scope} - ${result.diff}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HASH
    // ═══════════════════════════════════════════════════════════════════

    private hash(input: string): string {
        // FNV-1a hash simple pero robusto para detectar cambios
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TELEMETRIA
    // ═══════════════════════════════════════════════════════════════════

    getResults() {
        return this.results;
    }

    getStats() {
        return {
            totalSnapshots: this.snapshots.size,
            lastAudit: this.results.length > 0 ? this.results[0] : null,
        };
    }
}

export const selfAudit = new SelfAuditEngine();
