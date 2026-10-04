// =====================================================================
// MOZONA TPV — LANConnectionPanel (Conexión de comanderos)
// =====================================================================
// Muestra la URL local del TPV + un QR para que los camareros
// puedan entrar al comandero desde sus móviles escaneando.
// =====================================================================

import { useState } from "react";
import { useLocalIP } from "../../hooks/useLocalIP";
import { Card } from "./FormControls";
import { IconQr, IconCopy, IconNetwork, IconCheck, IconAlert, IconRefresh } from "../icons";

export interface LANConnectionPanelProps {
    /** URL pública del TPV (SaaS), ej: https://mozona-tpv.vercel.app */
    publicUrl?: string;
    /** Puerto del backend LAN local (si está corriendo) */
    lanPort?:   number;
}

export function LANConnectionPanel({ publicUrl, lanPort = 3000 }: LANConnectionPanelProps) {
    const ip = useLocalIP(lanPort);
    const [copied, setCopied] = useState<string | null>(null);

    const copy = (text: string, key: string) => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            void navigator.clipboard.writeText(text).then(() => {
                setCopied(key);
                setTimeout(() => setCopied(null), 2000);
            });
        }
    };

    // URLs candidatas
    const lanUrl = ip.baseUrl;
    const cloudUrl = publicUrl
        ? `${publicUrl}/waiter`
        : (typeof window !== "undefined" ? `${window.location.origin}/waiter` : "");

    // QR via API pública (sin auth, 200x200 PNG)
    const qrSrc = (url: string) =>
        `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=1&data=${encodeURIComponent(url)}`;

    return (
        <Card
            icon={<span className="text-[15px]">📡</span>}
            title="Conexión de comanderos"
            subtitle="Cómo se conectan los móviles de los camareros"
        >
            <div className="space-y-3">
                {/* Opción 1: LAN (más rápido, sin internet) */}
                <div className="p-3 rounded-2xl bg-blue-50/40 border border-blue-200/80">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                            <IconNetwork size={14} strokeWidth={2.2} className="text-blue-700" />
                            <span className="text-[12px] font-black text-blue-900 uppercase tracking-wider">
                                Red local (Wi-Fi del local)
                            </span>
                        </div>
                        <button onClick={ip.refresh} disabled={ip.loading}
                                className="w-6 h-6 rounded-md text-blue-700 hover:bg-blue-100
                                           flex items-center justify-center active:scale-90 transition"
                                title="Refrescar">
                            <IconRefresh size={11} strokeWidth={2} className={ip.loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    {ip.loading && !ip.ip && (
                        <div className="py-3 text-center text-[11.5px] text-blue-700/70">
                            Detectando IP local…
                        </div>
                    )}

                    {ip.error && (
                        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11.5px] text-rose-700">
                            <IconAlert size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                            <span>{ip.error}</span>
                        </div>
                    )}

                    {lanUrl && (
                        <>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                        URL del TPV en esta red
                                    </div>
                                    <div className="mt-0.5 font-mono text-[12.5px] font-bold text-slate-900 truncate">
                                        {lanUrl}/waiter
                                    </div>
                                </div>
                                <button onClick={() => copy(`${lanUrl}/waiter`, "lan")}
                                        className="h-8 w-8 rounded-lg bg-white hover:bg-slate-50 border border-slate-200
                                                   flex items-center justify-center active:scale-90 transition"
                                        title="Copiar URL">
                                    {copied === "lan" ? (
                                        <IconCheck size={13} strokeWidth={2.4} className="text-emerald-600" />
                                    ) : (
                                        <IconCopy size={13} strokeWidth={2.2} className="text-slate-500" />
                                    )}
                                </button>
                            </div>
                            <div className="mt-3 flex flex-col sm:flex-row items-center gap-3">
                                <div className="shrink-0 p-1.5 bg-white rounded-xl border border-slate-200 shadow-sm">
                                    <img
                                        src={qrSrc(`${lanUrl}/waiter`)}
                                        alt="QR comandero LAN"
                                        loading="lazy"
                                        width={140} height={140}
                                        className="rounded-lg"
                                    />
                                </div>
                                <div className="flex-1 text-[11.5px] text-slate-600 leading-relaxed">
                                    <p className="font-bold text-slate-800">Cómo conectar:</p>
                                    <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                                        <li>El camarero se conecta al <b>mismo Wi-Fi</b> del local.</li>
                                        <li>Escanea este QR con la cámara del móvil.</li>
                                        <li>Introduce su <b>PIN de 4 dígitos</b> en el comandero.</li>
                                    </ol>
                                    <p className="mt-1.5 text-[10px] text-slate-400">
                                        Fuente: <span className="font-mono">{ip.source}</span>
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Opción 2: Cloud (internet) */}
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center gap-1.5 mb-2">
                        <IconQr size={14} strokeWidth={2.2} className="text-slate-700" />
                        <span className="text-[12px] font-black text-slate-700 uppercase tracking-wider">
                            Internet (4G / 5G / otra Wi-Fi)
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                URL pública
                            </div>
                            <div className="mt-0.5 font-mono text-[12.5px] font-bold text-slate-900 truncate">
                                {cloudUrl}
                            </div>
                        </div>
                        <button onClick={() => copy(cloudUrl, "cloud")}
                                className="h-8 w-8 rounded-lg bg-white hover:bg-slate-50 border border-slate-200
                                           flex items-center justify-center active:scale-90 transition"
                                title="Copiar URL">
                            {copied === "cloud" ? (
                                <IconCheck size={13} strokeWidth={2.4} className="text-emerald-600" />
                            ) : (
                                <IconCopy size={13} strokeWidth={2.2} className="text-slate-500" />
                            )}
                        </button>
                    </div>
                    <p className="mt-1.5 text-[10.5px] text-slate-500">
                        Funciona desde cualquier lugar con internet.  Requiere login con email.
                    </p>
                </div>
            </div>
        </Card>
    );
}

export default LANConnectionPanel;
