// =====================================================================
// MOZONA TPV — WelcomePage (v3.3.0 — refactor total)
// =====================================================================
// Sala de espera post-registro.
// CAMBIOS v3.3.0:
//   - CERO dependencia de query params frájiles
//   - Email y userId vienen de useActiveSession (Supabase Auth)
//   - Si no hay sesión, redirige a /auth (NUNCA a /)
//   - Polling con useRef + stop flag (SIN bucles)
// =====================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSession } from "../hooks/useActiveSession";
import { isVipOrAdmin, getHomeRouteForEmail } from "../lib/vip";
import { IconShield, IconLock, IconUser, IconCheck, IconArrowRight } from "../components/icons";

interface TenantStatus {
    id: string;
    name: string;
    business_name?: string;
    plan_selected?: string;
    activation_status?: string;
    grace_period_ends_at?: string;
    trial_ends_at?: string;
    contact_email?: string;
    contactEmail?: string;
}

const POLL_INTERVAL_MS = 10_000;

function formatRemaining(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function WelcomePage() {
    const navigate = useNavigate();
    const session = useActiveSession();

    // ★ Si no hay sesión activa, redirigir a /auth
    // ★ v4.5.11: Aislamiento admin — VIP → /app, Admin → /admin, otros → sala de espera
    useEffect(() => {
        if (!session.isReady) return;
        if (!session.isAuthenticated) {
            navigate("/auth", { replace: true });
            return;
        }
        // ★ v4.5.11: usar getHomeRouteForEmail centralizado
        const dest = getHomeRouteForEmail(session.email, true);
        if (dest !== "/welcome") {
            console.log("[Welcome] redirigiendo a", dest, "para", session.email);
            navigate(dest, { replace: true });
        }
    }, [session.isReady, session.isAuthenticated, session.email, navigate]);

    const [status, setStatus] = useState<TenantStatus | null>(null);
    const [now, setNow] = useState(Date.now());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [method, setMethod] = useState<string>("");
    const [pollCount, setPollCount] = useState(0);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // ★ REFS para evitar re-renders y bucles
    const statusRef = useRef<TenantStatus | null>(null);
    const navigateRef = useRef(navigate);
    const redirectedRef = useRef(false);
    const stoppedRef = useRef(false);
    const pollCountRef = useRef(0);

    navigateRef.current = navigate;
    statusRef.current = status;

    // ★ Polling: SOLO depende de session (estable una vez autenticado)
    const fetchStatus = useCallback(async () => {
        if (!session.email || !session.userId) return;

        try {
            pollCountRef.current += 1;
            setPollCount(pollCountRef.current);

            const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
            const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
            if (!supabaseUrl || !supabaseKey) {
                setError("Configurando el sistema...");
                setLoading(false);
                return;
            }

            let tenant: any = null;
            let usedMethod = "client_direct";

            // ★ Query 1: por owner_id (es el método más fiable)
            try {
                const r = await fetch(
                    `${supabaseUrl}/rest/v1/tenants?owner_id=eq.${session.userId}&select=*&limit=1`,
                    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr[0]) {
                        tenant = arr[0];
                        usedMethod = "client_owner_id";
                    }
                }
            } catch (_) {}

            // ★ Query 2: por contact_email (fallback)
            if (!tenant) {
                try {
                    const r = await fetch(
                        `${supabaseUrl}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(session.email)}&select=*&limit=1`,
                        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
                    );
                    if (r.ok) {
                        const arr = await r.json();
                        if (arr && arr[0]) {
                            tenant = arr[0];
                            usedMethod = "client_contact_email";
                        }
                    }
                } catch (_) {}
            }

            setMethod(usedMethod);

            if (tenant) {
                // ★ Validar que el tenant es del usuario actual
                const tenantEmail = (tenant.contact_email || "").toLowerCase();
                if (tenantEmail && tenantEmail !== session.email.toLowerCase()) {
                    // El tenant NO es del usuario actual, ignorar
                    console.warn("[Welcome] tenant belongs to another user:", tenantEmail);
                    setError("Procesando tu registro...");
                    setLoading(false);
                    return;
                }
                setStatus({
                    id: tenant.id,
                    name: tenant.name || tenant.business_name || "",
                    business_name: tenant.business_name || tenant.name,
                    plan_selected: tenant.plan_selected || tenant.plan,
                    activation_status: tenant.activation_status,
                    grace_period_ends_at: tenant.grace_period_ends_at,
                    trial_ends_at: tenant.trial_ends_at,
                    contact_email: tenant.contact_email,
                });
                setError(null);
                setLoading(false);

                // ★ Si está aprobado, marcar para redirect
                const isApproved = ["active_trial", "active", "vip"].includes(
                    tenant.activation_status || tenant.subscription_status || ""
                );
                if (isApproved && !stoppedRef.current) {
                    stoppedRef.current = true;
                }
            } else {
                setError("Preparando tu espacio de trabajo...");
                setLoading(false);
            }
        } catch (e) {
            console.warn("[Welcome] fetch error:", e);
            setError("Conexión inestable. Reintentando...");
            setLoading(false);
        }
    }, [session.email, session.userId]);

    // ★ Polling con useRef + stop flag (SIN bucles)
    useEffect(() => {
        if (!session.isAuthenticated) return;

        const poll = () => {
            if (stoppedRef.current) return;
            const s = statusRef.current;
            if (s && ["active_trial", "active", "vip"].includes(s.activation_status || "")) {
                // ★ Aprobado: navegar una sola vez
                if (!redirectedRef.current) {
                    redirectedRef.current = true;
                    stoppedRef.current = true;
                    setTimeout(() => {
                        navigateRef.current("/auth?approved=1", { replace: true });
                    }, 2000);
                }
                return;
            }
            fetchStatus();
        };

        poll(); // inicial
        const intervalId = setInterval(poll, POLL_INTERVAL_MS);
        const onFocus = () => poll();
        window.addEventListener("focus", onFocus);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener("focus", onFocus);
        };
    }, [session.isAuthenticated, fetchStatus, session.email]);

    // ★ Detectar online/offline
    useEffect(() => {
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    // ★ Tick cada segundo para countdown
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    // ★ Calcular tiempo restante
    const remainingMs = status?.grace_period_ends_at
        ? Math.max(0, new Date(status.grace_period_ends_at).getTime() - now)
        : 24 * 60 * 60 * 1000;

    const whalink = `https://wa.me/34644165153?text=${encodeURIComponent(
        `Hola! Soy ${session.email || "cliente"}. Acabo de registrarme en MOZONA TPV y estoy en la sala de espera.`
    )}`;

    const isApproved = !!status && ["active_trial", "active", "vip"].includes(status.activation_status || "");

    // ★ Si no hay sesión, mostrar loading mientras redirige
    if (!session.isReady) {
        return (
            <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                    <p className="text-[12px] text-slate-500">Cargando...</p>
                </div>
            </div>
        );
    }

    if (!session.isAuthenticated) {
        return (
            <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center p-5">
                <div className="text-center">
                    <p className="text-[12.5px] text-slate-600">Redirigiendo al login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center p-4 sm:p-5">
            <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/60 overflow-hidden">
                {/* Cabecera */}
                <div className="relative h-48 bg-gradient-to-br from-blue-600 via-violet-600 to-blue-700 flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "0ms" }} />
                        <div className="absolute top-12 right-8 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "700ms" }} />
                        <div className="absolute bottom-8 left-12 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "1400ms" }} />
                    </div>
                    <div className="relative text-center text-white">
                        <div className="w-20 h-20 mx-auto rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-3 shadow-xl ring-1 ring-white/30">
                            {isApproved ? (
                                <IconCheck size={40} strokeWidth={2.5} className="text-emerald-300" />
                            ) : (
                                <IconShield size={36} strokeWidth={2.2} className="animate-pulse" />
                            )}
                        </div>
                        <h1 className="text-[20px] font-black tracking-tight">
                            {isApproved ? "¡Listo para empezar!" : "Configurando tu espacio"}
                        </h1>
                        <p className="text-[12.5px] text-blue-100 mt-1">
                            {isApproved
                                ? "Tu cuenta está activa. Te llevamos al panel..."
                                : "Tu caja está casi lista"}
                        </p>
                    </div>
                </div>

                <div className="p-6 sm:p-7 space-y-5">
                    {/* Email del usuario (sesión activa) */}
                    {session.email && (
                        <div className="text-center">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/60">
                                <IconUser size={12} className="text-blue-600" />
                                <span className="text-[11px] font-bold text-blue-900">{session.email}</span>
                            </div>
                        </div>
                    )}

                    {/* Estado actual */}
                    <div className="text-center">
                        {isApproved ? (
                            <p className="text-[13px] text-emerald-700 leading-relaxed font-semibold">
                                🎉 ¡Tu cuenta ha sido aprobada! Te llevamos al panel de acceso.
                            </p>
                        ) : (
                            <>
                                <p className="text-[13px] text-slate-700 leading-relaxed">
                                    {status?.business_name && (
                                        <span className="font-bold text-slate-900">
                                            {status.business_name}
                                        </span>
                                    )}
                                    {" "}está siendo validado por nuestro equipo.
                                </p>
                                <p className="text-[12px] text-slate-500 mt-1.5">
                                    {error || "Te avisaremos cuando esté activo. Esto suele tardar menos de 24h."}
                                </p>
                            </>
                        )}
                    </div>

                    {/* Contador 24h */}
                    {!isApproved && (
                        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-lg">
                            <div className="flex items-center justify-center gap-2 text-blue-300 text-[11px] font-bold tracking-widest uppercase mb-2">
                                <IconLock size={14} strokeWidth={2.4} />
                                Cortesía activa
                            </div>
                            <div className="text-center font-mono text-[36px] sm:text-[42px] font-black text-white tabular-nums tracking-wider">
                                {formatRemaining(remainingMs)}
                            </div>
                            <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-1000"
                                    style={{ width: `${Math.max(0, Math.min(100, (remainingMs / (24 * 60 * 60 * 1000)) * 100))}%` }}
                                />
                            </div>
                            <p className="text-center text-[10.5px] text-slate-400 mt-2">
                                {remainingMs > 0
                                    ? "Tu espacio de cortesía está disponible 24h desde tu registro."
                                    : "Tu periodo de cortesía ha finalizado."}
                            </p>
                        </div>
                    )}

                    {/* Pasos del proceso */}
                    <div className="space-y-2.5">
                        <Step done label="Registro completado" />
                        <Step done label="24h de cortesía concedidas" />
                        <Step done={isApproved} active={!isApproved && !status} label="Validación por el equipo" />
                        <Step done={isApproved} active={!isApproved && !!status} label="Activación de 7 días de trial" />
                    </div>

                    {/* Botones */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                        <a
                            href={whalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12.5px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition touch-manipulation shadow-md shadow-emerald-500/30"
                        >
                            💬 WhatsApp
                        </a>
                        <button
                            onClick={() => {
                                // ★ v3.4.4: Navegación limpia a /auth con replace.
                                //   replace:true evita que el botón "Atrás" del navegador
                                //   vuelva a /welcome y genere un bucle.
                                //   ?approved=1 fuerza al AuthPage a mostrar el banner.
                                navigate("/auth?approved=1", { replace: true });
                            }}
                            className="h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition touch-manipulation shadow-md shadow-blue-500/30"
                        >
                            <IconArrowRight size={14} strokeWidth={2.5} />
                            Ir al login
                        </button>
                    </div>

                    {/* Indicador */}
                    <div className="flex items-center justify-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"} animate-pulse`} />
                            {isOnline ? "En línea" : "Sin conexión"}
                        </span>
                        <span>•</span>
                        <span>
                            {pollCount} {pollCount === 1 ? "consulta" : "consultas"}
                        </span>
                        {method && (
                            <>
                                <span>•</span>
                                <span className="font-mono">{method}</span>
                            </>
                        )}
                    </div>

                    {/* Detalles técnicos */}
                    <details className="text-[10.5px] text-slate-500 border-t border-slate-200/60 pt-3">
                        <summary className="cursor-pointer font-semibold text-slate-600">
                            Detalles técnicos
                        </summary>
                        <div className="mt-2 space-y-1 font-mono">
                            <div>Email: {session.email || "—"}</div>
                            <div>User ID: {session.userId?.slice(0, 8) || "—"}...</div>
                            <div>Negocio: {status?.business_name || "—"}</div>
                            <div>Plan: {status?.plan_selected || "—"}</div>
                            <div>Status: {status?.activation_status || (loading ? "cargando..." : "sin tenant")}</div>
                            {status?.grace_period_ends_at && (
                                <div>Cortesía: {new Date(status.grace_period_ends_at).toLocaleString("es-ES")}</div>
                            )}
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
}

function Step({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
    return (
        <div className="flex items-center gap-3">
            <div
                className={
                    "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 " +
                    (done
                        ? "bg-emerald-500 text-white"
                        : active
                            ? "bg-blue-600 text-white ring-4 ring-blue-200 animate-pulse"
                            : "bg-slate-200 text-slate-500")
                }
            >
                {done ? "✓" : active ? "●" : "○"}
            </div>
            <span
                className={
                    "text-[12.5px] " +
                    (done
                        ? "text-slate-500 line-through"
                        : active
                            ? "text-slate-900 font-bold"
                            : "text-slate-500")
                }
            >
                {label}
            </span>
        </div>
    );
}

export default WelcomePage;
