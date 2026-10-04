// =====================================================================
// MOZONA TPV — Assistant global API (v4.0.7-cleanup)
// =====================================================================
// API pública para abrir/cerrar el ChatPro desde cualquier componente.
// Usa CustomEvents para desacoplar el emisor del receptor.
// =====================================================================

export interface AssistantOpenDetail {
    source?: "floating" | "landing" | "help" | "trial_banner" | "billing";
    initialMessage?: string;
    ctxPlan?: string;
    [key: string]: any;
}

/** Abre el modal del asistente. */
export function openAssistant(detail: AssistantOpenDetail = {}) {
    window.dispatchEvent(new CustomEvent("mozona:open-assistant", { detail }));
}

/** Cierra el modal del asistente. */
export function closeAssistant() {
    window.dispatchEvent(new CustomEvent("mozona:close-assistant"));
}
