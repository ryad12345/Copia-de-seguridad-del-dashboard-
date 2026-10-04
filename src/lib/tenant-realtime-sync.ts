// =====================================================================
// MOZONA TPV — tenant-realtime-sync v4.2.7
// =====================================================================
// Sincroniza en tiempo real los cambios de:
//   - tenants (business_name, cif_nif, address, phone, ticket_*)
//   - tenant_settings (footer_text, header_text, theme, layout)
// Cuando otro dispositivo cambia la config, esta UI se actualiza sola.
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import { supabaseFetch } from "./supabase-fetch";

type TenantChangeHandler = (newTenant: any) => void;
type TenantSettingsChangeHandler = (newSettings: any) => void;

const tenantHandlers = new Set<TenantChangeHandler>();
const settingsHandlers = new Set<TenantSettingsChangeHandler>();
let started = false;

const LS_KEY = "mozona.empresa";

function writeLocalCompany(row: any) {
    if (typeof localStorage === "undefined") return;
    try {
        const ls = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
        ls.tenant_id         = row.id ?? ls.tenant_id;
        ls.business_name     = row.business_name ?? ls.business_name ?? "";
        ls.cif_nif           = row.cif_nif       ?? ls.cif_nif ?? "";
        ls.address           = row.address       ?? ls.address ?? "";
        ls.phone             = row.phone         ?? ls.phone ?? "";
        ls.contact_email     = row.contact_email ?? ls.contact_email ?? "";
        ls.ticket_header_msg = row.ticket_header_msg ?? ls.ticket_header_msg ?? "";
        ls.ticket_footer_msg = row.ticket_footer_msg ?? ls.ticket_footer_msg ?? "";
        ls.ticket_show_tax   = row.ticket_show_tax !== false;
        localStorage.setItem(LS_KEY, JSON.stringify(ls));
    } catch {}
}

/**
 * Suscribe un handler al realtime de tenants. Devuelve cleanup.
 */
export function onTenantChange(h: TenantChangeHandler): () => void {
    tenantHandlers.add(h);
    return () => { tenantHandlers.delete(h); };
}

/**
 * Suscribe un handler al realtime de tenant_settings. Devuelve cleanup.
 */
export function onTenantSettingsChange(h: TenantSettingsChangeHandler): () => void {
    settingsHandlers.add(h);
    return () => { settingsHandlers.delete(h); };
}

/**
 * Arranca el listener realtime. Idempotente.
 */
export async function startTenantRealtimeSync(): Promise<void> {
    if (started) return;
    const tid = await resolveRealTenantId(null);
    if (!tid) {
        console.warn("[tenant-realtime] sin tenantId, no se suscribe");
        return;
    }

    const channelName = `tenant-realtime-${tid}-${Date.now()}`;
    const ch = supabase.channel(channelName);

    ch
        .on("postgres_changes",
            { event: "*", schema: "public", table: "tenants", filter: `id=eq.${tid}` },
            (p: any) => {
                console.log("[tenant-realtime] tenants changed:", p.eventType);
                const newRow = p.new;
                if (newRow) writeLocalCompany(newRow);
                tenantHandlers.forEach((h) => {
                    try { h(newRow); } catch (e) { console.warn("[tenant-realtime] handler err:", e); }
                });
            }
        )
        .on("postgres_changes",
            { event: "*", schema: "public", table: "tenant_settings", filter: `tenant_id=eq.${tid}` },
            (p: any) => {
                console.log("[tenant-realtime] tenant_settings changed:", p.eventType);
                const newRow = p.new;
                settingsHandlers.forEach((h) => {
                    try { h(newRow); } catch (e) { console.warn("[tenant-realtime] handler err:", e); }
                });
            }
        )
        .subscribe((status: string) => {
            console.log("[tenant-realtime] status:", status);
        });

    started = true;
    console.log("[tenant-realtime] iniciado, tenant=", tid);
}

/**
 * Fuerza recarga inmediata desde BD (sin esperar realtime).
 */
export async function refreshTenantFromDb(tenantId?: string): Promise<any | null> {
    const tid = tenantId || (await resolveRealTenantId(null));
    if (!tid) return null;
    try {
        const r = await supabaseFetch(
            `/rest/v1/tenants?id=eq.${tid}&select=business_name,cif_nif,address,phone,contact_email,ticket_header_msg,ticket_footer_msg,ticket_show_tax&limit=1`,
            { jwt: null }
        );
        if (!r.ok) return null;
        const arr = await r.json();
        const row = Array.isArray(arr) && arr[0] ? arr[0] : null;
        if (row) {
            writeLocalCompany(row);
            tenantHandlers.forEach((h) => {
                try { h(row); } catch {}
            });
        }
        return row;
    } catch (e: any) {
        console.warn("[tenant-realtime] refresh error:", e?.message);
        return null;
    }
}

if (typeof window !== "undefined") {
    try {
        (window as any).__tenantRealtime = {
            onTenantChange,
            onTenantSettingsChange,
            startTenantRealtimeSync,
            refreshTenantFromDb,
        };
    } catch {}
}
