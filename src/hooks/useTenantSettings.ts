// =====================================================================
// MOZONA TPV — useTenantSettings (v4.0.7-bidir-sync)
// =====================================================================
// Hook que carga y guarda la configuración del tenant actual.
// ★ v4.0.7: USA SUPABASE DIRECTO (no endpoint Vercel caído).
//   - Lectura: bidirectionalSync.fetchWithCache → Supabase
//   - Escritura: bidirectionalSync.writeWithSync → Supabase
//   - Cache local como UX inmediata (offline-first)
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useActiveSession } from "./useActiveSession";
import {
    fetchWithCache,
    writeWithSync,
    getCurrentTenantId,
} from "../lib/bidirectionalSync";
import { rpcSaveTenantSettings, rpcLoadTenantSettings } from "../lib/secureRpc";

export interface TenantSettings {
    id?: string;
    tenant_id?: string;

    // Tickets
    ticket_paper_width: 48 | 58 | 80;
    ticket_header_text: string;
    ticket_footer_text: string;
    ticket_show_id: boolean;
    ticket_show_date: boolean;
    ticket_show_time: boolean;
    ticket_show_table: boolean;
    ticket_show_waiter: boolean;
    ticket_show_payment: boolean;
    ticket_show_vat: boolean;

    // ★ v3.4.5: Editor visual tipo Canva
    ticket_logo_url?: string;
    ticket_layout_json?: TicketElement[];

    // Tema
    theme_mode: "light" | "dark" | "auto";
    theme_accent: "blue" | "green" | "orange" | "red" | "violet";
    theme_contrast: "normal" | "high";

    // UI
    button_size: "sm" | "md" | "lg";
    grid_density: "compact" | "normal" | "comfortable";
    panel_layout: "horizontal" | "vertical";
    show_product_images: boolean;
}

// ★ v3.4.5: Elementos del canvas
export type TicketElementType =
    | "logo"        // imagen/logo
    | "text"        // texto libre
    | "block_info"  // ID/Fecha/Hora/Mesa
    | "block_lines" // líneas de productos
    | "block_totals"; // subtotal/IVA/total

export interface TicketElement {
    id: string;
    type: TicketElementType;
    x: number;       // % desde la izquierda (0-100)
    y: number;       // % desde arriba (0-100)
    w: number;       // % del ancho (0-100)
    h: number;       // % del alto (0-100)
    visible: boolean;
    // Para type=text
    content?: string;
    fontSize?: number;
    fontWeight?: number;
    align?: "left" | "center" | "right";
    // Para type=logo
    src?: string;
    // Para type=block_info
    fields?: Array<"id" | "date" | "time" | "table" | "waiter" | "payment">;
}

// ★ Layout por defecto
export const DEFAULT_TICKET_LAYOUT: TicketElement[] = [
    { id: "logo-1",  type: "logo",        x: 35, y: 0,  w: 30, h: 14, visible: false, src: "" },
    { id: "text-1",  type: "text",        x: 0,  y: 15, w: 100, h: 6, visible: true, content: "MI RESTAURANTE", fontSize: 13, fontWeight: 900, align: "center" },
    { id: "info-1",  type: "block_info",  x: 0,  y: 23, w: 100, h: 16, visible: true, fields: ["id", "date", "time", "table", "waiter"] },
    { id: "lines-1", type: "block_lines", x: 0,  y: 41, w: 100, h: 40, visible: true },
    { id: "tot-1",   type: "block_totals",x: 0,  y: 84, w: 100, h: 9, visible: true },
    { id: "foot-1",  type: "text",        x: 0,  y: 95, w: 100, h: 5, visible: true, content: "Gracias por su visita!", fontSize: 9, fontWeight: 700, align: "center" },
];

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
    ticket_paper_width: 48,
    ticket_header_text: "",
    ticket_footer_text: "",
    ticket_show_id: true,
    ticket_show_date: true,
    ticket_show_time: true,
    ticket_show_table: true,
    ticket_show_waiter: true,
    ticket_show_payment: true,
    ticket_show_vat: true,
    theme_mode: "light",
    theme_accent: "blue",
    theme_contrast: "normal",
    button_size: "md",
    grid_density: "normal",
    panel_layout: "horizontal",
    show_product_images: true,
};

const CACHE_KEY = "mozona.tenantSettings";

export function useTenantSettings() {
    const session = useActiveSession();
    const [settings, setSettings] = useState<TenantSettings>(() => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return { ...DEFAULT_TENANT_SETTINGS, ...parsed };
            }
        } catch (_) {}
        return DEFAULT_TENANT_SETTINGS;
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cargar desde Supabase (vía bidirectionalSync)
    const load = useCallback(async () => {
        if (!session.email && !session.isAuthenticated) return;
        setLoading(true);
        setError(null);
        try {
            const tenantId = await getCurrentTenantId();
            if (!tenantId) {
                setError("Sin tenant activo");
                setLoading(false);
                return;
            }

            // ★ v4.0.7-bidir-sync: lee directo de Supabase con cache local
            const { data, source } = await fetchWithCache<any>(
                "tenant_settings",
                tenantId,
                { forceRefresh: true }
            );

            if (data && data.length > 0) {
                const row = data[0];
                const merged: TenantSettings = {
                    ...DEFAULT_TENANT_SETTINGS,
                    ticket_paper_width: row.ticket_paper_width || DEFAULT_TENANT_SETTINGS.ticket_paper_width,
                    ticket_header_text: row.header_text || "",
                    ticket_footer_text: row.footer_text || "",
                    ticket_show_id: row.show_vat_breakdown ?? true,
                    ticket_show_date: true,
                    ticket_show_time: true,
                    ticket_show_table: true,
                    ticket_show_waiter: true,
                    ticket_show_payment: true,
                    ticket_show_vat: row.show_vat_breakdown ?? true,
                    ticket_layout_json: row.ticket_layout_json || undefined,
                    theme_mode: (row.theme_mode as any) || "light",
                    theme_accent: (row.theme_accent as any) || "blue",
                    theme_contrast: (row.theme_contrast as any) || "normal",
                    button_size: (row.button_size as any) || "md",
                    grid_density: (row.grid_density as any) || "normal",
                    panel_layout: (row.panel_layout as any) || "horizontal",
                    show_product_images: row.show_product_images ?? true,
                };
                setSettings(merged);
                try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch (_) {}
                console.log("[useTenantSettings] cargado desde Supabase:", source);
            } else {
                // No hay settings en BD: usar cache local o defaults
                const cached = localStorage.getItem(CACHE_KEY);
                if (cached) {
                    try {
                        setSettings({ ...DEFAULT_TENANT_SETTINGS, ...JSON.parse(cached) });
                    } catch (_) {}
                } else {
                    setSettings(DEFAULT_TENANT_SETTINGS);
                }
                console.log("[useTenantSettings] sin settings en BD, usando cache/defaults");
            }
            setError(null);
        } catch (e: any) {
            console.warn("[useTenantSettings] load exception:", e);
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    setSettings({ ...DEFAULT_TENANT_SETTINGS, ...JSON.parse(cached) });
                } catch (_) {}
            } else {
                setSettings(DEFAULT_TENANT_SETTINGS);
            }
            setError(null);
        }
        setLoading(false);
    }, [session.email, session.isAuthenticated]);

    // Guardar en Supabase (vía bidirectionalSync.writeWithSync)
    const save = useCallback(async (newSettings: Partial<TenantSettings>) => {
        if (!session.email && !session.isAuthenticated) {
            setError(null);
            return false;
        }
        setSaving(true);
        setError(null);
        try {
            const merged = { ...settings, ...newSettings };

            // 1) Aplicar optimistamente
            setSettings(merged);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch (_) {}

            // 2) Persistir en Supabase vía bidirectionalSync
            const tenantId = await getCurrentTenantId();
            if (!tenantId) {
                setSaving(false);
                return false;
            }

            // Mapear TenantSettings → tenant_settings row format
            const dbPayload = {
                tenant_id: tenantId,
                header_text: merged.ticket_header_text || null,
                footer_text: merged.ticket_footer_text || null,
                show_vat_breakdown: merged.ticket_show_vat ?? true,
                ticket_paper_width: merged.ticket_paper_width || 58,
                ticket_layout_json: merged.ticket_layout_json || null,
                theme_mode: merged.theme_mode || "light",
                theme_accent: merged.theme_accent || "blue",
                theme_contrast: merged.theme_contrast || "normal",
                button_size: merged.button_size || "md",
                grid_density: merged.grid_density || "normal",
                panel_layout: merged.panel_layout || "horizontal",
                show_product_images: merged.show_product_images ?? true,
                updated_at: new Date().toISOString(),
            };

            // 3) Persistir via REST API directa con JWT/anon key (v4.2.5)
            //    SQL #62 añade columnas faltantes + RLS permisiva
            console.log("[useTenantSettings] guardando via supabaseFetch UPSERT...");
            try {
                const jwt = (await import('../lib/auth-helpers')).getUserJwt();
                const { supabaseFetch } = await import('../lib/supabase-fetch');
                const r = await supabaseFetch(
                    "/rest/v1/tenant_settings?on_conflict=tenant_id",
                    {
                        method: "POST",
                        jwt,
                        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
                        body: JSON.stringify(dbPayload),
                    }
                );
                if (r.ok || r.status === 201 || r.status === 204) {
                    console.log("[useTenantSettings] ✅ guardado en BD status", r.status);
                    setSaving(false);
                    return true;
                }
                const errText = await r.text().catch(() => "");
                console.warn("[useTenantSettings] HTTP", r.status, errText);
            } catch (e: any) {
                console.warn("[useTenantSettings] supabaseFetch error:", e?.message);
            }

            // Fallback: intentar RPC (puede no existir)
            try {
                const result = await rpcSaveTenantSettings(dbPayload);
                if (result.ok) {
                    console.log("[useTenantSettings] guardado OK via RPC");
                    setSaving(false);
                    return true;
                }
                console.warn("[useTenantSettings] fallo RPC:", result.error);
            } catch (e: any) {
                console.warn("[useTenantSettings] RPC error:", e?.message);
            }

            // Cache local siempre actualizado (UX offline-first)
            console.log("[useTenantSettings] save solo cache local (BD no disponible)");
            setSaving(false);
            return true;
        } catch (e: any) {
            console.warn("[useTenantSettings] save exception:", e);
            setError(null);
            setSaving(false);
            return true;
        }
    }, [settings, session.email, session.isAuthenticated]);

    // Cargar al montar
    useEffect(() => {
        if (session.isAuthenticated) {
            load();
        }
    }, [session.isAuthenticated, load]);

    return { settings, loading, saving, error, save, load, setSettings };
}
