// =====================================================================
// MOZONA TPV — DesktopGuard
// =====================================================================
// Bloquea el acceso a /app y /settings desde móvil (< 768px).
// Muestra una pantalla informativa explicando que el panel de gestión
// está optimizado para pantallas grandes y que para tomar comandas
// debe usar /waiter/login.
// =====================================================================

import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useIsMobile } from "../hooks/useIsMobile";
import { IconShield, IconArrowRight, IconQr } from "./icons";

export function DesktopGuard({ children }: { children: ReactNode }) {
    const isMobile = useIsMobile();

    if (!isMobile) return <>{children}</>;

    return (
        <div className="min-h-dvh w-full bg-gradient-to-b from-slate-50 to-white
                        flex items-center justify-center p-5">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl p-7 text-center">
                    {/* Icono */}
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br
                                    from-blue-600 to-blue-700 text-white flex items-center
                                    justify-center shadow-lg shadow-blue-600/30">
                        <IconShield size={28} strokeWidth={1.8} />
                    </div>

                    {/* Título */}
                    <h1 className="text-xl font-bold text-slate-900 mb-2 leading-tight">
                        Panel de gestión TPV
                    </h1>
                    <p className="text-[13px] text-slate-500 leading-relaxed mb-5">
                        El panel central y los ajustes están optimizados exclusivamente para
                        pantallas grandes (ordenador o tablet).
                    </p>

                    {/* Card informativo */}
                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5 text-left">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 shrink-0 rounded-xl bg-blue-600 text-white
                                            flex items-center justify-center">
                                <IconQr size={18} strokeWidth={1.8} />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[12px] font-bold text-slate-900 mb-0.5">
                                    ¿Eres camarero?
                                </div>
                                <div className="text-[11.5px] text-slate-600 leading-snug">
                                    Para tomar comandas desde el móvil, accede con tu usuario
                                    y contraseña en la app de camareros.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Botón camarero */}
                    <Link
                        to="/waiter/login"
                        className="w-full inline-flex items-center justify-center gap-2
                                   px-5 py-3.5 bg-blue-600 hover:bg-blue-700 text-white
                                   rounded-2xl text-[13.5px] font-bold shadow-md shadow-blue-600/30
                                   active:scale-[0.98] transition-all"
                    >
                        Acceso de Camarero
                        <IconArrowRight size={16} strokeWidth={2} />
                    </Link>

                    {/* Footer info */}
                    <div className="mt-5 pt-4 border-t border-slate-100">
                        <p className="text-[10.5px] text-slate-400 leading-relaxed">
                            Si necesitas configurar tu local, abre esta URL desde un
                            ordenador o tablet.
                        </p>
                    </div>
                </div>

                {/* Brand */}
                <div className="mt-4 text-center text-[10px] text-slate-400 font-semibold tracking-widest uppercase">
                    MOZONA TPV · Sistema de Punto de Venta
                </div>
            </div>
        </div>
    );
}

export default DesktopGuard;
