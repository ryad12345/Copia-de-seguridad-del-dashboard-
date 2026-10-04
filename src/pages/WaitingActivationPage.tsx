// =====================================================================
// MOZONA TPV — WaitingActivationPage (v1.9.87)
// =====================================================================
// Sala de espera profesional.
// ★ v1.9.87: REESCRITA para funcionar SIN sesion de Supabase.
// Lee el email de localStorage y consulta el tenant via anon key.
// Funciona incluso si el email no esta confirmado (no requiere sesion).
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { IconShield, IconLock, IconUser, IconCheck } from "../components/icons";

interface TenantStatus {
    status: "pending_activation" | "active_trial" | "active" | "expired" | "vip";
    grace_period_ends_at?: string;
    trial_ends_at?: string;
    business_name?: string; // alias de "name" (para compatibilidad con código viejo)
    plan_selected?: string;
}

const SOPORTE_WHATSAPP = "34644165153";
const LS_LAST_EMAIL = "mozona.lastSignupEmail";
const LS_LAST_NAME  = "mozona.lastSignupName";
const LS_LAST_PLAN  = "mozona.lastSignupPlan";
const LS_PENDING    = "mozona.pendingSignup"; // ★ v1.9.93

function formatRemaining(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function WaitingActivationPage() {
    const navigate = useNavigate();
    const [status, setStatus] = useState<TenantStatus | null>(null);
    const [now, setNow] = useState(Date.now());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userEmail, setUserEmail] = useState<string>("");
    const [userName, setUserName] = useState<string>("");
    const [userPlan, setUserPlan] = useState<string>("");

    // ★ v1.9.87: leer email/nombre/plan de localStorage (NO requiere sesion)
    useEffect(() => {
        try {
            const e = localStorage.getItem(LS_LAST_EMAIL) || "";
            const n = localStorage.getItem(LS_LAST_NAME) || "";
            const p = localStorage.getItem(LS_LAST_PLAN) || "";
            setUserEmail(e);
            setUserName(n);
            setUserPlan(p);
        } catch (_) {}

        // ★ v1.9.93: procesar pendingSignup en BACKGROUND
        //   El modal guardo los datos aqui. Ahora hacemos:
        //   1) signUp (o signIn si ya existe)
        //   2) createTenant
        //   3) Telegram
        //   Sin bloquear la UI. Si todo falla, el admin puede
        //   crear el tenant manualmente desde el panel.
        const processPending = async () => {
            try {
                const raw = localStorage.getItem(LS_PENDING);
                if (!raw) return;
                const pending = JSON.parse(raw);
                if (!pending || !pending.email || !pending.password) {
                    localStorage.removeItem(LS_PENDING);
                    return;
                }
                // Solo procesar si el timestamp es reciente (< 10 min)
                if (Date.now() - (pending.timestamp || 0) > 10 * 60 * 1000) {
                    localStorage.removeItem(LS_PENDING);
                    return;
                }
                console.log("[WaitingActivation] processing pending signup for", pending.email);

                // 1) signUp via /api/check-and-fix-user (server-side, usa admin API)
                try {
                    const fixResp = await fetch("/api/check-and-fix-user", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: pending.email,
                            password: pending.password,
                            name: pending.name || "",
                        }),
                    });
                    const fixJson = await fixResp.json().catch(() => ({}));
                    console.log("[WaitingActivation] check-and-fix-user:", fixJson);
                } catch (e) {
                    console.warn("[WaitingActivation] check-and-fix-user error:", e);
                }

                // 2) createTenant via /api/notify-telegram (que crea el tenant)
                try {
                    await fetch("/api/notify-telegram", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            tenantId: null,
                            businessName: pending.name || pending.email,
                            contactEmail: pending.email,
                            planSelected: pending.plan || "basic",
                            businessType: pending.businessType,
                            source: "waiting-activation",
                        }),
                    });
                } catch (e) {
                    console.warn("[WaitingActivation] notify-telegram error:", e);
                }

                // 3) Limpiar pending
                localStorage.removeItem(LS_PENDING);
            } catch (e) {
                console.warn("[WaitingActivation] processPending error:", e);
            }
        };
        processPending();
    }, []);

    // ★ Tick cada segundo para el contador
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    // ★ v1.9.87: fetch con ANON KEY por email (no requiere tenant_id)
    // ★ v2.0.3: USA ENDPOINT SERVER-SIDE /api/get-tenant
    //   El endpoint maneja TODA la lógica de fallback (columna contact_email
    //   puede no existir, owner_id, etc). Si SERVICE_ROLE está configurada,
    //   bypasea RLS.
    const fetchStatus = useCallback(async () => {
        if (!userEmail) {
            setLoading(false);
            return;
        }
        try {
            console.log("[WaitingActivation] buscando tenant para:", userEmail);
            const r = await fetch("/api/get-tenant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: userEmail.trim().toLowerCase() }),
            });

            if (!r.ok) {
                console.error("[WaitingActivation] /api/get-tenant fallo:", r.status);
                setError("Estamos preparando tu espacio. La activación se completará en los próximos minutos.");
                setLoading(false);
                return;
            }

            const json = await r.json();
            console.log("[WaitingActivation] /api/get-tenant result:", { ok: json.ok, method: json.method, hasTenant: !!json.tenant });

            if (json.tenant) {
                const t = json.tenant;
                const newStatus: TenantStatus = {
                    status: t.activation_status ?? t.subscription_status ?? "pending_activation",
                    grace_period_ends_at: t.grace_period_ends_at,
                    trial_ends_at: t.trial_ends_at,
                    business_name: t.name ?? t.business_name,
                    plan_selected: t.plan_selected ?? t.plan,
                };
                setStatus(newStatus);
                console.log("[WaitingActivation] tenant encontrado:", {
                    id: t.id,
                    status: newStatus.status,
                    name: newStatus.business_name,
                    method: json.method,
                });
                // ★ Si el SuperAdmin ya aprobo, redirigir al panel
                if (newStatus.status === "active_trial" || newStatus.status === "active" || newStatus.status === "vip") {
                    navigate("/app", { replace: true });
                }
            } else {
                console.log("[WaitingActivation] no hay tenant todavia, method:", json.method);
                // ★ Si el user existe pero no tiene tenant, mostrar mensaje útil
                if (json.method === "user_no_tenant") {
                    setError("Tu cuenta está creada. Estamos creando tu espacio de trabajo...");
                } else if (json.method === "no_data_yet") {
                    setError("Procesando tu registro. Esto puede tardar unos segundos...");
                } else {
                    setError(null); // No mostrar error, solo el spinner
                }
            }
            setLoading(false);
        } catch (e) {
            console.error("[WaitingActivation] fetchStatus error:", e);
            setError("Estamos preparando tu espacio. La activación se completará en los próximos minutos.");
            setLoading(false);
        }
    }, [userEmail, navigate]);

    useEffect(() => {
        fetchStatus();
        const t = setInterval(fetchStatus, 30_000);
        const onFocus = () => fetchStatus();
        window.addEventListener("focus", onFocus);
        return () => {
            clearInterval(t);
            window.removeEventListener("focus", onFocus);
        };
    }, [fetchStatus]);

    // ★ Calcular tiempo restante
    const remainingMs = status?.grace_period_ends_at
        ? new Date(status.grace_period_ends_at).getTime() - now
        : 24 * 60 * 60 * 1000; // fallback 24h

    const whalink = `https://wa.me/${SOPORTE_WHATSAPP}?text=${encodeURIComponent(
        `Hola! Soy ${userEmail || "cliente"}. Estoy en la sala de espera de MOZONA TPV. Mi restaurante: ${status?.business_name || userName || "—"}`
    )}`;

    return (
        <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center p-5">
            <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/60 overflow-hidden">
                {/* Cabecera con animacion */}
                <div className="relative h-44 bg-gradient-to-br from-blue-600 via-violet-600 to-blue-700 flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "0ms" }} />
                        <div className="absolute top-12 right-8 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "700ms" }} />
                        <div className="absolute bottom-8 left-12 w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: "1400ms" }} />
                    </div>
                    <div className="relative text-center text-white">
                        <div className="w-20 h-20 mx-auto rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-3 shadow-xl ring-1 ring-white/30">
                            <IconShield size={36} strokeWidth={2.2} className="animate-pulse" />
                        </div>
                        <h1 className="text-[20px] font-black tracking-tight">
                            Configurando tu espacio
                        </h1>
                        <p className="text-[12.5px] text-blue-100 mt-1">
                            Tu caja esta casi lista
                        </p>
                    </div>
                </div>

                {/* Cuerpo */}
                <div className="p-6 sm:p-7 space-y-5">
                    {/* Estado actual */}
                    <div className="text-center">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            {(status?.business_name || userName) && (
                                <span className="font-bold text-slate-900">{status?.business_name || userName}</span>
                            )}{" "}
                            esta siendo configurado por nuestro equipo.
                        </p>
                        <p className="text-[12.5px] text-slate-500 mt-1">
                            Tiempo estimado de activacion: <span className="font-bold text-slate-700">menos de 24h</span>
                        </p>
                    </div>

                    {/* Contador en vivo */}
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-lg">
                        <div className="flex items-center justify-center gap-2 text-blue-300 text-[11px] font-bold tracking-widest uppercase mb-2">
                            <IconLock size={14} strokeWidth={2.4} />
                            Cortesia activa
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
                                ? "Tu espacio de cortesia esta disponible 24h. Pasado este tiempo, requerira aprobacion."
                                : "Tu periodo de cortesia ha finalizado. Contacta con soporte."}
                        </p>
                    </div>

                    {/* Pasos del proceso */}
                    <div className="space-y-2.5">
                        <Step done label="Registro completado" />
                        <Step done label="24h de cortesia concedidas" />
                        <Step active label="Validacion por el equipo" />
                        <Step label="Activacion de 7 dias de trial" />
                    </div>

                    {/* Botones de soporte */}
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
                            onClick={() => navigate("/auth")}
                            className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition touch-manipulation"
                        >
                            🚪 Ir al login
                        </button>
                    </div>

                    {/* Detalles tecnicos */}
                    <details className="text-[10.5px] text-slate-500 border-t border-slate-200/60 pt-3">
                        <summary className="cursor-pointer font-semibold text-slate-600">
                            Detalles tecnicos
                        </summary>
                        <div className="mt-2 space-y-1 font-mono">
                            <div>Email: {userEmail || "—"}</div>
                            <div>Negocio: {userName || status?.business_name || "—"}</div>
                            <div>Plan: {userPlan || status?.plan_selected || "—"}</div>
                            <div>Status: {status?.status ?? (loading ? "cargando..." : "sin tenant todavia")}</div>
                            <div>Cortesia: {status?.grace_period_ends_at ? new Date(status.grace_period_ends_at).toLocaleString("es-ES") : "24h por defecto"}</div>
                            {error && <div className="text-rose-600">Error: {error}</div>}
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

export default WaitingActivationPage;
