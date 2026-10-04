// =====================================================================
// MOZONA TPV — debug-pos.ts (v4.1.2-debug)
// =====================================================================
// Script de debug ultra-completo que se ejecuta en la consola del navegador.
// Genera un reporte con TODAS las fuentes de datos que CatalogPanel tiene.
// Ejecutar:  await __mozonaDebug.run()
// =====================================================================

import { supabaseFetch } from "./supabase-fetch";

const SUPABASE_URL = "https://hcqkpokodrqimkulporw.supabase.co";
const TARGET_EMAIL = "chalohiahmd1980@gmail.com";
const STORAGE_KEY = `pos_custom_products_${TARGET_EMAIL}`;

interface DebugReport {
    step: string;
    ok: boolean;
    info: any;
    error?: string;
}

const report: DebugReport[] = [];

function log(step: string, ok: boolean, info: any, error?: string) {
    report.push({ step, ok, info, error });
    const icon = ok ? "✅" : "❌";
    console.group(`${icon} ${step}`);
    if (error) console.error("Error:", error);
    console.log("Info:", info);
    console.groupEnd();
}

export const mozonaDebug = {
    /**
     * 🔍 Diagnóstico COMPLETO de la carta de la caja.
     * Ejecutar en consola:  await window.__mozonaDebug.run()
     */
    async run() {
        console.clear();
        console.log("%c🔍 MOZONA TPV — DEBUG DE CARTA", "background:#7c3aed;color:#fff;padding:8px;font-size:14px;font-weight:bold");
        console.log("Ejecutando diagnóstico completo de por qué la caja está vacía...\n");
        report.length = 0;

        // ─────────────────────────────────────────────────────────────
        // PASO 1: ¿Qué hay en localStorage?
        // ─────────────────────────────────────────────────────────────
        const lsKey1 = localStorage.getItem(STORAGE_KEY);
        let lsProducts: any[] = [];
        try {
            if (lsKey1) lsProducts = JSON.parse(lsKey1);
        } catch {}
        log("PASO 1: localStorage '" + STORAGE_KEY + "'", lsProducts.length > 0, {
            count: lsProducts.length,
            sample: lsProducts.slice(0, 3).map((p: any) => p.name),
        });

        // Otras keys relacionadas
        const allKeys = Object.keys(localStorage);
        const productKeys = allKeys.filter(k => /product|menu|carta|item/i.test(k));
        log("PASO 2: Otras keys de localStorage con 'product/menu'", productKeys.length > 0, {
            keys: productKeys,
            contents: productKeys.slice(0, 3).map(k => {
                try {
                    const v = JSON.parse(localStorage.getItem(k) || "[]");
                    return { key: k, count: Array.isArray(v) ? v.length : 0 };
                } catch { return { key: k, count: 0 }; }
            }),
        });

        // ─────────────────────────────────────────────────────────────
        // PASO 3: ¿Qué tenant_id estoy usando?
        // ─────────────────────────────────────────────────────────────
        let tenantFromLS = "";
        try {
            const v = localStorage.getItem("mozona.current_tenant_id");
            if (v) tenantFromLS = v;
        } catch {}
        const mozonaSession = (() => {
            try { return JSON.parse(localStorage.getItem("mozona.session") || "{}"); }
            catch { return {}; }
        })();

        log("PASO 3: Tenant ID", !!tenantFromLS, {
            ls_current_tenant: tenantFromLS,
            mozona_session_user: mozonaSession?.user?.email,
            mozona_session_tenant: mozonaSession?.user?.tenant_id,
        });

        // ─────────────────────────────────────────────────────────────
        // PASO 4: Query directa a Supabase SIN filtrar por tenant
        // ─────────────────────────────────────────────────────────────
        try {
            const r = await supabaseFetch('/rest/v1/products?select=id,name,tenant_id,is_active&limit=10');
            const data = await r.json();
            if (!r.ok) {
                log("PASO 4: Query a Supabase SIN filtro", false, data, data?.message);
            } else {
                log("PASO 4: Query SIN filtro tenant", true, {
                    count: data.length,
                    tenants_unicos: Array.from(new Set(data.map((d: any) => d.tenant_id?.slice(0, 8)))),
                    count_per_tenant: data.reduce((acc: any, d: any) => {
                        const t = d.tenant_id?.slice(0, 8) || "none";
                        acc[t] = (acc[t] || 0) + 1;
                        return acc;
                    }, {}),
                });
            }
        } catch (e: any) {
            log("PASO 4: Query a Supabase", false, null, e?.message);
        }

        // ─────────────────────────────────────────────────────────────
        // PASO 5: Query CON filtro tenant_id
        // ─────────────────────────────────────────────────────────────
        const tenantId = tenantFromLS || "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";
        try {
            const r = await supabaseFetch(
                `/rest/v1/products?select=id,name,price,category,is_active&tenant_id=eq.${tenantId}&order=name.asc`
            );
            const data = await r.json();
            if (!r.ok) {
                log("PASO 5: Query CON filtro tenant_id", false, data, data?.message);
            } else {
                log("PASO 5: Query CON filtro tenant_id (" + tenantId.slice(0, 8) + "...)", true, {
                    count: data.length,
                    sample: data.slice(0, 5).map((p: any) => ({ name: p.name, category: p.category, is_active: p.is_active })),
                });
            }
        } catch (e: any) {
            log("PASO 5: Query CON filtro tenant_id", false, null, e?.message);
        }

        // ─────────────────────────────────────────────────────────────
        // PASO 6: ¿Qué tiene ItemsPanel cargado?
        // ─────────────────────────────────────────────────────────────
        // Buscar en window si hay algún state expuesto
        const itemsPanelState = (window as any).__itemsPanelState;
        log("PASO 6: ItemsPanel state accesible", !!itemsPanelState, itemsPanelState);

        // ─────────────────────────────────────────────────────────────
        // PASO 7: ¿Existe la tabla products y qué RLS tiene?
        // ─────────────────────────────────────────────────────────────
        try {
            const r = await supabaseFetch(
                `/rest/v1/products?select=*&limit=0`
            );
            const dbInfo: any = {};
            // Estos headers no siempre se exponen pero podemos intentar
            log("PASO 7: Conexión básica a tabla products", r.ok, {
                status: r.status,
                headers: {
                    "content-profile": r.headers.get("content-profile"),
                    "content-range": r.headers.get("content-range"),
                },
            });
        } catch (e: any) {
            log("PASO 7: Conexión a tabla products", false, null, e?.message);
        }

        // ─────────────────────────────────────────────────────────────
        // RESUMEN
        // ─────────────────────────────────────────────────────────────
        console.log("\n%c📋 RESUMEN DEL DIAGNÓSTICO", "background:#10b981;color:#fff;padding:8px;font-size:14px;font-weight:bold");
        console.log("Tenant ID que se usa:", tenantId);
        console.log("Productos en localStorage:", lsProducts.length);
        console.log("Productos via Supabase (a confirmar):", "ver paso 5");
        console.log("\n%cSIGUIENTE PASO", "background:#2563eb;color:#fff;padding:4px;margin-top:8px;font-weight:bold");
        console.log("Copia TODO este output y mandamelo por Telegram o por aquí.");
        console.log("Con eso sabré exactamente dónde está el problema.\n");

        return report;
    },

    /**
     * 🚀 Forzar copia de localStorage de ItemsPanel a CatalogPanel.
     * Ejecutar:  await __mozonaDebug.forceCopy()
     */
    async forceCopy() {
        const tenantId = localStorage.getItem("mozona.current_tenant_id") || "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";
        console.log("[forceCopy] Cargando productos de Supabase para tenant:", tenantId);
        const r = await supabaseFetch(
            `/rest/v1/products?select=*&tenant_id=eq.${tenantId}`
        );
        const data = await r.json();
        if (!r.ok) {
            console.error("Error cargando:", data);
            return;
        }
        console.log("[forceCopy] productos cargados:", data.length);
        // Guardar en localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log("[forceCopy] guardado en localStorage:", STORAGE_KEY);
        // Disparar evento para CatalogPanel
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
        console.log("[forceCopy] evento storage disparado. Refresca la página.");
        return data;
    },

    /**
     * 🧹 Sincronizar manualmente y forzar a CatalogPanel a recargar.
     */
    async reload() {
        console.log("[reload] disparando evento storage...");
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
        window.dispatchEvent(new Event("mozona:products-updated"));
        console.log("[reload] hecho. Refresca la página si no se actualiza.");
    },

    /**
     * 🔬 Listar TODAS las keys de localStorage.
     */
    listLocalStorage() {
        const result: Array<{ key: string; size: number; preview: string }> = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)!;
            const v = localStorage.getItem(k) || "";
            result.push({
                key: k,
                size: v.length,
                preview: v.slice(0, 80),
            });
        }
        console.table(result);
        return result;
    },
};

// Exponer en window para uso en consola
(window as any).__mozonaDebug = mozonaDebug;
console.log("%c🔍 MOZONA DEBUG cargado.", "color:#7c3aed;font-weight:bold");
console.log("Comandos disponibles:");
console.log("  await __mozonaDebug.run()        — Diagnóstico completo");
console.log("  await __mozonaDebug.forceCopy()  — Copiar productos de Supabase a localStorage");
console.log("  await __mozonaDebug.reload()     — Forzar recarga");
console.log("  __mozonaDebug.listLocalStorage()— Ver todas las keys");
