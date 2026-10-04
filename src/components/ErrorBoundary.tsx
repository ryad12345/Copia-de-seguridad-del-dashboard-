// =====================================================================
// MOZONA TPV — ErrorBoundary (v4.0.7-error-recovery)
// =====================================================================
// Captura cualquier error de la app y ofrece:
//   1. Reiniciar (mantiene cache)
//   2. Reiniciar limpio (limpia localStorage)
//   3. Diagnóstico interno (visible solo en consola del navegador)
// =====================================================================

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    errorId: string;
    errorMessage: string;
    showAdvanced: boolean;
    cleared: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            errorId: "",
            errorMessage: "",
            showAdvanced: false,
            cleared: false,
        };
    }

    static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            errorId: crypto.randomUUID().slice(0, 8),
            errorMessage: error?.message || "Error desconocido",
            showAdvanced: false,
            cleared: false,
        };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Log interno (visible en consola del navegador, NO al usuario)
        try {
            console.warn("[ErrorBoundary] " + this.state.errorId, {
                message: error?.message,
                stack: error?.stack?.slice(0, 500),
                componentStack: info?.componentStack?.slice(0, 300),
            });
        } catch (_) {}

        // Opcional: enviar log a Supabase para diagnóstico
        try {
            const { supabase } = require("../lib/supabase");
            if (supabase?.auth?.getUser) {
                supabase.auth.getUser().then(({ data }: any) => {
                    const user = data?.user;
                    if (user) {
                        // No await, fire-and-forget
                        supabase.from("edge_function_logs").insert({
                            function_name: "error_boundary",
                            actor_id: user.id,
                            action: "react_error",
                            success: false,
                            error_msg: `${this.state.errorId}: ${error?.message?.slice(0, 200)}`,
                        }).then(() => {}).catch(() => {});
                    }
                }).catch(() => {});
            }
        } catch (_) {}
    }

    // ★ Reiniciar normal (mantiene cache)
    handleSoftReset = () => {
        this.setState({ hasError: false, errorId: "", errorMessage: "", showAdvanced: false });
        setTimeout(() => window.location.reload(), 100);
    };

    // ★ Reiniciar limpio (limpia localStorage de caches obsoletos)
    handleHardReset = () => {
        try {
            const keysToPreserve: string[] = [];
            // Conserva solo lo esencial: sesión de auth y migración
            const ALL_KEYS = Object.keys(localStorage);
            for (const key of ALL_KEYS) {
                if (
                    key.startsWith("sb-") ||  // Supabase auth
                    key.startsWith("mozona.session") ||  // sesión
                    key === "mozona.migration.completed.v1" ||
                    key === "mozona.migration.migrated_ids"
                ) {
                    keysToPreserve.push(key);
                }
            }

            // Borra todo lo demás
            for (const key of ALL_KEYS) {
                if (!keysToPreserve.includes(key)) {
                    try { localStorage.removeItem(key); } catch (_) {}
                }
            }
            console.warn("[ErrorBoundary] hard reset, preserved:", keysToPreserve);
        } catch (e) {
            console.warn("[ErrorBoundary] hard reset error:", e);
        }

        this.setState({ hasError: false, cleared: true, errorId: "", errorMessage: "" });
        setTimeout(() => window.location.reload(), 100);
    };

    // ★ Limpieza TOTAL (incluye sesión - usuario tendrá que volver a hacer login)
    handleTotalReset = () => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        this.setState({ hasError: false, cleared: true });
        setTimeout(() => window.location.reload(), 100);
    };

    // ★ v4.0.7-no-loop-fix: Timer para auto-recovery
    private _autoReloadTimer: ReturnType<typeof setTimeout> | null = null;
    componentDidMount() {
        if (this.state.hasError && !this._autoReloadTimer) {
            try {
                this._autoReloadTimer = setTimeout(() => {
                    try { window.location.reload(); } catch (_) {}
                }, 5000);
            } catch (_) {}
        }
    }
    componentWillUnmount() {
        if (this._autoReloadTimer) {
            clearTimeout(this._autoReloadTimer);
            this._autoReloadTimer = null;
        }
    }
    componentDidUpdate(_prev: Props, prevState: State) {
        if (this.state.hasError && !prevState.hasError && !this._autoReloadTimer) {
            try {
                this._autoReloadTimer = setTimeout(() => {
                    try { window.location.reload(); } catch (_) {}
                }, 5000);
            } catch (_) {}
        }
    }

    render() {
        if (this.state.hasError) {
            // ★ v4.0.7-no-loop-fix: ErrorBoundary FULLSCREEN REAL.
            //   - fixed inset-0 z-[99999] cubre TODA la UI
            //   - style inline garantiza cobertura aunque Tailwind falle
            //   - role="alertdialog" aria-modal="true" para accesibilidad
            return (
                <div
                    className="fixed inset-0 z-[99999] flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4"
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
                    role="alertdialog"
                    aria-modal="true"
                >
                    <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8">
                        <div className="text-center mb-6">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center text-4xl">
                                ⚠️
                            </div>
                            <h1 className="text-[22px] font-black text-slate-900 mb-2">
                                Re-conectando…
                            </h1>
                            <p className="text-[14px] text-slate-600 leading-relaxed">
                                Recargando automáticamente en 5 segundos.
                                Esto puede pasar tras actualizaciones o por una conexion inestable.
                            </p>
                            <div className="w-10 h-10 mx-auto mt-4 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                        </div>

                        {/* Botón principal */}
                        <button
                            onClick={this.handleSoftReset}
                            className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white font-black text-[14px] shadow-lg transition"
                        >
                            🔄 Reintentar ahora
                        </button>

                        {/* Opciones avanzadas */}
                        <div className="mt-4">
                            <button
                                onClick={() => this.setState(s => ({ ...s, showAdvanced: !s.showAdvanced }))}
                                className="w-full text-[12px] text-slate-500 hover:text-slate-800 font-semibold underline"
                            >
                                {this.state.showAdvanced ? "Ocultar" : "Ver"} opciones avanzadas
                            </button>

                            {this.state.showAdvanced && (
                                <div className="mt-3 space-y-2 p-3 bg-slate-50 rounded-xl">
                                    <button
                                        onClick={this.handleHardReset}
                                        className="w-full h-10 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[12.5px] transition"
                                    >
                                        🧹 Reiniciar limpio (mantiene sesion)
                                    </button>
                                    <p className="text-[10.5px] text-slate-500 px-2 leading-relaxed">
                                        Borra caches obsoletos del navegador pero conserva tu sesion iniciada.
                                        Si el error es por datos corruptos, esto suele arreglarlo.
                                    </p>

                                    <button
                                        onClick={this.handleTotalReset}
                                        className="w-full h-10 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-[12.5px] transition"
                                    >
                                        ⚠️ Reinicio total (cerrar sesion)
                                    </button>
                                    <p className="text-[10.5px] text-slate-500 px-2 leading-relaxed">
                                        Borra TODO incluyendo sesion. Tendras que volver a hacer login.
                                    </p>
                                </div>
                            )}
                        </div>

                        <p className="text-[11px] text-slate-400 mt-6 text-center">
                            Si el problema continua, contacta con soporte.<br />
                            <span className="text-slate-500 font-bold">WhatsApp +34 644 16 51 53</span>
                        </p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
