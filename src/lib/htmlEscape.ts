// =====================================================================
// MOZONA TPV — htmlEscape: helper compartido de escape HTML
// =====================================================================
// Escapa los cinco caracteres significativos para un contexto de texto /
// valor de atributo HTML: & < > " '
//
// Uso: SOLO para valores que se interpolan en HTML (texto o atributos).
// NO usar para valores insertados en contextos no-HTML (p. ej. números
// dentro de CSS o de unidades mm), ya que el escapado los corrompería.
// =====================================================================

const HTML_ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

/** Escapa &, <, >, " y ' para interpolación segura en HTML. */
export function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
}
