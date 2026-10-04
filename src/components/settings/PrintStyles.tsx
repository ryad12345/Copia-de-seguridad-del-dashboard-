// =====================================================================
// MOZONA TPV — PrintStyles (v4.0.7-print-dynamic)
// =====================================================================
// Inyecta CSS @media print con tamaño de página DINÁMICO según
// ticket_paper_width (48/58/80mm).
// - Lee el ancho de localStorage o sessionStorage
// - Inserta/actualiza un <style id="mozona-print-dynamic"> en el <head>
// - Se ejecuta en cada montaje para refrescar tras cambios
// =====================================================================

import { useEffect } from "react";

const STYLE_ID = "mozona-print-dynamic";

/**
 * Genera CSS @media print con tamaño de página DINÁMICO.
 * El truco: usamos CSS @page con un selector :root que tiene la variable
 * --mozona-paper-mm, pero @page no soporta custom properties en todos los
 * navegadores. Solución REAL: generar 3 reglas condicionales y activar
 * la correcta con una clase en <html>.
 */
function buildPrintCSS(paperWidth: 48 | 58 | 80): string {
    // Ancho efectivo (descontando dientes de la tiquetera)
    const effectiveWidth = paperWidth === 48 ? 44 : paperWidth === 58 ? 48 : 72;

    return `
/* ★ v4.0.7-print-dynamic: ${paperWidth}mm dinámico */
@media print {
  @page {
    size: ${paperWidth}mm auto;
    margin: 0mm;
  }

  /* Forzar body a ancho del rollo efectivo */
  html[data-paper-width="${paperWidth}"] body,
  html[data-paper-width="${paperWidth}"] #root {
    width: ${effectiveWidth}mm !important;
    max-width: ${effectiveWidth}mm !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  html[data-paper-width="${paperWidth}"] #thermal-ticket-print {
    width: ${effectiveWidth}mm !important;
    max-width: ${effectiveWidth}mm !important;
  }

  /* Ocultar TODO lo demás */
  html[data-paper-width="${paperWidth}"] body * {
    visibility: hidden !important;
  }

  html[data-paper-width="${paperWidth}"] #thermal-ticket-print,
  html[data-paper-width="${paperWidth}"] #thermal-ticket-print * {
    visibility: visible !important;
  }

  html[data-paper-width="${paperWidth}"] #thermal-ticket-print {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
  }
}
`;
}

/**
 * Lee el ancho de ticket guardado en localStorage (cache de useTenantSettings).
 */
function getStoredPaperWidth(): 48 | 58 | 80 {
    try {
        const cached = localStorage.getItem("mozona.tenantSettings");
        if (cached) {
            const parsed = JSON.parse(cached);
            const w = parsed?.ticket_paper_width;
            if (w === 48 || w === 58 || w === 80) return w;
        }
    } catch (_) {}
    return 58;
}

export function PrintStyles() {
    useEffect(() => {
        const applyStyles = () => {
            const paperWidth = getStoredPaperWidth();

            // 1) Inyectar CSS dinámico
            let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = STYLE_ID;
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = buildPrintCSS(paperWidth);

            // 2) Marcar html con data-paper-width (para CSS condicional)
            document.documentElement.setAttribute("data-paper-width", String(paperWidth));
        };

        applyStyles();

        // Re-aplicar cuando cambie localStorage (desde otro tab o desde el editor)
        const onStorage = (e: StorageEvent) => {
            if (e.key === "mozona.tenantSettings") applyStyles();
        };
        window.addEventListener("storage", onStorage);

        // Re-aplicar en cada foco de ventana (para refrescar tras editar)
        const onFocus = () => applyStyles();
        window.addEventListener("focus", onFocus);

        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    return null;
}
