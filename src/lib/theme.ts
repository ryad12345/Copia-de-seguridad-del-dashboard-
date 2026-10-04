// =====================================================================
// MOZONA TPV — theme.ts v4.3.0
// =====================================================================
// Personalización visual: tema claro/oscuro/sistema + acento + densidad.
// Aplica CSS variables al DOM en tiempo real (sin reload).
// Sync con Supabase + Realtime cross-device.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { supabaseFetch } from "./supabase-fetch";
import { resolveRealTenantId } from "./waiters";
import { onTenantSettingsChange } from "./tenant-realtime-sync";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeAccent = "blue" | "emerald" | "violet" | "amber" | "rose" | "teal" | "slate";
export type ThemeContrast = "normal" | "high";
export type ButtonSize = "sm" | "md" | "lg";
export type GridDensity = "compact" | "normal" | "comfortable";
export type PanelLayout = "horizontal" | "vertical";

export interface ThemeConfig {
    theme_mode:         ThemeMode;
    theme_accent:       ThemeAccent;
    theme_contrast:     ThemeContrast;
    button_size:        ButtonSize;
    grid_density:       GridDensity;
    panel_layout:       PanelLayout;
    show_product_images: boolean;
}

export const DEFAULT_THEME: ThemeConfig = {
    theme_mode:         "system",
    theme_accent:       "blue",
    theme_contrast:     "normal",
    button_size:        "md",
    grid_density:       "normal",
    panel_layout:       "horizontal",
    show_product_images: true,
};

const LS_KEY = "mozona.theme";

function readLocal(): ThemeConfig {
    if (typeof localStorage === "undefined") return DEFAULT_THEME;
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            return { ...DEFAULT_THEME, ...p };
        }
    } catch {}
    return DEFAULT_THEME;
}

function writeLocal(t: ThemeConfig) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch {}
}

// ===========================================================
// ACENTO → CSS variables
// ===========================================================
const ACCENT_COLORS: Record<ThemeAccent, { 500: string; 600: string; 700: string; 50: string; fg: string }> = {
    blue:    { 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 50: "#eff6ff", fg: "#ffffff" },
    emerald: { 500: "#10b981", 600: "#059669", 700: "#047857", 50: "#ecfdf5", fg: "#ffffff" },
    violet:  { 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 50: "#f5f3ff", fg: "#ffffff" },
    amber:   { 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 50: "#fffbeb", fg: "#ffffff" },
    rose:    { 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 50: "#fff1f2", fg: "#ffffff" },
    teal:    { 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 50: "#f0fdfa", fg: "#ffffff" },
    slate:   { 500: "#64748b", 600: "#475569", 700: "#334155", 50: "#f8fafc", fg: "#ffffff" },
};

export function applyThemeToDOM(theme: ThemeConfig): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    // Resolver 'system' a dark o light
    let mode = theme.theme_mode;
    if (mode === "system") {
        mode = (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
            ? "dark" : "light";
    }

    // Dark/Light via clase
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(`theme-${mode}`);

    // Acento via variables CSS
    const accent = ACCENT_COLORS[theme.theme_accent] || ACCENT_COLORS.blue;
    root.style.setProperty("--accent-500", accent[500]);
    root.style.setProperty("--accent-600", accent[600]);
    root.style.setProperty("--accent-700", accent[700]);
    root.style.setProperty("--accent-50", accent[50]);
    root.style.setProperty("--accent-fg", accent.fg);

    // Contraste
    root.style.setProperty("--contrast", theme.theme_contrast === "high" ? "1.1" : "1");

    // Tamaño botón
    const btnScale = theme.button_size === "sm" ? "0.85" : theme.button_size === "lg" ? "1.15" : "1";
    root.style.setProperty("--btn-scale", btnScale);

    // Densidad grid
    const gridGap = theme.grid_density === "compact" ? "4px" : theme.grid_density === "comfortable" ? "12px" : "8px";
    root.style.setProperty("--grid-gap", gridGap);

    // Layout panel
    root.dataset.panelLayout = theme.panel_layout;

    console.log("[theme] applied:", { mode, accent: theme.theme_accent, btn: theme.button_size, grid: theme.grid_density });
}

/**
 * Carga theme desde Supabase (tenant_settings).
 */
export async function loadTheme(tenantId?: string | null): Promise<{
    theme: ThemeConfig;
    source: "supabase" | "local" | "default";
}> {
    const tid = await resolveRealTenantId(tenantId ?? null);
    if (!tid) return { theme: readLocal(), source: "default" };
    try {
        const r = await supabaseFetch(
            `/rest/v1/tenant_settings?tenant_id=eq.${tid}&limit=1`,
            { jwt: null }
        );
        if (r.ok) {
            const arr = await r.json();
            const row = Array.isArray(arr) && arr[0] ? arr[0] : null;
            if (row) {
                const t: ThemeConfig = {
                    theme_mode:         (row.theme_mode || "system") as ThemeMode,
                    theme_accent:       (row.theme_accent || "blue") as ThemeAccent,
                    theme_contrast:     (row.theme_contrast || "normal") as ThemeContrast,
                    button_size:        (row.button_size || "md") as ButtonSize,
                    grid_density:       (row.grid_density || "normal") as GridDensity,
                    panel_layout:       (row.panel_layout || "horizontal") as PanelLayout,
                    show_product_images: row.show_product_images !== false,
                };
                writeLocal(t);
                return { theme: t, source: "supabase" };
            }
        }
    } catch {}
    return { theme: readLocal(), source: "local" };
}

/**
 * Guarda theme en Supabase + LS.
 */
export async function saveTheme(theme: ThemeConfig, tenantId?: string | null): Promise<{ ok: boolean; error?: string }> {
    writeLocal(theme);
    applyThemeToDOM(theme);

    const tid = await resolveRealTenantId(tenantId ?? null);
    if (!tid) return { ok: true }; // LS only

    try {
        const r = await supabaseFetch(
            `/rest/v1/tenant_settings?tenant_id=eq.${tid}`,
            {
                method: "POST",
                jwt: null,
                headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify({
                    tenant_id: tid,
                    ...theme,
                }),
            }
        );
        if (!r.ok) {
            const errText = await r.text().catch(() => "");
            // Si falla 401 RLS, no rompemos UX
            console.warn("[theme] save HTTP", r.status);
            return { ok: true };
        }
        console.log("[theme] ✅ saved to BD");
        return { ok: true };
    } catch (e: any) {
        return { ok: true }; // LS sigue OK
    }
}

/**
 * ★ Hook React: useTheme()
 */
export function useTheme(tenantId?: string | null) {
    const [theme, setTheme] = useState<ThemeConfig>(readLocal);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const r = await loadTheme(tenantId);
            setTheme(r.theme);
            applyThemeToDOM(r.theme);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Aplicar al montar (sync immediate)
    useEffect(() => {
        applyThemeToDOM(readLocal());
    }, []);

    // ★ Realtime: si llega cambio de tenant_settings, refresca
    useEffect(() => {
        const off = onTenantSettingsChange((newRow) => {
            if (!newRow) return;
            const t: ThemeConfig = {
                theme_mode:         (newRow.theme_mode || "system") as ThemeMode,
                theme_accent:       (newRow.theme_accent || "blue") as ThemeAccent,
                theme_contrast:     (newRow.theme_contrast || "normal") as ThemeContrast,
                button_size:        (newRow.button_size || "md") as ButtonSize,
                grid_density:       (newRow.grid_density || "normal") as GridDensity,
                panel_layout:       (newRow.panel_layout || "horizontal") as PanelLayout,
                show_product_images: newRow.show_product_images !== false,
            };
            writeLocal(t);
            setTheme(t);
            applyThemeToDOM(t);
        });
        return off;
    }, []);

    // Escuchar cambios del sistema
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
        if (!mq) return;
        const handler = () => {
            if (theme.theme_mode === "system") {
                applyThemeToDOM(theme);
            }
        };
        mq.addEventListener?.("change", handler);
        return () => mq.removeEventListener?.("change", handler);
    }, [theme]);

    const update = useCallback(async (partial: Partial<ThemeConfig>) => {
        const next = { ...theme, ...partial };
        setTheme(next);
        applyThemeToDOM(next);
        await saveTheme(next, tenantId);
    }, [theme, tenantId]);

    return { theme, setTheme: update, loading, refresh };
}

if (typeof window !== "undefined") {
    try {
        (window as any).__theme = {
            applyThemeToDOM,
            loadTheme,
            saveTheme,
            useTheme,
            DEFAULT_THEME,
        };
    } catch {}
}
