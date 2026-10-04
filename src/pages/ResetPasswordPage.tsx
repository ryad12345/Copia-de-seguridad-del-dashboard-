// =====================================================================
// MOZONA TPV — ResetPasswordPage (/reset-password)
// =====================================================================
// Pantalla a la que llega Supabase tras hacer click en el enlace del
// email de recuperación.
//
// Flujo:
//   1) Supabase redirige aquí con #access_token=...&type=recovery en URL
//   2) El usuario introduce nueva contraseña
//   3) supabase.auth.updateUser({ password })
//   4) Redirige a /auth (login) con mensaje de éxito
//
// Esta página se monta SIN SubscriptionGuard (es pública).
// =====================================================================

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { IconShield, IconCheck } from "../components/icons";

export function ResetPasswordPage() {
    const nav = useNavigate();
    const [pwd,         setPwd]         = useState("");
    const [pwd2,        setPwd2]        = useState("");
    const [showPwd,     setShowPwd]     = useState(false);
    const [busy,        setBusy]        = useState(false);
    const [ready,       setReady]       = useState(false);
    const [success,     setSuccess]     = useState(false);
    const [error,       setError]       = useState<string | null>(null);

    // Detectar el token de recuperación en la URL
    useEffect(() => {
        // Supabase puede pasar el token como hash fragment (#access_token=...)
        // o como query param. Lo soportamos ambos.
        const hash = window.location.hash;
        const search = window.location.search;
        if (hash.includes("access_token") || hash.includes("type=recovery")
            || search.includes("access_token") || search.includes("type=recovery")) {
            setReady(true);
            return;
        }
        // Si no hay token, mostramos un error suave
        setError("No se detectó un token de recuperación. Pide un nuevo enlace desde /auth.");
    }, []);

    const validatePwd = (): string | null => {
        if (pwd.length < 8) return "La contraseña debe tener al menos 8 caracteres";
        if (pwd !== pwd2)   return "Las contraseñas no coinciden";
        return null;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!isSupabaseConfigured) {
            setError("Supabase no configurado");
            return;
        }
        const pwdErr = validatePwd();
        if (pwdErr) { setError(pwdErr); return; }
        setBusy(true);
        try {
            const { error: upErr } = await supabase.auth.updateUser({ password: pwd });
            if (upErr) {
                setError(upErr.message);
                setBusy(false);
                return;
            }
            setSuccess(true);
            // Damos 2 segundos para que vea el check y redirigimos
            setTimeout(() => nav("/auth", { replace: true }), 2000);
        } catch (e: any) {
            console.warn("[resetPassword] error:", e);
            setError("No pudimos restablecer tu contraseña. Por favor, inténtalo de nuevo.");
        }
        setBusy(false);
    };

    return (
        <div className="min-h-dvh w-full bg-slate-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl
                            border border-slate-200/80 p-6 sm:p-8">

                <div className="flex items-center gap-2 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700
                                    text-white flex items-center justify-center">
                        <IconShield size={18} strokeWidth={1.8} />
                    </div>
                    <h1 className="text-[15px] font-black text-slate-800">Nueva contraseña</h1>
                </div>
                <p className="text-[10.5px] text-slate-500 mt-1">
                    Define tu nueva contraseña para acceder a MOZONA TPV.
                </p>

                {success ? (
                    <div className="mt-6 text-center">
                        <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100
                                        text-emerald-600 flex items-center justify-center mb-3">
                            <IconCheck size={28} strokeWidth={2.4} />
                        </div>
                        <h2 className="text-[16px] font-black text-slate-800">¡Contraseña actualizada!</h2>
                        <p className="mt-1 text-[12.5px] text-slate-500">
                            Te llevamos al login…
                        </p>
                    </div>
                ) : (
                    <form onSubmit={submit} className="mt-5 space-y-3">
                        <div>
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                Nueva contraseña
                            </label>
                            <div className="relative">
                                <input
                                    type={showPwd ? "text" : "password"}
                                    value={pwd}
                                    onChange={e => setPwd(e.target.value)}
                                    minLength={8}
                                    required
                                    placeholder="Mínimo 8 caracteres"
                                    autoFocus
                                    className="input mt-1 pr-16"
                                />
                                <button type="button" onClick={() => setShowPwd(s => !s)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5
                                                   h-7 px-2 rounded-md text-[10.5px] font-bold
                                                   text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                                    {showPwd ? "Ocultar" : "Ver"}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                Repite la contraseña
                            </label>
                            <input
                                type={showPwd ? "text" : "password"}
                                value={pwd2}
                                onChange={e => setPwd2(e.target.value)}
                                minLength={8}
                                required
                                placeholder="Confirma la contraseña"
                                className="input mt-1"
                            />
                        </div>

                        {error && (
                            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80
                                            text-[12px] text-rose-700">
                                {error}
                            </div>
                        )}

                        <button type="submit" disabled={busy || !ready}
                                className="w-full h-12 rounded-xl bg-blue-600 text-white
                                           text-[14px] font-black
                                           shadow-sm shadow-blue-600/30
                                           active:scale-95 transition
                                           disabled:opacity-50">
                            {busy ? "Guardando…" : "Actualizar contraseña"}
                        </button>

                        <div className="text-center text-[10.5px] text-slate-400">
                            <Link to="/auth" className="hover:text-blue-600 transition">
                                ← Volver al login
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
