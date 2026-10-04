// =====================================================================
// MOZONA TPV — ServerConfigBanner
// =====================================================================
// Banner/modal que aparece cuando:
//   1. La app corre en un contexto cloud (HTTPS) y no hay IP de caja
//      central configurada → impedimos loop a localhost.
//   2. La URL del WebSocket está mal configurada / rechazada.
//
// Persiste la IP del usuario en localStorage bajo "mozona_server_ip"
// (clave legacy) y en "mozona.lan.host".
// =====================================================================

import { useEffect, useState } from "react";
import {
    isCloudContext, hasStoredLanHost,
    normalizeServerInput, setLanConfig,
} from "../lib/ws-config";
import { IconWifi, IconX, IconCheck, IconAlert } from "./icons";
import { cn } from "../lib/cn";

export interface ServerConfigBannerProps {
    /** Cuando el WS está conectado se oculta automáticamente. */
    isConnected: boolean;
    /** Si se fuerza la IP desde fuera, el banner desaparece. */
    onSaved?:     () => void;
}

export function ServerConfigBanner({ isConnected, onSaved }: ServerConfigBannerProps) {
    const [open,    setOpen]    = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [ip,      setIp]      = useState("");
    const [port,    setPort]    = useState("3001");
    const [error,   setError]   = useState<string | null>(null);

    // Decidir cuándo abrir
    useEffect(() => {
        if (isConnected) { setOpen(false); return; }
        if (dismissed) return;
        if (!isCloudContext()) return;       // desktop dev no necesita banner
        if (hasStoredLanHost()) return;      // ya hay IP guardada, sólo falla
        setOpen(true);
    }, [isConnected, dismissed]);

    // Si tras configurar sigue sin conectar y la nube está en marcha,
    // reabrimos con un error suave.
    useEffect(() => {
        if (!isConnected && hasStoredLanHost() && !dismissed) {
            setOpen(true);
        }
    }, [isConnected, dismissed]);

    const handleSave = () => {
        const normalized = normalizeServerInput(ip, parseInt(port || "3001", 10));
        if (!normalized) {
            setError("La dirección indicada no es válida. Introduce la IP local de la caja, por ejemplo: 192.168.1.50");
            return;
        }
        // Parsear host y puerto
        const u = new URL(normalized);
        const host = u.hostname;
        const p   = parseInt(u.port || "3001", 10);
        setLanConfig({ host, port: p });
        setError(null);
        setOpen(false);
        onSaved?.();
        // Pequeño delay y recarga dura (más limpio que reconnect interno)
        setTimeout(() => window.location.reload(), 400);
    };

    const handleClear = () => {
        setIp("");
        setError(null);
    };

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="
                fixed inset-0 z-[100]
                bg-slate-900/40 backdrop-blur-sm
                flex items-end sm:items-center justify-center
                p-0 sm:p-4
            "
        >
            <div
                className={cn(
                    "w-full sm:max-w-md",
                    "bg-white",
                    "rounded-t-3xl sm:rounded-2xl",
                    "shadow-2xl",
                    "animate-slide-up"
                )}
            >
                {/* Header */}
                <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                    <div className="
                        w-11 h-11 rounded-2xl
                        bg-amber-100 text-amber-700
                        flex items-center justify-center shrink-0
                    ">
                        <IconWifi size={20} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-[16px] font-black text-slate-900">
                            Configura la caja central
                        </h2>
                        <p className="text-[12.5px] text-slate-500 mt-0.5">
                            Para sincronizar comandas y tickets, indica la IP local de la
                            caja TPV de tu local (WiFi del bar/restaurante).
                        </p>
                    </div>
                    <button
                        onClick={() => { setOpen(false); setDismissed(true); }}
                        className="
                            w-8 h-8 rounded-full
                            text-slate-400 hover:text-slate-700 hover:bg-slate-100
                            flex items-center justify-center
                            active:scale-90 transition
                        "
                        title="Cerrar"
                    >
                        <IconX size={16} strokeWidth={2.2} />
                    </button>
                </div>

                {/* Form */}
                <div className="px-5 pb-2 space-y-3">
                    <Field
                        label="IP de la caja central"
                        hint="Formato: 192.168.1.50 (sin http://)"
                    >
                        <input
                            type="text"
                            value={ip}
                            onChange={e => { setIp(e.target.value); setError(null); }}
                            onKeyDown={e => e.key === "Enter" && handleSave()}
                            placeholder="192.168.1.50"
                            autoFocus
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="url"
                            className="
                                w-full h-11 px-3
                                rounded-xl border border-slate-200
                                text-[14px] font-mono
                                focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                outline-none transition
                            "
                        />
                    </Field>

                    <Field
                        label="Puerto (opcional)"
                        hint="Por defecto 3001"
                    >
                        <input
                            type="number"
                            value={port}
                            onChange={e => setPort(e.target.value)}
                            placeholder="3001"
                            min="1"
                            max="65535"
                            className="
                                w-32 h-10 px-3
                                rounded-xl border border-slate-200
                                text-[13px] font-mono
                                focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                outline-none transition
                            "
                        />
                    </Field>

                    {error && (
                        <div className="
                            flex items-start gap-2
                            px-3 py-2 rounded-xl
                            bg-rose-50 border border-rose-200/80
                            text-[12px] text-rose-700
                        ">
                            <IconAlert size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 flex items-center gap-2 border-t border-slate-100">
                    <button
                        onClick={handleClear}
                        className="
                            h-10 px-4 rounded-xl
                            text-slate-600 hover:bg-slate-100
                            text-[12.5px] font-semibold
                            active:scale-95 transition
                        "
                    >
                        Limpiar
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={handleSave}
                        disabled={!ip.trim()}
                        className="
                            h-10 px-5 rounded-xl
                            bg-blue-600 text-white
                            text-[13px] font-bold
                            shadow-sm shadow-blue-600/30
                            disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none
                            flex items-center gap-1.5
                            active:scale-95 transition
                        "
                    >
                        <IconCheck size={14} strokeWidth={2.4} />
                        Guardar y conectar
                    </button>
                </div>

                {/* Hint inferior */}
                <div className="px-5 pb-4 text-[10.5px] text-slate-400 leading-relaxed">
                    ¿No sabes la IP?  Abre <strong>cmd</strong> en la caja central
                    y escribe <code className="px-1 bg-slate-100 rounded">ipconfig</code> ·
                    busca la línea <em>IPv4</em> (empieza por 192.168.).
                </div>
            </div>
        </div>
    );
}

function Field({
    label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <div className="text-[11px] font-bold text-slate-600 tracking-wider uppercase mb-1">
                {label}
            </div>
            {children}
            {hint && (
                <div className="text-[10.5px] text-slate-400 mt-1">{hint}</div>
            )}
        </label>
    );
}
