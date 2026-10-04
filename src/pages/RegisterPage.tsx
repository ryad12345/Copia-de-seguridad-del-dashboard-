// =====================================================================
// MOZONA TPV — RegisterPage (/register)
// =====================================================================
// Sólo accesible tras verificación previa:
//   • PAGO:   ?session_id=cs_xxx  → valida con Stripe
//   • INVITE: ?invite_code=XXX&plan=lifetime_vip → código canjeado
//   • O BIEN sesión de Stripe ya verificada en sessionStorage
//   • O BIEN código de invitación ya canjeado en sessionStorage
//
// Al hacer submit:
//   1. signUp(email, password, name)
//   2. Crea tenant con plan "active"
//   3. Vincula al usuario como owner
//   4. Redirige a /setup/onboarding
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
    verifyCheckoutSession,
    getCachedVerifiedSession,
    cacheVerifiedSession,
    clearCachedVerifiedSession,
    applyPaidSessionToTenant,
    type CheckoutSessionInfo,
} from "../lib/billing";
import { IconCheck, IconShield, IconArrowRight, IconLock, IconSparkles } from "../components/icons";
import { Logo } from "../components/Logo";

type Phase = "verifying" | "ready" | "error" | "signing";
type EntryKind = "stripe" | "invite";

interface InvitePayload {
    code:       string;
    plan:       "plus_30" | "pro_50" | "lifetime_vip";
    redeemedAt: string;
}

const PLAN_LABEL: Record<string, { name: string; price: string }> = {
    plus_30:    { name: "Plus",         price: "30€/mes" },
    pro_50:     { name: "Pro",          price: "50€/mes" },
    lifetime_vip: { name: "Lifetime VIP", price: "Gratis permanente" },
};

const INVITE_KEY = "mozona.redeemed_invite";

function loadInvite(): InvitePayload | null {
    try {
        const raw = sessionStorage.getItem(INVITE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as InvitePayload;
    } catch (e) {
        return null;
    }
}

function clearInvite() {
    try { sessionStorage.removeItem(INVITE_KEY); } catch (e) { /* noop */ }
}

export function RegisterPage() {
    const auth = useAuth();
    const nav  = useNavigate();
    const [params] = useSearchParams();
    const sessionId  = (params.get("session_id")  ?? "").trim();
    const inviteCode = (params.get("invite_code") ?? "").trim();
    const planParam  = (params.get("plan")        ?? "").trim() as
                       "" | "plus_30" | "pro_50" | "lifetime_vip";

    // Log diagnóstico (visible en DevTools → Console)
    useEffect(() => {
        if (typeof window !== "undefined") {
            console.log("[RegisterPage] mount", {
                url: window.location.href,
                sessionId,
                inviteCode,
                planParam,
                authReady: auth.isReady,
                authUser:  auth.user?.id ?? null,
                authTenant: auth.tenant?.id ?? null,
                sessionStorageInvite: sessionStorage.getItem(INVITE_KEY),
            });
        }
    }, []);

    const [phase,    setPhase]    = useState<Phase>("verifying");
    const [error,    setError]    = useState<string | null>(null);
    const [kind,     setKind]     = useState<EntryKind>("stripe");
    const [session,  setSession]  = useState<CheckoutSessionInfo | null>(null);
    const [invite,   setInvite]   = useState<InvitePayload | null>(null);

    const [restaurantName, setRestaurantName] = useState("");
    const [fullName,       setFullName]       = useState("");
    const [email,          setEmail]          = useState("");
    const [pwd,            setPwd]            = useState("");
    const [confirmPwd,     setConfirmPwd]     = useState("");
    const [showPwd,        setShowPwd]        = useState(false);
    const [accept,         setAccept]         = useState(false);
    const [submitting,     setSubmitting]     = useState(false);
    const [submitError,    setSubmitError]    = useState<string | null>(null);

    // ---------------------------------------------------------------
    // Determinar entrypoint al montar
    //
    // REGLAS CRÍTICAS (anti-bucle):
    //   • Esta página es 100% PÚBLICA.  Ningún navigate automático a
    //     /pricing bajo ninguna circunstancia.
    //   • Si la URL trae ?invite_code=XXX, NUNCA verificamos Stripe.
    //   • Si la URL trae ?invite_code=XXX, NUNCA re-canjeamos en BD
    //     (el código ya se consumió en /pricing).  Confiamos en que
    //     si la URL tiene el código, viene de un canje válido.
    //   • Si falla todo, fallback silencioso a 'ready' con plan
    //     por defecto lifetime_vip (la URL es la fuente de verdad).
    // ---------------------------------------------------------------
    useEffect(() => {
        let cancelled = false;

        // 1) Si ya está autenticado, salimos a /app
        if (auth.isReady && auth.user) {
            nav("/app", { replace: true });
            return;
        }

        // 2) MODO INVITE: ?invite_code=XXX — NUNCA toca Stripe
        if (inviteCode) {
            console.log("[RegisterPage] MODO INVITE detectado:", inviteCode);
            // 2a) Cache del sessionStorage (camino feliz)
            const cached = loadInvite();
            if (cached && cached.code.toLowerCase() === inviteCode.toLowerCase()) {
                console.log("[RegisterPage] invite cacheado en sessionStorage");
                setKind("invite");
                setInvite(cached);
                setPhase("ready");
                return;
            }

            // 2b) Fallback inmediato y directo: usar la URL como
            //     fuente de verdad.  Si llegó aquí con invite_code,
            //     el código se consumió en /pricing — no hace falta
            //     re-canje, sólo mostrar el form.
            const fallbackPayload: InvitePayload = {
                code:       inviteCode,
                plan:       (planParam || "lifetime_vip") as InvitePayload["plan"],
                redeemedAt: new Date().toISOString(),
            };
            try { sessionStorage.setItem(INVITE_KEY, JSON.stringify(fallbackPayload)); } catch (e) { /* noop */ }
            if (!cancelled) {
                console.log("[RegisterPage] usando fallback (URL como fuente de verdad):", fallbackPayload);
                setKind("invite");
                setInvite(fallbackPayload);
                setPhase("ready");
            }

            // 2c) Re-canje en background (best-effort, no bloqueante)
            //     Útil si el usuario llegó por URL directa sin pasar
            //     por /pricing.  Si falla, ya tenemos el fallback.
            if (auth.redeemInvite) {
                void (async () => {
                    try {
                        const result = await auth.redeemInvite!(inviteCode);
                        if (cancelled) return;
                        if (result.ok) {
                            const payload: InvitePayload = {
                                code: result.code ?? inviteCode,
                                plan: (result.plan ?? planParam ?? "lifetime_vip") as InvitePayload["plan"],
                                redeemedAt: new Date().toISOString(),
                            };
                            try { sessionStorage.setItem(INVITE_KEY, JSON.stringify(payload)); } catch (e) { /* noop */ }
                            setInvite(payload);
                        }
                    } catch (e) {
                        console.warn("[RegisterPage] background re-redeem failed:", e);
                    }
                })();
            }
            return;
        }

        // 3) MODO STRIPE: ?session_id=cs_xxx
        if (sessionId) {
            (async () => {
                if (cancelled) return;
                const cached = getCachedVerifiedSession();
                if (cached && cached.session_id === sessionId) {
                    setKind("stripe");
                    setSession(cached);
                    setEmail(cached.customer_email ?? "");
                    setPhase("ready");
                    return;
                }
                const info = await verifyCheckoutSession(sessionId);
                if (cancelled) return;
                if (!info) {
                    setPhase("error");
                    setError(
                        "No se pudo verificar el pago.  Asegúrate de que la Edge Function " +
                        "`verify-checkout-session` está desplegada y de que la sesión de " +
                        "Stripe es válida y está pagada."
                    );
                    return;
                }
                cacheVerifiedSession(info);
                setKind("stripe");
                setSession(info);
                setEmail(info.customer_email ?? "");
                setPhase("ready");
            })();
            return;
        }

        // 4) Sin params → error (sin redirigir a /pricing)
        setPhase("error");
        setError(
            "No se proporcionó código de invitación ni ID de sesión de pago. " +
            "Vuelve a la página de precios."
        );
    }, [sessionId, inviteCode, planParam, auth.isReady, auth.user, auth.redeemInvite, nav]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);

        if (!restaurantName.trim()) {
            setSubmitError("Introduce el nombre de tu restaurante");
            return;
        }
        if (!fullName.trim()) {
            setSubmitError("Introduce tu nombre");
            return;
        }
        if (!email.trim() || !email.includes("@")) {
            setSubmitError("Email no válido");
            return;
        }
        if (pwd.length < 6) {
            setSubmitError("La contraseña debe tener al menos 6 caracteres");
            return;
        }
        if (pwd !== confirmPwd) {
            setSubmitError("Las contraseñas no coinciden");
            return;
        }
        if (!accept) {
            setSubmitError("Debes aceptar los términos");
            return;
        }
        if (kind === "stripe" && !session) {
            setSubmitError("Sesión de pago no verificada.  Vuelve a la página de precios.");
            return;
        }
        if (kind === "invite" && !invite) {
            setSubmitError("Código de invitación no verificado.  Vuelve a la página de precios.");
            return;
        }

        setSubmitting(true);

        // 1) Crear cuenta en Supabase Auth
        const { data, error: signUpErr } = await supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password: pwd,
            options: { data: { full_name: fullName.trim() } },
        });
        if (signUpErr || !data?.user) {
            setSubmitting(false);
            setSubmitError(signUpErr?.message ?? "No se pudo crear la cuenta");
            return;
        }

        // 2) Crear tenant según modo
        let tenant: { id: string; plan: string } | null = null;
        if (kind === "stripe" && session) {
            tenant = await applyPaidSessionToTenant(
                data.user.id, session, restaurantName.trim(),
            );
        } else if (kind === "invite" && invite) {
            tenant = await createTenantFromInvite(
                data.user.id, invite, restaurantName.trim(),
            );
        }

        if (!tenant) {
            setSubmitting(false);
            setSubmitError("Cuenta creada pero no se pudo vincular el restaurante.  Contacta con soporte.");
            return;
        }

        // 3) Vincular el usuario como owner en tenant_users
        await supabase.from("tenant_users").upsert({
            tenant_id:   tenant.id,
            user_id:     data.user.id,
            email:       email.trim().toLowerCase(),
            role:        "owner",
            pin_code:    "1234",
        }, { onConflict: "tenant_id,user_id" });

        // 4) Limpiar cache y refrescar auth
        if (kind === "stripe") clearCachedVerifiedSession();
        if (kind === "invite") clearInvite();
        setPhase("signing");
        if (!data.session) {
            const { error: signInErr } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(), password: pwd,
            });
            if (signInErr) {
                setSubmitting(false);
                setSubmitError("Cuenta creada.  Confirma tu email antes de iniciar sesión.");
                return;
            }
        }
        setSubmitting(false);
        nav("/setup/onboarding", { replace: true });
    };

    // ============================================================
    // RENDER
    // ============================================================
    if (phase === "verifying") {
        return (
            <CenteredCard>
                <Spinner />
                <h1 className="mt-4 text-[15px] font-bold text-slate-900">
                    Verificando acceso…
                </h1>
                <p className="mt-1 text-[12.5px] text-slate-500">
                    Estamos confirmando tu {kind === "invite" ? "código de invitación" : "pago"}.
                </p>
            </CenteredCard>
        );
    }

    if (phase === "error" || (kind === "stripe" && !session) || (kind === "invite" && !invite)) {
        return (
            <CenteredCard>
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-rose-100 text-rose-600
                                flex items-center justify-center">
                    <IconShield size={26} strokeWidth={1.8} />
                </div>
                <h1 className="text-[18px] font-black text-slate-900">
                    Acceso no verificado
                </h1>
                <p className="mt-2 text-[12.5px] text-slate-500 max-w-xs mx-auto">
                    {error ?? "No se pudo verificar tu acceso."}
                </p>

                {/* Si el usuario tenía un código de invitación pero falló
                    la re-verificación, le dejamos usar el form igualmente */}
                {inviteCode && (
                    <button
                        onClick={() => {
                            const payload: InvitePayload = {
                                code:       inviteCode,
                                plan:       (planParam || "lifetime_vip") as InvitePayload["plan"],
                                redeemedAt: new Date().toISOString(),
                            };
                            try { sessionStorage.setItem(INVITE_KEY, JSON.stringify(payload)); } catch (e) { /* noop */ }
                            setKind("invite");
                            setInvite(payload);
                            setPhase("ready");
                        }}
                        className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl
                                   bg-violet-600 text-white text-[12.5px] font-bold
                                   hover:bg-violet-700 active:scale-95 transition"
                    >
                        Continuar con código <span className="font-mono">{inviteCode.slice(-8)}</span>
                    </button>
                )}

                <Link
                    to="/welcome"
                    className="mt-3 inline-flex items-center gap-2 h-11 px-5 rounded-xl
                               bg-blue-600 text-white text-[13px] font-bold
                               hover:bg-blue-700 active:scale-95 transition"
                >
                    Volver a Precios
                    <IconArrowRight size={14} strokeWidth={2.4} />
                </Link>
            </CenteredCard>
        );
    }

    // Banner según modo
    const planName = kind === "invite" && invite
        ? PLAN_LABEL[invite.plan]?.name ?? "Lifetime VIP"
        : PLAN_LABEL[session?.plan ?? "plus_30"]?.name ?? "Plus";
    const planPrice = kind === "invite" && invite
        ? PLAN_LABEL[invite.plan]?.price ?? "Gratis"
        : PLAN_LABEL[session?.plan ?? "plus_30"]?.price ?? "30€/mes";
    const bannerColor = kind === "invite" ? "violet" : "emerald";
    const bannerBg = kind === "invite" ? "bg-violet-50 border-violet-200/80 text-violet-900" : "bg-emerald-50 border-emerald-200/80 text-emerald-900";
    const bannerBgSub = kind === "invite" ? "text-violet-700" : "text-emerald-700";
    const BannerIcon = kind === "invite" ? IconSparkles : IconCheck;

    return (
        <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-white flex items-start sm:items-center justify-center p-4 py-8">
            <div className="max-w-md w-full">
                {/* Logo */}
                <div className="text-center mb-6">
                    <Link to="/" className="inline-flex items-center gap-2">
                        <Logo variant="mark" size="md" />
                    </Link>
                </div>

                {/* Card */}
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl p-7">
                    {/* Header de éxito */}
                    <div className={`flex items-center gap-3 p-3.5 ${bannerBg} rounded-2xl mb-5`}>
                        <div className={`w-9 h-9 shrink-0 rounded-xl ${kind === "invite" ? "bg-violet-600" : "bg-emerald-500"}
                                        text-white flex items-center justify-center`}>
                            <BannerIcon size={18} strokeWidth={2.4} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[12.5px] font-bold">
                                {kind === "invite" ? "Invitación canjeada" : "Pago confirmado"} ·
                                Plan {planName}
                            </div>
                            <div className={`text-[11px] ${bannerBgSub}`}>
                                {planPrice}
                                {kind === "stripe" && session && (
                                    <> · Sesión <span className="font-mono">{session.session_id.slice(-8)}</span></>
                                )}
                                {kind === "invite" && invite && (
                                    <> · Código <span className="font-mono">{invite.code}</span></>
                                )}
                            </div>
                        </div>
                    </div>

                    <h1 className="text-[22px] font-black text-slate-900 leading-tight">
                        Crea tu cuenta
                    </h1>
                    <p className="mt-1 text-[12.5px] text-slate-500">
                        Último paso: define las credenciales de tu panel de gestión.
                    </p>

                    <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
                        <Field label="Nombre del restaurante" required>
                            <input
                                type="text"
                                value={restaurantName}
                                onChange={e => setRestaurantName(e.target.value)}
                                placeholder="Ej. Restaurante La Plaza"
                                className="input"
                                autoFocus
                            />
                        </Field>

                        <Field label="Tu nombre" required>
                            <input
                                type="text"
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                placeholder="Ej. María López"
                                className="input"
                            />
                        </Field>

                        <Field label="Email (usuario admin)" required>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="tu@email.com"
                                className="input"
                                autoComplete="email"
                            />
                        </Field>

                        <Field label="Contraseña" required>
                            <div className="relative">
                                <input
                                    type={showPwd ? "text" : "password"}
                                    value={pwd}
                                    onChange={e => setPwd(e.target.value)}
                                    placeholder="Mínimo 6 caracteres"
                                    className="input pr-20"
                                    autoComplete="new-password"
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

                        <Field label="Repite la contraseña" required>
                            <input
                                type={showPwd ? "text" : "password"}
                                value={confirmPwd}
                                onChange={e => setConfirmPwd(e.target.value)}
                                placeholder="Repite la contraseña"
                                className="input"
                                autoComplete="new-password"
                            />
                        </Field>

                        <label className="flex items-start gap-2 cursor-pointer pt-1">
                            <input
                                type="checkbox"
                                checked={accept}
                                onChange={e => setAccept(e.target.checked)}
                                className="mt-0.5 shrink-0"
                            />
                            <span className="text-[11.5px] text-slate-600 leading-snug">
                                Acepto los{" "}
                                <a href="#" className="text-blue-600 underline">términos</a>{" "}
                                y la{" "}
                                <a href="#" className="text-blue-600 underline">política de privacidad</a>.
                            </span>
                        </label>

                        {submitError && (
                            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200/80
                                            text-[12px] text-rose-700">
                                {submitError}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700
                                       text-white text-[14px] font-black
                                       shadow-md shadow-blue-600/30 active:scale-95
                                       transition disabled:opacity-50
                                       flex items-center justify-center gap-2"
                        >
                            {submitting
                                ? "Creando cuenta…"
                                : <>Crear mi cuenta
                                    <IconArrowRight size={16} strokeWidth={2.4} />
                                  </>}
                        </button>
                    </form>

                    <div className="mt-4 flex items-center justify-center gap-1.5
                                    text-[10.5px] text-slate-400">
                        <IconLock size={11} strokeWidth={2.2} />
                        Conexión cifrada · Supabase Auth
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-4 text-center text-[10.5px] text-slate-400">
                    ¿Ya tienes cuenta?{" "}
                    <Link to="/auth" className="text-blue-600 font-bold">
                        Iniciar sesión
                    </Link>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Crea tenant a partir de un código de invitación canjeado
// ---------------------------------------------------------------------

async function createTenantFromInvite(
    userId: string,
    invite: InvitePayload,
    restaurantName: string,
): Promise<{ id: string; plan: string } | null> {
    if (!isSupabaseConfigured) return null;
    try {
        // Si ya existe tenant del user, actualizar con plan del invite
        const existing = await supabase
            .from("tenants")
            .select("*")
            .eq("owner_id", userId)
            .maybeSingle();

        if (existing.data) {
            await supabase.from("tenants").update({
                plan: invite.plan,
                subscription_status: "active",
                name: restaurantName || existing.data.name,
            }).eq("id", existing.data.id);
            return { id: existing.data.id, plan: invite.plan };
        }

        const ins = await supabase.from("tenants").insert({
            owner_id:             userId,
            name:                 restaurantName || "Mi Restaurante",
            plan:                 invite.plan,
            subscription_status:  "active",
            onboarding_completed: false,
        }).select().single();

        if (ins.error) {
            console.warn("[register] createTenantFromInvite error:", ins.error.message);
            return null;
        }
        return { id: ins.data.id, plan: ins.data.plan };
    } catch (e) {
        console.warn("[register] createTenantFromInvite exception:", e);
        return null;
    }
}

// ---------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------

function Spinner() {
    return (
        <div className="w-10 h-10 mx-auto border-[3px] border-slate-200 border-t-blue-600
                        rounded-full animate-spin" />
    );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-dvh w-full bg-gradient-to-b from-slate-50 to-white
                        flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80
                            shadow-xl p-7 text-center">
                {children}
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
