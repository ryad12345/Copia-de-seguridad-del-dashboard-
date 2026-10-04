// =====================================================================
// MOZONA TPV — FloatingAssistantButton
// =====================================================================
// Botón flotante GLOBAL para abrir el asistente "Riyad" desde cualquier
// página (Landing, Auth, /app, /admin/*, etc.).
//
// API GLOBAL (dispara el modal desde cualquier sitio):
//
//   import { openAssistant } from "../../components/assistant/FloatingAssistantButton";
//   <button onClick={() => openAssistant({ source: "landing" })}>...</button>
//
//   o bien, en cualquier código:
//
//     window.dispatchEvent(new CustomEvent("mozona:open-assistant", {
//       detail: { source: "paywall" }
//     }));
//
// Diseño:
//   - fixed bottom-5 right-5
//   - Botón píldora con avatar "R" + texto + dot online
//   - Sombra suave, ring violet
//   - Tooltip en hover
//   - En móvil: solo el avatar (compacto) + texto corto
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { AIAssistantModal } from "./AIAssistantModal";
import type { AssistantSource } from "../../lib/chatLeads";

type Source = AssistantSource;

interface OpenDetail {
    source?:  Source;
    ctxEmail?: string;
    ctxName?:  string;
    ctxPlan?:  import("../../lib/chatLeads").PlanCode;
}

// ★ v1.9.50: rutas donde el asistente se OCULTA (POS, operativa de cobro)
// ★ v4.0.3: ampliado para incluir rutas publicas y de auth
const HIDDEN_ROUTES: string[] = ["/app", "/auth", "/", "/reset-password", "/register", "/waiter/login", "/setup-caja"];
// ★ rutas donde el asistente actúa como copiloto de configuración
const CONFIG_ROUTES: string[] = ["/settings"];

/** ★ API pública: abre el modal del asistente */
export function openAssistant(detail: OpenDetail = {}) {
    window.dispatchEvent(new CustomEvent("mozona:open-assistant", { detail }));
}

export function closeAssistant() {
    window.dispatchEvent(new CustomEvent("mozona:close-assistant"));
}

export function FloatingAssistantButton() {
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [source, setSource] = useState<Source>("floating");
    const [ctxEmail, setCtxEmail] = useState<string | undefined>();
    const [ctxName,  setCtxName]  = useState<string | undefined>();
    const [ctxPlan,  setCtxPlan]  = useState<import("../../lib/chatLeads").PlanCode | undefined>();
    const [hovered, setHovered] = useState(false);

    // ★ v1.9.50: visibilidad por ruta
    const isHiddenRoute  = HIDDEN_ROUTES.some(r  => location.pathname === r || location.pathname.startsWith(r + "/"));
    const isConfigRoute  = CONFIG_ROUTES.some(r  => location.pathname === r || location.pathname.startsWith(r + "/"));
    const mode: "floating" | "config" = isConfigRoute ? "config" : "floating";

    // Escuchar eventos globales
    useEffect(() => {
        const openHandler = (e: Event) => {
            const detail = (e as CustomEvent<OpenDetail>).detail ?? {};
            setSource(detail.source ?? "floating");
            setCtxEmail(detail.ctxEmail);
            setCtxName(detail.ctxName);
            setCtxPlan(detail.ctxPlan);
            setOpen(true);
        };
        const closeHandler = () => setOpen(false);
        window.addEventListener("mozona:open-assistant", openHandler);
        window.addEventListener("mozona:close-assistant", closeHandler);
        return () => {
            window.removeEventListener("mozona:open-assistant", openHandler);
            window.removeEventListener("mozona:close-assistant", closeHandler);
        };
    }, []);

    const handleClick = useCallback(() => {
        setSource(isConfigRoute ? "settings" : "floating");
        setOpen(true);
    }, [isConfigRoute]);

    // ★ v1.9.50: ocultar en POS para no estorbar la operativa
    if (isHiddenRoute) return null;

    return (
        <>
            <button
                type="button"
                onClick={handleClick}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                aria-label="Hablar con Riyad, tu asistente MOZONA TPV"
                className="fixed z-[100] bottom-5 right-5
                           group flex items-center gap-2.5
                           h-12 pr-4 pl-1.5 rounded-full
                           bg-white text-slate-900
                           border border-slate-200/80
                           shadow-lg shadow-violet-500/20
                           hover:shadow-xl hover:shadow-violet-500/30
                           hover:-translate-y-0.5
                           active:scale-95
                           transition-all duration-200
                           ring-1 ring-violet-200/50 hover:ring-violet-300
                           print:hidden"
            >
                {/* Avatar Riyad */}
                <span className="relative shrink-0">
                    <span className="w-9 h-9 rounded-full
                                     bg-gradient-to-br from-violet-600 to-violet-700
                                     flex items-center justify-center
                                     text-white text-[14px] font-black
                                     ring-2 ring-white shadow-md">
                        R
                    </span>
                    {/* Dot online */}
                    <span className="absolute -bottom-0.5 -right-0.5
                                     flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full
                                         rounded-full bg-emerald-400 opacity-70
                                         animate-ping" />
                        <span className="relative inline-flex h-3 w-3
                                         rounded-full bg-emerald-500
                                         border-2 border-white" />
                    </span>
                </span>

                {/* Texto (compacto en móvil) */}
                <span className="flex flex-col items-start leading-tight pr-1">
                    <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">
                        ¿Ayuda?
                    </span>
                    <span className="text-[12.5px] font-black tracking-tight">
                        Habla con <span className="text-violet-700">Riyad</span>
                    </span>
                </span>

                {/* Tooltip hover (solo desktop) */}
                {hovered && (
                    <span className="absolute bottom-full mb-2 right-0
                                     hidden sm:block whitespace-nowrap
                                     bg-slate-900 text-white text-[10.5px]
                                     px-2.5 py-1.5 rounded-lg
                                     shadow-xl pointer-events-none">
                        <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            En línea · Configura tu prueba de 7 días
                        </span>
                    </span>
                )}
            </button>

            <AIAssistantModal
                open={open}
                onClose={() => setOpen(false)}
                source={source}
                ctxEmail={ctxEmail}
                ctxName={ctxName}
                ctxPlan={ctxPlan}
                mode={mode}
            />
        </>
    );
}
