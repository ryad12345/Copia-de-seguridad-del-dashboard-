// =====================================================================
// MOZONA TPV — ThemeContext (v3.4.0)
// =====================================================================
// Aplica tema (claro/oscuro) + acento (blue/green/orange/red/violet)
// + tamaño de botón + densidad de cuadrícula en toda la app.
// Las variables CSS se aplican al <html> para afectar a todos los hijos.
// =====================================================================

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useTenantSettings, type TenantSettings } from "../hooks/useTenantSettings";

interface ThemeContextValue {
    settings: TenantSettings;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
    settings: {} as TenantSettings,
    isDark: false,
});

export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}

// ★ CSS variables para cada tema
const ACCENT_COLORS: Record<string, { light: string; dark: string }> = {
    blue:   { light: "#2563eb", dark: "#3b82f6" },
    green:  { light: "#16a34a", dark: "#22c55e" },
    orange: { light: "#ea580c", dark: "#f97316" },
    red:    { light: "#dc2626", dark: "#ef4444" },
    violet: { light: "#7c3aed", dark: "#8b5cf6" },
};

const BUTTON_SIZES: Record<string, string> = {
    sm: "36px",
    md: "44px",
    lg: "56px",
};

const GRID_DENSITIES: Record<string, { cols: number; gap: string; size: string }> = {
    compact:      { cols: 5, gap: "4px", size: "12px" },
    normal:       { cols: 4, gap: "8px", size: "14px" },
    comfortable:  { cols: 3, gap: "12px", size: "16px" },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
    const { settings } = useTenantSettings();

    // Detectar modo dark
    const isDark =
        settings.theme_mode === "dark" ||
        (settings.theme_mode === "auto" &&
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);

    // ★ Aplicar CSS variables al <html>
    useEffect(() => {
        try {
            const html = document.documentElement;
            const accent = ACCENT_COLORS[settings.theme_accent] || ACCENT_COLORS.blue;
            const accentColor = isDark ? accent.dark : accent.light;
            const buttonSize = BUTTON_SIZES[settings.button_size] || BUTTON_SIZES.md;
            const density = GRID_DENSITIES[settings.grid_density] || GRID_DENSITIES.normal;

            // ★ Tema
            html.setAttribute("data-theme", isDark ? "dark" : "light");
            html.setAttribute("data-accent", settings.theme_accent || "blue");
            html.setAttribute("data-contrast", settings.theme_contrast || "normal");
            html.setAttribute("data-density", settings.grid_density || "normal");
            html.setAttribute("data-layout", settings.panel_layout || "horizontal");

            // ★ CSS variables
            const root = html.style;
            root.setProperty("--accent-color", accentColor);
            root.setProperty("--accent-color-hover", isDark ? `${accent.dark}dd` : `${accent.light}dd`);
            root.setProperty("--button-size", buttonSize);
            root.setProperty("--grid-cols", String(density.cols));
            root.setProperty("--grid-gap", density.gap);
            root.setProperty("--grid-item-size", density.size);

            // ★ Clases de contraste
            if (settings.theme_contrast === "high") {
                html.classList.add("high-contrast");
            } else {
                html.classList.remove("high-contrast");
            }
        } catch (_) {}
    }, [settings, isDark]);

    return (
        <ThemeContext.Provider value={{ settings, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
}
