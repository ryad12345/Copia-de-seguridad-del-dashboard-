// =====================================================================
// MOZONA TPV — UpdatePrompt
// =====================================================================
// Banner iOS que avisa al usuario de que hay una nueva versión disponible
// y le permite recargar para aplicarla. Se muestra cuando vite-plugin-pwa
// detecta un Service Worker actualizado en background.
// =====================================================================

import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { IconRefresh, IconX, IconCheck } from "../icons";
import { cn } from "../../lib/cn";

export function UpdatePrompt() {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        offlineReady: [offlineReady, setOfflineReady],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_url: string, _reg: ServiceWorkerRegistration | undefined) {
            // Opcionalmente: detectar updates manualmente aquí
        },
        onRegisterError(err: unknown) {
            console.error("[PWA] Error registrando SW:", err);
        },
    });

    // Auto-hide del toast "Listo offline"
    useEffect(() => {
        if (!offlineReady) return;
        const t = setTimeout(() => setOfflineReady(false), 4000);
        return () => clearTimeout(t);
    }, [offlineReady, setOfflineReady]);

    if (needRefresh) {
        return (
            <div
                className={cn(
                    "fixed bottom-3 right-3 z-40",
                    "max-w-sm",
                    "bg-white rounded-2xl shadow-2xl",
                    "border border-slate-200/80",
                    "p-3.5 flex items-start gap-3",
                    "animate-[slideIn_0.3s_ease-out]",
                )}
            >
                <div className="
                    w-10 h-10 rounded-xl
                    bg-blue-50 text-blue-600
                    flex items-center justify-center shrink-0
                ">
                    <IconRefresh size={18} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold text-slate-900">
                        Nueva versión disponible
                    </div>
                    <p className="text-[11.5px] text-slate-600 mt-0.5">
                        Recarga para aplicar la actualización.
                    </p>
                    <div className="mt-2 flex gap-1.5">
                        <button
                            onClick={() => setNeedRefresh(false)}
                            className="
                                px-2.5 h-7 rounded-lg
                                text-[11.5px] font-semibold
                                text-slate-500 hover:bg-slate-100
                                transition
                            "
                        >
                            Luego
                        </button>
                        <button
                            onClick={() => updateServiceWorker(true)}
                            className="
                                px-3 h-7 rounded-lg
                                bg-blue-600 text-white
                                text-[11.5px] font-bold
                                shadow-sm shadow-blue-600/30
                                hover:bg-blue-700 active:scale-95 transition
                            "
                        >
                            Recargar
                        </button>
                    </div>
                </div>
                <button
                    onClick={() => setNeedRefresh(false)}
                    className="
                        w-7 h-7 rounded-full
                        text-slate-400 hover:bg-slate-100
                        flex items-center justify-center
                    "
                >
                    <IconX size={14} strokeWidth={2.2} />
                </button>

                <style>{`
                    @keyframes slideIn {
                        from { opacity: 0; transform: translateX(20px); }
                        to   { opacity: 1; transform: translateX(0); }
                    }
                `}</style>
            </div>
        );
    }

    if (offlineReady) {
        return (
            <div
                className="
                    fixed bottom-3 right-3 z-40
                    max-w-sm
                    bg-emerald-600 text-white
                    rounded-2xl shadow-lg
                    p-3.5 flex items-center gap-3
                    animate-[slideIn_0.3s_ease-out]
                "
            >
                <IconCheck size={20} strokeWidth={2.4} />
                <div className="flex-1 text-[13px] font-semibold">
                    App lista para uso offline
                </div>
                <button
                    onClick={() => setOfflineReady(false)}
                    className="
                        w-7 h-7 rounded-full
                        text-white/70 hover:bg-white/20
                        flex items-center justify-center
                    "
                >
                    <IconX size={14} strokeWidth={2.2} />
                </button>
            </div>
        );
    }

    return null;
}
