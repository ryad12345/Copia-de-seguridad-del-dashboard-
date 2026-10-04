// =====================================================================
// MOZONA TPV — HealthPage (v3.0.4)
// =====================================================================
// Página pública que muestra el estado del sistema.
// Útil para diagnóstico rápido sin consola.
// =====================================================================

import { useEffect, useState } from "react";
import { IconCheck, IconArrowRight, IconShield, IconUser, IconLock } from "../components/icons";

interface Health {
    server: string;
    timestamp: string;
    version: string;
    env: Record<string, boolean>;
    endpoints: Record<string, string>;
    score: number;
    status: string;
    warnings?: string[];
}

export function HealthPage() {
    const [health, setHealth] = useState<Health | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/health")
            .then(r => r.json())
            .then(j => {
                setHealth(j);
                setLoading(false);
            })
            .catch(e => {
                setError(String(e));
                setLoading(false);
            });
    }, []);

    const statusColor = (s: string) => {
        switch (s) {
            case "excellent": return "bg-emerald-500";
            case "good": return "bg-blue-500";
            case "degraded": return "bg-amber-500";
            case "critical": return "bg-rose-500";
            default: return "bg-slate-400";
        }
    };

    const statusLabel = (s: string) => {
        switch (s) {
            case "excellent": return "Excelente";
            case "good": return "Bueno";
            case "degraded": return "Degradado";
            case "critical": return "Crítico";
            default: return "Desconocido";
        }
    };

    return (
        <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/60 overflow-hidden">
                {/* Cabecera */}
                <div className="relative h-32 bg-gradient-to-br from-blue-600 via-violet-600 to-blue-700 flex items-center justify-center overflow-hidden">
                    <div className="relative text-center text-white">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-2 shadow-xl ring-1 ring-white/30">
                            <IconShield size={28} strokeWidth={2.2} />
                        </div>
                        <h1 className="text-[18px] font-black tracking-tight">Estado del sistema</h1>
                        <p className="text-[11px] text-blue-100">MOZONA TPV</p>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    {loading && <p className="text-center text-sm text-slate-500">Verificando...</p>}

                    {error && (
                        <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4">
                            <p className="font-black text-rose-900">Error</p>
                            <p className="text-[12px] text-rose-700">{error}</p>
                        </div>
                    )}

                    {health && (
                        <>
                            {/* Score general */}
                            <div className="text-center">
                                <div className={`inline-block px-4 py-2 rounded-full ${statusColor(health.status)} text-white text-[14px] font-black`}>
                                    {statusLabel(health.status)} · {health.score}%
                                </div>
                                <p className="text-[10.5px] text-slate-400 mt-2 font-mono">
                                    v{health.version} • {new Date(health.timestamp).toLocaleString("es-ES")}
                                </p>
                            </div>

                            {/* Variables de entorno */}
                            <div>
                                <h2 className="text-[12px] font-black text-slate-700 mb-2">Variables de entorno</h2>
                                <div className="space-y-1.5">
                                    {Object.entries(health.env).map(([k, v]) => (
                                        <div key={k} className="flex items-center justify-between text-[11.5px] bg-slate-50 px-3 py-1.5 rounded-lg">
                                            <span className="font-mono text-slate-700">{k}</span>
                                            <span className={`font-black ${v ? "text-emerald-600" : "text-rose-500"}`}>
                                                {v ? "✓ OK" : "✗ FALTA"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Endpoints */}
                            <div>
                                <h2 className="text-[12px] font-black text-slate-700 mb-2">Endpoints</h2>
                                <div className="space-y-1.5">
                                    {Object.entries(health.endpoints).map(([k, v]) => (
                                        <div key={k} className="flex items-center justify-between text-[11.5px] bg-slate-50 px-3 py-1.5 rounded-lg">
                                            <span className="font-mono text-slate-700">{k}</span>
                                            <span className="font-black text-emerald-600">
                                                <IconCheck size={12} className="inline" /> OK
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Warnings */}
                            {health.warnings && health.warnings.length > 0 && (
                                <div>
                                    <h2 className="text-[12px] font-black text-amber-700 mb-2">⚠ Advertencias</h2>
                                    <div className="space-y-1.5">
                                        {health.warnings.map((w, i) => (
                                            <div key={i} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                                                {w}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Acciones */}
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <a
                                    href="/"
                                    className="h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-black flex items-center justify-center gap-1.5"
                                >
                                    Inicio
                                </a>
                                <a
                                    href="/admin"
                                    className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-black flex items-center justify-center gap-1.5"
                                >
                                    <IconUser size={12} />
                                    Panel admin
                                </a>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default HealthPage;
