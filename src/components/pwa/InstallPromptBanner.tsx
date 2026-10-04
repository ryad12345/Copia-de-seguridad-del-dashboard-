// =====================================================================
// MOZONA TPV — InstallPromptBanner
// =====================================================================
// Banner estilo iOS que invita a instalar la PWA:
//   • En Chrome/Edge/Opera: usa el prompt nativo (`canInstall`)
//   • En iOS Safari: muestra instrucciones Compartir → Añadir a inicio
//   • Animación de entrada (slide-up)
// =====================================================================

import { useState } from "react";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { IconX, IconDownload, IconShare, IconPlus, IconStore, IconCheck } from "../icons";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function InstallPromptBanner() {
    const ip = useInstallPrompt();
    const [showIOSHelp, setShowIOSHelp] = useState(false);
    const [outcome, setOutcome] = useState<"accepted" | "dismissed" | "unavailable" | null>(null);

    // No mostrar si ya está instalada, ya fue descartada, o no aplica
    if (ip.isStandalone || ip.dismissed) return null;
    if (!ip.canInstall && !ip.isIOS) return null;

    const handleInstall = async () => {
        const r = await ip.promptInstall();
        setOutcome(r);
    };

    return (
        <div
            className={cn(
                "fixed bottom-0 inset-x-0 z-40 p-3 sm:p-4",
                "pointer-events-none",
            )}
        >
            <div
                className={cn(
                    "pointer-events-auto",
                    "max-w-md mx-auto",
                    "bg-white/95 backdrop-blur-xl",
                    "rounded-2xl shadow-2xl",
                    "border border-slate-200/80",
                    "overflow-hidden",
                    "animate-[slideUp_0.3s_ease-out]",
                )}
            >
                {ip.isIOS ? (
                    <IOSView
                        expanded={showIOSHelp}
                        onToggleHelp={() => setShowIOSHelp(v => !v)}
                        onDismiss={ip.dismiss}
                    />
                ) : (
                    <ChromiumView
                        onInstall={handleInstall}
                        onDismiss={ip.dismiss}
                        outcome={outcome}
                    />
                )}
            </div>

            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

// ---------------------------------------------------------------------
// Vista Chromium (Chrome/Edge/Opera)
// ---------------------------------------------------------------------

function ChromiumView({
    onInstall, onDismiss, outcome,
}: {
    onInstall:  () => void;
    onDismiss:  () => void;
    outcome:    "accepted" | "dismissed" | "unavailable" | null;
}) {
    return (
        <div className="p-4 flex items-start gap-3">
            <div
                className="
                    w-12 h-12 rounded-2xl
                    bg-gradient-to-br from-blue-600 to-blue-700
                    text-white flex items-center justify-center
                    shadow-sm shadow-blue-600/30 shrink-0
                "
            >
                <IconStore size={22} strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-bold text-slate-900 leading-tight">
                    Instalar MOZONA TPV
                </div>
                <p className="text-[12px] text-slate-600 mt-0.5 leading-snug">
                    Acceso directo, sin barra de direcciones, funciona offline.
                    <strong className="text-blue-700"> 1 clic</strong>.
                </p>
            </div>
            <button
                onClick={onDismiss}
                className="
                    w-8 h-8 rounded-full
                    text-slate-400 hover:bg-slate-100 hover:text-slate-700
                    flex items-center justify-center transition active:scale-90
                "
                title="Cerrar"
            >
                <IconX size={16} strokeWidth={2.2} />
            </button>

            <div className="w-full flex gap-2 mt-2">
                <button
                    onClick={onDismiss}
                    className="
                        flex-1 h-10 rounded-xl
                        bg-slate-100 text-slate-700
                        text-[13px] font-semibold
                        hover:bg-slate-200 active:scale-95 transition
                    "
                >
                    Más tarde
                </button>
                <button
                    onClick={onInstall}
                    className="
                        flex-[1.4] h-10 rounded-xl
                        bg-blue-600 text-white
                        text-[13px] font-bold
                        shadow-sm shadow-blue-600/30
                        hover:bg-blue-700 active:scale-95 transition
                        inline-flex items-center justify-center gap-1.5
                    "
                >
                    {outcome === "accepted" ? (
                        <><IconCheck size={14} strokeWidth={2.4} /> Instalada</>
                    ) : outcome === "dismissed" ? (
                        "Cancelado"
                    ) : (
                        <><IconDownload size={14} strokeWidth={2.2} /> Instalar</>
                    )}
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Vista iOS Safari (instrucciones)
// ---------------------------------------------------------------------

function IOSView({
    expanded, onToggleHelp, onDismiss,
}: { expanded: boolean; onToggleHelp: () => void; onDismiss: () => void }) {
    return (
        <div>
            <div className="p-4 flex items-start gap-3">
                <div
                    className="
                        w-12 h-12 rounded-2xl
                        bg-gradient-to-br from-blue-600 to-blue-700
                        text-white flex items-center justify-center
                        shadow-sm shadow-blue-600/30 shrink-0
                    "
                >
                    <IconStore size={22} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-bold text-slate-900 leading-tight">
                        Instalar en este iPad/iPhone
                    </div>
                    <p className="text-[12px] text-slate-600 mt-0.5 leading-snug">
                        Safari no permite instalar con 1 clic. Toca
                        <span className="inline-flex items-center mx-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">
                            <IconShare size={10} strokeWidth={2.4} className="mr-0.5" />
                            Compartir
                        </span>
                        y luego
                        <span className="inline-flex items-center mx-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">
                            <IconPlus size={10} strokeWidth={2.4} className="mr-0.5" />
                            Añadir a pantalla de inicio
                        </span>.
                    </p>
                </div>
                <button
                    onClick={onDismiss}
                    className="
                        w-8 h-8 rounded-full
                        text-slate-400 hover:bg-slate-100 hover:text-slate-700
                        flex items-center justify-center transition active:scale-90
                    "
                    title="Cerrar"
                >
                    <IconX size={16} strokeWidth={2.2} />
                </button>
            </div>

            <button
                onClick={onToggleHelp}
                className="
                    w-full px-4 py-2
                    bg-slate-50 text-slate-700
                    text-[12px] font-semibold
                    border-t border-slate-100
                    hover:bg-slate-100 transition
                "
            >
                {expanded ? "Ocultar pasos" : "Ver pasos detallados"}
            </button>

            {expanded && (
                <ol className="
                    px-4 py-3 space-y-2
                    bg-slate-50
                    text-[12px] text-slate-700
                    border-t border-slate-100
                ">
                    <li className="flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
                        Toca el botón <strong className="font-bold">Compartir</strong>
                        <IconShare size={12} strokeWidth={2.4} className="inline mx-0.5 text-blue-600" />
                        en la barra inferior de Safari.
                    </li>
                    <li className="flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">2</span>
                        Selecciona <strong className="font-bold">Añadir a pantalla de inicio</strong>
                        <IconPlus size={12} strokeWidth={2.4} className="inline mx-0.5 text-blue-600" />.
                    </li>
                    <li className="flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">3</span>
                        Confirma con <strong className="font-bold">Añadir</strong>. La app aparecerá como un icono más en tu pantalla.
                    </li>
                </ol>
            )}
        </div>
    );
}
