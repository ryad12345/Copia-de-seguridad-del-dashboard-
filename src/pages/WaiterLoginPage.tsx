// =====================================================================
// MOZONA TPV — WaiterLoginPage (/waiter/login)
// =====================================================================
// Login ultrarrápido para camareros con USERNAME + PASSWORD (sin email).
// Valida contra la RPC `waiter_login` de Supabase, que devuelve
// { tenant_id, user_id, role, name } si las credenciales son correctas.
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { useRateLimit } from "../hooks/useRateLimit";
import { useAuth } from "../lib/auth";
import { IconArrowRight, IconLock, IconShield, IconUser } from "../components/icons";
import { Logo } from "../components/Logo";

interface WaiterLoginResult {
    ok:        boolean;
    error?:    string;
    token?:     string | null;
    tenant_id?: string | null;
    user_id?:   string | null;
    role?:      string;
    name?:      string;
    email?:     string | null;
}

export function WaiterLoginPage() {
    const auth = useAuth();
    const nav  = useNavigate();
    const [params] = useSearchParams();
    const redirectTo = (params.get("redirect") ?? "/waiter").trim();

    const [username, setUsername] = useState("");
    const [pin, setPin] = useState("");
    const [showPwd,  setShowPwd]  = useState(false);
    const [busy,     setBusy]     = useState(false);
    const [msg,      setMsg]      = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [waiter,   setWaiter]   = useState<WaiterLoginResult | null>(null);

    const rate = useRateLimit({ key: "waiter_login", maxAttempts: 5, windowMs: 60_000 });

    // Si ya hay sesión activa de camarero, salta al WaiterPad
    useEffect(() => {
        try {
            const cached = localStorage.getItem("mozona.waiter_session");
            if (cached) {
                const parsed = JSON.parse(cached) as WaiterLoginResult;
                if (parsed.ok && parsed.tenant_id) {
                    nav(redirectTo, { replace: true });
                }
            }
        } catch (e) { /* noop */ }
    }, [nav, redirectTo]);

    const handleLogin = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setMsg(null);

        if (rate.isBlocked) {
            setMsg({ kind: "err",
                text: `Demasiados intentos. Espera ${rate.remainingSeconds}s.` });
            return;
        }
        if (!username.trim() || !pin) {
            setMsg({ kind: "err", text: "Usuario y PIN son obligatorios" });
            return;
        }

        setBusy(true);
        try {
            const { supabase } = await import("../lib/supabase");
            const cleanUsername = username.trim().toLowerCase();
            const cleanPin      = pin.trim().toUpperCase();

            // ============================================================
            // PASO 1: RPC directa `verify_waiter_login` (SECURITY DEFINER,
            //         bypass RLS, SIEMPRE funciona si el SQL está ejecutado).
            // ============================================================
            const { data: rpcData, error: rpcErr } = await supabase.rpc("verify_waiter_login", {
                p_username: cleanUsername,
                p_pin:      cleanPin,
            });
            if (rpcErr) throw new Error(`Error RPC: ${rpcErr.message}`);

            const result = rpcData as WaiterLoginResult;
            if (!result?.ok) {
                const next = rate.recordFailure();
                setMsg({
                    kind: "err",
                    text: next.blocked
                        ? `Demasiados intentos. Espera ${rate.remainingSeconds}s.`
                        : (result?.error || "Usuario no encontrado o PIN incorrecto"),
                });
                setBusy(false);
                return;
            }
            rate.reset();

            // Sesión básica (mínimo viable)
            const session: WaiterLoginResult = {
                ok:        true,
                token:     null,
                tenant_id: result.tenant_id ?? null,
                user_id:   result.user_id ?? null,
                role:      result.role ?? "waiter",
                name:      result.name ?? username,
                email:     result.email ?? null,
            };

            // ============================================================
            // PASO 2 (opcional): Si la Edge Function `waiter-api` está
            //   desplegada, intentar obtener un token HMAC para llamadas
            //   autenticadas al backend. Si falla, el login sigue siendo
            //   válido con la sesión básica.
            // ============================================================
            try {
                const { data: efData, error: efErr } = await supabase.functions.invoke<{
                    ok: boolean;
                    token?: string;
                }>("waiter-api", {
                    body: { action: "login", username: cleanUsername, pin: cleanPin },
                });
                if (!efErr && efData?.ok && efData?.token) {
                    session.token = efData.token;
                }
            } catch (e) {
                console.warn("[WaiterLogin] waiter-api EF no disponible (modo limitado):", e);
            }

            localStorage.setItem("mozona.waiter_session", JSON.stringify(session));
            setWaiter(session);
            setMsg({ kind: "ok", text: `Bienvenido, ${session.name}` });
            setTimeout(() => nav(redirectTo, { replace: true }), 400);
        } catch (e) {
            console.warn("[waiterLogin] error:", e);
            setMsg({ kind: "err",
                text: "No pudimos validar tu PIN. Por favor, inténtalo de nuevo." });
        }
        setBusy(false);
    };

    if (!isSupabaseConfigured) {
        return (
            <Shell>
                <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200/80 text-[12.5px] text-amber-800">
                    <strong>Modo demo.</strong>  Supabase no está configurado en este build.
                </div>
            </Shell>
        );
    }

    return (
        <Shell>
            <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                                bg-gradient-to-br from-blue-600 to-blue-700 text-white
                                shadow-lg shadow-blue-600/30 mb-3">
                    <IconUser size={26} strokeWidth={1.8} />
                </div>
                <h1 className="text-[22px] font-black tracking-tight">
                    Acceso de Camarero
                </h1>
                <p className="text-[12.5px] text-slate-500 mt-1">
                    Inicia sesión con tu usuario y PIN
                </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-3.5">
                <Field label="Usuario" required>
                    <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase())}
                        placeholder="Ej. luis23"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="username"
                        className="input"
                        autoFocus
                    />
                </Field>

                <Field label="PIN (4-6 caracteres)" required>
                    <div className="relative">
                        <input
                            type={showPwd ? "text" : "password"}
                            value={pin}
                            onChange={e => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                            placeholder="••••"
                            autoComplete="current-password"
                            inputMode="text"
                            maxLength={6}
                            className="input pr-20 font-mono tracking-[0.3em] text-center text-[15px]"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPwd(v => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2
                                       text-[11px] font-bold text-blue-600
                                       hover:text-blue-700 px-2 py-1"
                        >
                            {showPwd ? "Ocultar" : "Mostrar"}
                        </button>
                    </div>
                </Field>

                <button
                    type="submit"
                    disabled={busy || rate.isBlocked}
                    className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700
                               text-white text-[14px] font-black
                               shadow-md shadow-blue-600/30 active:scale-95
                               transition disabled:opacity-50
                               flex items-center justify-center gap-2"
                >
                    {busy ? "Entrando…" : <>Entrar
                        <IconArrowRight size={16} strokeWidth={2.4} />
                    </>}
                </button>
            </form>

            {msg && (
                <div className={
                    "mt-4 p-3 rounded-xl text-[12.5px] " +
                    (msg.kind === "ok"
                        ? "bg-emerald-50 border border-emerald-200/80 text-emerald-800"
                        : "bg-rose-50 border border-rose-200/80 text-rose-700")
                }>
                    {msg.text}
                </div>
            )}

            <div className="mt-5 pt-5 border-t border-slate-100 text-center text-[12px] text-slate-500">
                ¿Eres el dueño?{" "}
                <Link to="/auth" className="text-blue-600 font-semibold hover:underline
                                            inline-flex items-center gap-1">
                    Acceso de Administrador
                    <IconArrowRight size={11} strokeWidth={2.4} />
                </Link>
            </div>

            {rate.attempts > 0 && (
                <div className="mt-3 text-center text-[10.5px] text-slate-400 flex items-center justify-center gap-1">
                    <IconLock size={10} strokeWidth={2.2} />
                    Intentos: {rate.attempts}/{rate.maxAttempts}
                </div>
            )}

            <div className="mt-4 text-center text-[10.5px] text-slate-400 flex items-center justify-center gap-1.5">
                <IconShield size={10} strokeWidth={2.2} />
                Conexión segura · Supabase Auth
            </div>
        </Shell>
    );
}

// ---------------------------------------------------------------------
// Shell + Field
// ---------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-white
                        flex items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-5">
                    <Link to="/" className="inline-flex items-center gap-2">
                        <Logo variant="mark" size="sm" />
                    </Link>
                </div>
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl p-6">
                    {children}
                </div>
            </div>
        </div>
    );
}

function Field({ label, required, children }: {
    label: string; required?: boolean; children: React.ReactNode;
}) {
    return (
        <label className="block">
            <span className="block text-[11.5px] font-bold text-slate-700 mb-1">
                {label} {required && <span className="text-rose-500">*</span>}
            </span>
            {children}
        </label>
    );
}
