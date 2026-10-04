// =====================================================================
// MOZONA TPV — AuthPage (v4.0.7-resend-otp)
// =====================================================================
// Verificación por código OTP con envío via Resend API.
//
// FLUJOS:
//   - signup: introduce email + password + nombre del local → envía OTP
//     → pantalla 6 dígitos → verificacion → crea cuenta → onboarding (/welcome)
//   - login:  introduce email + password → login normal sin OTP (usuarios
//     recurrentes entran directamente con su sesion)
//   - forgot: envía OTP para reset
//
// VIP BYPASS:
//   - chalohiahmd1980@gmail.com: acceso directo al TPV
//     sin OTP, sin necesidad de cuenta previa.
//   - rofixinsta@gmail.com: NO entra al TPV, va al panel admin
//     (/admin). Si intenta entrar al TPV se le redirige.
//
// SMTP/EMAIL:
//   - Requiere Edge Function `send-email` desplegada en Supabase
//   - Requiere RESEND_API_KEY en Supabase Edge Function Secrets
//   - SQL #52 contiene la tabla email_outbox y las RPCs
// =====================================================================

import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { isVipOrAdmin } from "../lib/vip";
import { Logo } from "../components/Logo";
import {
    IconEye,
    IconEyeOff,
    IconShield,
    IconLock,
    IconArrowRight,
    IconSparkles,
    IconCheck,
} from "../components/icons";
import { useRateLimit } from "../hooks/useRateLimit";
import {
    rpcSendOtpCode,
    rpcVerifyOtpCode,
    rpcTriggerSendEmail,
} from "../lib/secureRpc";

// ★ Email regex estricto (formato + dominios sospechosos)
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
const DISPOSABLE_DOMAINS = [
    "mailinator.com", "tempmail.com", "10minutemail.com",
    "guerrillamail.com", "throwaway.email", "yopmail.com",
    "trashmail.com", "fakeinbox.com", "maildrop.cc",
    "tempmail.org", "sharklasers.com", "guerrillamailblock.com",
];
const BANNED_CHARS = /[\\<>{}|]/;

function validateEmail(email: string): { ok: boolean; reason?: string; friendly?: string } {
    const v = email.trim().toLowerCase();
    if (!v) return { ok: false, reason: "vacio", friendly: "Introduce tu correo electronico" };
    if (!EMAIL_REGEX.test(v)) return { ok: false, reason: "formato", friendly: "El formato del correo no es correcto. Revisa la @ y el punto." };
    if (BANNED_CHARS.test(v)) return { ok: false, reason: "caracteres_invalidos", friendly: "El correo contiene caracteres no permitidos." };
    const dom = v.split("@")[1] || "";
    if (DISPOSABLE_DOMAINS.includes(dom)) return { ok: false, reason: "email_temporal", friendly: "Por favor, usa un correo electronico real. No aceptamos correos temporales." };
    return { ok: true };
}

function validatePassword(pwd: string): { ok: boolean; reason?: string; friendly?: string } {
    if (!pwd) return { ok: false, reason: "vacio", friendly: "Introduce una contrasena" };
    if (pwd.length < 6) return { ok: false, reason: "longitud", friendly: "La contrasena debe tener al menos 6 caracteres." };
    return { ok: true };
}

// ★ Banner reutilizable
function Banner({ msg }: { msg: { kind: "ok" | "err"; text: string } }) {
    return (
        <div
            role={msg.kind === "err" ? "alert" : "status"}
            className={`mt-3 p-3 rounded-xl text-[12.5px] font-semibold ${
                msg.kind === "ok"
                    ? "bg-emerald-50 border border-emerald-200/70 text-emerald-800"
                    : "bg-rose-50 border border-rose-200/70 text-rose-800"
            }`}
        >
            {msg.text}
        </div>
    );
}

// ★ Shell visual reutilizable
function AuthShell({ children, justApproved }: { children: React.ReactNode; justApproved?: boolean }) {
    return (
        <div className="min-h-dvh w-full bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4">
            {justApproved && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-[13px] font-bold shadow-xl z-50">
                    Tu cuenta ha sido aprobada. Bienvenido.
                </div>
            )}
            <div className="w-full max-w-md">
                <div className="text-center mb-6">
                    <Link to="/" className="inline-block">
                        <Logo variant="full" size="md" />
                    </Link>
                </div>
                <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
                    {children}
                </div>
            </div>
        </div>
    );
}

// ★ Componente principal
export function AuthPage() {
    const auth = useAuth();
    const nav = useNavigate();

    const [searchParams] = useSearchParams();
    const justApproved = searchParams.get("approved") === "1";
    const initialMode = (() => {
        const m = searchParams.get("mode");
        if (m === "signup" || m === "forgot" || m === "login") return m;
        return "login";
    })();
    const [mode, setMode] = useState<"login" | "signup" | "forgot">(initialMode);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [pwd2, setPwd2] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [showPwd2, setShowPwd2] = useState(false);
    const [businessName, setBusinessName] = useState("");

    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    // ★ v4.0.7-resend-otp: Estado del flujo OTP
    const [needsOtp, setNeedsOtp] = useState(false);
    const [otpCode, setOtpCode] = useState("");
    const [otpEmail, setOtpEmail] = useState("");
    const [otpPurpose, setOtpPurpose] = useState<"signup" | "login" | "reset">("signup");
    const [otpSending, setOtpSending] = useState(false);
    // ★ v4.5.7: dev mode cuando email no se puede enviar
    const [otpDevCode, setOtpDevCode] = useState<string | null>(null);
    const [otpDevMode, setOtpDevMode] = useState(false);
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // ★ v4.0.7-resend-otp: Estado pendiente del signup (para crear cuenta tras OTP)
    const [pendingSignup, setPendingSignup] = useState<{
        email: string;
        password: string;
        name: string;
        businessName: string;
    } | null>(null);

    // ★ VIP bypass automático
    const isVipEmail = useMemo(() => isVipOrAdmin(email), [email]);

    const rate = useRateLimit({ key: "auth_login", maxAttempts: 5, windowMs: 60_000 });

    // ★ Si ya está autenticado, redirigir
    useEffect(() => {
        if (auth.isReady && auth.user) {
            if (auth.isSuperAdmin) { nav("/admin", { replace: true }); return; }
            if (isVipOrAdmin(auth.user.email)) { nav("/app", { replace: true }); return; }
            if (auth.tenant) { nav("/app", { replace: true }); return; }
        }
    }, [auth.isReady, auth.user, auth.isSuperAdmin, auth.tenant, nav, isVipEmail]);

    const emailCheck = useMemo(() => validateEmail(email), [email]);
    const pwdCheck = useMemo(() => (pwd ? validatePassword(pwd) : null), [pwd]);

    // ══════════════════════════════════════
    // ★ Submit principal (login | signup | forgot)
    // ══════════════════════════════════════
    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setMsg(null);

        const ev = validateEmail(email);
        if (!ev.ok) {
            setMsg({ kind: "err", text: ev.friendly || "Correo no valido" });
            return;
        }

        if (rate.isBlocked) {
            setMsg({ kind: "err", text: "Has hecho demasiados intentos. Espera un minuto." });
            return;
        }

        // Validaciones segun modo
        if (mode === "signup") {
            if (!name.trim()) {
                setMsg({ kind: "err", text: "Dinos el nombre de tu negocio para empezar." });
                return;
            }
            if (!pwd) {
                setMsg({ kind: "err", text: "Introduce una contrasena." });
                return;
            }
            if (pwd !== pwd2) {
                setMsg({ kind: "err", text: "Las contrasenas no coinciden." });
                return;
            }
            const pv = validatePassword(pwd);
            if (!pv.ok) {
                setMsg({ kind: "err", text: pv.friendly || "Contrasena no valida" });
                return;
            }
        } else if (mode === "login" || mode === "forgot") {
            if (!pwd && mode === "login") {
                setMsg({ kind: "err", text: "Introduce tu contrasena." });
                return;
            }
        }

        setBusy(true);

        try {
            if (mode === "signup") {
                await handleSignup();
            } else if (mode === "login") {
                await handleLogin();
            } else if (mode === "forgot") {
                await handleForgot();
            }
        } catch (e: any) {
            setBusy(false);
            console.warn("[AuthPage] submit error:", e?.message || e);
            setMsg({
                kind: "err",
                text: "Algo se ha desconfigurado. Reintenta. Si el problema continúa, revisa la consola del navegador.",
            });
        }
    };

    // ★ v4.0.7-resend-otp: SIGNUP con verificación OTP
    const handleSignup = async () => {
        const submitEmail = email.trim();
        const submitPassword = pwd;

        // 1) Validar password duplicado
        if (pwd !== pwd2) {
            setBusy(false);
            setMsg({ kind: "err", text: "Las contrasenas no coinciden." });
            return;
        }

        // 2) Generar código OTP y enviar email
        setMsg({ kind: "ok", text: "Enviando codigo de verificacion a tu correo..." });
        setOtpSending(true);

        const otpResult = await rpcSendOtpCode(submitEmail, "signup", name.trim() || null);
        setOtpSending(false);

        if (!otpResult.ok) {
            // VIP bypass: si es VIP y el envio falla, continuar sin OTP
            if (isVipOrAdmin(submitEmail)) {
                setMsg({ kind: "ok", text: "Acceso VIP. Creando cuenta sin OTP..." });
                await performActualSignup(submitEmail, submitPassword, name.trim(), businessName.trim() || name.trim());
                return;
            }
            setBusy(false);
            setMsg({
                kind: "err",
                text: `No pudimos enviar el codigo: ${otpResult.error || "reintenta"}. Si persiste, contacta con soporte.`,
            });
            return;
        }

        // ★ v4.5.7: guardar dev_code para mostrarlo si Resend no configurado
        if (otpResult.dev_code) {
            setOtpDevCode(otpResult.dev_code);
            setOtpDevMode(!!otpResult.dev_mode);
        }

        // ★ v4.5.11: Guardar solicitud de tenant (admin la verá en /admin)
        try {
            const { rpcCreateTenantRequest } = await import("../lib/secureRpc");
            await rpcCreateTenantRequest({
                email: submitEmail,
                name: name.trim(),
                businessName: businessName.trim() || name.trim(),
                plan: "trial",
            });
        } catch (e) {
            console.warn("[AuthPage] create tenant request fallback:", String(e));
        }

        // 3) Disparar envio en background (Edge Function)
        rpcTriggerSendEmail().catch(() => {});

        // 4) Mostrar pantalla OTP
        setPendingSignup({
            email: submitEmail,
            password: submitPassword,
            name: name.trim(),
            businessName: businessName.trim() || name.trim(),
        });
        setOtpEmail(submitEmail);
        setOtpPurpose("signup");
        setOtpCode("");
        setNeedsOtp(true);
        setBusy(false);
        const masked = submitEmail.replace(/(.{2}).*(@.*)/, "$1•••$2");
        setMsg({
            kind: "ok",
            text: `Te enviamos un codigo de 6 digitos a ${masked}. Revisa tu bandeja de entrada.`,
        });
    };

    // ★ v4.0.7-resend-otp: LOGIN (sin OTP para usuarios existentes)
    const handleLogin = async () => {
        const submitEmail = email.trim();
        const submitPassword = pwd;

        if (!supabase) {
            setBusy(false);
            setMsg({ kind: "err", text: "Servicio no disponible. Reintenta en unos segundos." });
            return;
        }

        const { error } = await supabase.auth.signInWithPassword({
            email: submitEmail,
            password: submitPassword,
        });

        if (error) {
            // ★ v4.5.17: BLOQUE 3.4 — email no confirmado (post-H-04)
            // Cuando se desactive mailer_autoconfirm, Supabase devuelve
            // error.code === "email_not_confirmed". Reenviamos el email
            // y avisamos al usuario.
            if (error.code === "email_not_confirmed" ||
                /confirm/i.test(error.message ?? "")) {
                try {
                    await supabase.auth.resend({
                        type: "signup",
                        email: submitEmail,
                    });
                } catch (_) { /* ignore resend errors */ }
                setBusy(false);
                setMsg({
                    kind: "err",
                    text: "Tu correo aun no esta confirmado. Te lo hemos reenviado. Revisa tu bandeja (y spam).",
                });
                return;
            }

            // ★ VIP bypass
            if (isVipOrAdmin(submitEmail)) {
                const mockUser = {
                    id: "vip-" + btoa(submitEmail).slice(0, 20),
                    email: submitEmail,
                    user_metadata: { name: "VIP Access", vip: true },
                    app_metadata: { provider: "vip-bypass" },
                    aud: "authenticated",
                    created_at: new Date().toISOString(),
                };
                if (auth.setMockSession) {
                    auth.setMockSession(mockUser as any);
                }
                setMsg({ kind: "ok", text: "Acceso VIP concedido. Entrando..." });
                rate.reset();
                setTimeout(() => nav("/app", { replace: true }), 300);
                return;
            }

            rate.recordFailure();
            setBusy(false);
            const m = error.message?.toLowerCase() || "";
            if (m.includes("invalid") || m.includes("credentials")) {
                setMsg({
                    kind: "err",
                    text: "El correo o la contrasena no coinciden. Si aun no tienes cuenta, pulsa 'Empieza gratis'.",
                });
            } else {
                setMsg({ kind: "err", text: error.message || "No pudimos iniciar sesion." });
            }
            return;
        }

        // Login exitoso
        setMsg({ kind: "ok", text: "Sesion iniciada. Entrando..." });
        rate.reset();
        setTimeout(() => nav("/welcome", { replace: true }), 400);
    };

    // ★ v4.0.7-resend-otp: FORGOT PASSWORD via OTP
    const handleForgot = async () => {
        const submitEmail = email.trim();
        if (!submitEmail) {
            setBusy(false);
            setMsg({ kind: "err", text: "Introduce tu correo electronico." });
            return;
        }

        setBusy(false);
        setMsg({ kind: "ok", text: "Enviando codigo de recuperacion..." });
        setOtpSending(true);

        const otpResult = await rpcSendOtpCode(submitEmail, "reset", null);
        setOtpSending(false);

        if (!otpResult.ok) {
            setMsg({
                kind: "err",
                text: `No pudimos enviar el codigo: ${otpResult.error || "reintenta"}.`,
            });
            return;
        }

        rpcTriggerSendEmail().catch(() => {});

        setOtpEmail(submitEmail);
        setOtpPurpose("reset");
        setOtpCode("");
        setNeedsOtp(true);
        const masked = submitEmail.replace(/(.{2}).*(@.*)/, "$1•••$2");
        setMsg({
            kind: "ok",
            text: `Te enviamos un codigo de recuperacion a ${masked}.`,
        });
    };

    // ★ v4.0.7-resend-otp: VERIFICAR código OTP
    const handleVerifyOtp = async () => {
        if (otpCode.length !== 6) {
            setMsg({ kind: "err", text: "Introduce los 6 digitos del codigo." });
            return;
        }

        setBusy(true);
        setMsg({ kind: "ok", text: "Verificando codigo..." });

        // ★ v4.5.7: pasar dev_code para fallback local si Resend no configurado
        const result = await rpcVerifyOtpCode(otpEmail, otpCode, otpPurpose, otpDevCode || undefined);
        if (!result.ok || !result.verified) {
            setBusy(false);
            setMsg({ kind: "err", text: result.error || "El codigo no es correcto o ha expirado." });
            return;
        }

        // Código verificado
        if (otpPurpose === "signup" && pendingSignup) {
            // Crear la cuenta con los datos pendientes
            setMsg({ kind: "ok", text: "Codigo verificado. Creando tu cuenta..." });
            await performActualSignup(
                pendingSignup.email,
                pendingSignup.password,
                pendingSignup.name,
                pendingSignup.businessName
            );
        } else if (otpPurpose === "reset") {
            // Reset password: pedir nueva contraseña
            setBusy(false);
            setMsg({
                kind: "ok",
                text: "Codigo verificado. Ahora introduce tu nueva contrasena.",
            });
            setMode("login");
            setNeedsOtp(false);
            setPwd("");
        } else {
            setBusy(false);
            setMsg({ kind: "ok", text: "Codigo verificado." });
            setNeedsOtp(false);
        }
    };

    // ★ Realiza el signup en Supabase Auth tras OTP verificado
    const performActualSignup = async (
        submitEmail: string,
        submitPassword: string,
        submitName: string,
        submitBusinessName: string
    ) => {
        if (!supabase) {
            setBusy(false);
            setMsg({ kind: "err", text: "Supabase no configurado." });
            return;
        }

        // 1) Crear user en Supabase Auth
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
            email: submitEmail,
            password: submitPassword,
            options: {
                data: {
                    name: submitName,
                    business_name: submitBusinessName,
                },
            },
        });

        if (signUpErr) {
            const isAlreadyExists =
                signUpErr.message?.toLowerCase().includes("already") ||
                signUpErr.status === 422;

            if (isAlreadyExists) {
                // User ya existe: hacer login directo
                const { error: loginErr } = await supabase.auth.signInWithPassword({
                    email: submitEmail,
                    password: submitPassword,
                });
                if (loginErr) {
                    setBusy(false);
                    setMsg({
                        kind: "err",
                        text: "Esta cuenta ya existe y la contrasena no coincide. Inicia sesion con tu contrasena original.",
                    });
                    setNeedsOtp(false);
                    return;
                }
                setMsg({ kind: "ok", text: "Sesion iniciada. Entrando..." });
                setNeedsOtp(false);
                setTimeout(() => nav("/welcome", { replace: true }), 400);
                return;
            }

            setBusy(false);
            setMsg({
                kind: "err",
                text: `No pudimos crear tu cuenta: ${signUpErr.message || "intenta con otra contrasena"}.`,
            });
            return;
        }

        const userId = signUpData?.user?.id;
        if (!userId) {
            setBusy(false);
            setNeedsOtp(false);
            setMsg({
                kind: "err",
                text: "Supabase no devolvio un ID de usuario. Contacta con soporte.",
            });
            return;
        }

        // 2) Login automatico (sin requerir email confirmation porque usamos OTP)
        const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: submitEmail,
            password: submitPassword,
        });

        if (signInErr) {
            setBusy(false);
            setMsg({
                kind: "err",
                text: "Cuenta creada pero no pudimos iniciar sesion. Inicia sesion manualmente con tu correo y contrasena.",
            });
            setMode("login");
            setNeedsOtp(false);
            return;
        }

        // 3) Login exitoso: notificar y navegar
        setMsg({ kind: "ok", text: "Cuenta creada. Entrando..." });
        setNeedsOtp(false);
        await notifySignupTelegram(submitName, submitEmail, userId);
        rate.reset();
        setTimeout(() => nav("/welcome", { replace: true }), 400);
    };

    // ★ Telegram notification (best-effort, no bloquea)
    const notifySignupTelegram = async (userName: string, userEmail: string, userId: string) => {
        try {
            const { sendTelegramMessage } = await import("../lib/telegramAuto");
            const md = [
                "🆕 *Nueva solicitud de alta*",
                `👤 Nombre: ${userName}`,
                `📧 Email: \`${userEmail}\``,
                `🆔 User ID: \`${userId}\``,
                "",
                "👇 Pulsa para aprobar o rechazar:",
            ].join("\n");
            const inlineKeyboard = {
                // ★ v4.5.17: ELIMINADO token mozona-approve-2025 (H-05 auditoría).
                //   El admin accede via /admin tras hacer login. La autorización
                //   se decide server-side en la edge function admin-ops.
                inline_keyboard: [
                    [
                        {
                            text: "✅ APROBAR (1 CLICK)",
                            // URL sin secretos: solo indica al admin que revise
                            // el panel /admin. La aprobación real la hace ahí.
                            url: `https://mozonatpv.site/admin`,
                        },
                    ],
                    [
                        {
                            text: "❌ Rechazar",
                            url: `https://mozonatpv.site/admin`,
                        },
                    ],
                ],
            };
            await sendTelegramMessage(md, inlineKeyboard);
        } catch (e) {
            console.warn("[signup] telegram notify error:", e);
        }
    };

    const waitingForTenant = auth.isReady && !!auth.user && !auth.tenant && !isVipOrAdmin(auth.user?.email);

    if (!isSupabaseConfigured) {
        return (
            <AuthShell justApproved={justApproved}>
                <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200/80 text-[12.5px] text-amber-800">
                    <strong>Modo demo.</strong> El servicio de autenticacion no esta configurado. Rellena <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en .env.
                </div>
            </AuthShell>
        );
    }

    // ★ VIP sin tenant: mostrar UI de espera
    if (waitingForTenant) {
        return <WaitingForTenantView auth={auth} />;
    }

    // ★ v4.0.7-resend-otp: Pantalla de verificacion OTP (6 digitos)
    if (needsOtp) {
        const maskedEmail = otpEmail.replace(/(.{2}).*(@.*)/, "$1•••$2");
        return (
            <AuthShell justApproved={justApproved}>
                <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-3xl shadow-lg">
                        🔐
                    </div>
                    <h1 className="text-[24px] font-black text-slate-900 mb-2 tracking-tight">
                        Verifica tu correo
                    </h1>
                    <p className="text-[13px] text-slate-600 mb-6">
                        Te hemos enviado un codigo de 6 digitos a<br />
                        <span className="font-bold text-slate-800">{maskedEmail}</span>
                    </p>

                    {/* ★ v4.5.7: Banner DEV MODE si Resend no configurado */}
                    {otpDevMode && otpDevCode && (
                        <div className="mb-4 px-3 py-3 rounded-xl bg-amber-50 border-2 border-amber-300 text-left">
                            <div className="flex items-start gap-2">
                                <span className="text-xl">⚠️</span>
                                <div className="flex-1 text-[12px] text-amber-900">
                                    <strong className="block mb-1">Email no enviado (Resend no configurado)</strong>
                                    <p className="mb-2">Tu codigo OTP es:</p>
                                    <div className="text-center">
                                        <code className="inline-block px-4 py-2 bg-white border border-amber-300 rounded-lg text-[20px] font-mono font-black tracking-widest text-amber-900 select-all">
                                            {otpDevCode}
                                        </code>
                                    </div>
                                    <p className="mt-2 text-[10px] text-amber-700">
                                        (Modo desarrollo — el codigo se genero localmente porque el servicio de email no esta configurado)
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-center gap-2 mb-4">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <input
                                key={i}
                                ref={(el) => { otpInputRefs.current[i] = el; }}
                                type="text"
                                maxLength={1}
                                value={otpCode[i] || ""}
                                onChange={(e) => {
                                    const newCode = otpCode.split("");
                                    newCode[i] = e.target.value.replace(/\D/g, "").slice(-1);
                                    const finalCode = newCode.join("");
                                    setOtpCode(finalCode);
                                    if (e.target.value && i < 5) {
                                        otpInputRefs.current[i + 1]?.focus();
                                    }
                                    // Auto-verificar cuando se completa
                                    if (finalCode.length === 6) {
                                        setTimeout(() => handleVerifyOtp(), 200);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Backspace" && !otpCode[i] && i > 0) {
                                        otpInputRefs.current[i - 1]?.focus();
                                    }
                                }}
                                onPaste={(e) => {
                                    e.preventDefault();
                                    const pasted = (e.clipboardData.getData("text") || "")
                                        .replace(/\D/g, "")
                                        .slice(0, 6);
                                    if (pasted.length === 6) {
                                        setOtpCode(pasted);
                                        setTimeout(() => handleVerifyOtp(), 200);
                                    }
                                }}
                                className="w-11 h-14 text-center text-[22px] font-black rounded-xl border-2 border-slate-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none transition"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoFocus={i === 0}
                            />
                        ))}
                    </div>

                    <button
                        onClick={handleVerifyOtp}
                        disabled={busy || otpCode.length !== 6}
                        className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-[14px] shadow-lg transition flex items-center justify-center gap-2"
                    >
                        {busy ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                Verificando...
                            </>
                        ) : (
                            "Confirmar codigo"
                        )}
                    </button>

                    <button
                        onClick={async () => {
                            // Reenviar codigo
                            setMsg({ kind: "ok", text: "Reenviando codigo..." });
                            setOtpSending(true);
                            const r = await rpcSendOtpCode(otpEmail, otpPurpose, otpPurpose === "signup" ? pendingSignup?.name : null);
                            setOtpSending(false);
                            if (r.ok) {
                                rpcTriggerSendEmail().catch(() => {});
                                setOtpCode("");
                                otpInputRefs.current[0]?.focus();
                                setMsg({ kind: "ok", text: "Codigo reenviado. Revisa tu correo." });
                            } else {
                                setMsg({ kind: "err", text: `No pudimos reenviar: ${r.error}` });
                            }
                        }}
                        disabled={otpSending}
                        className="mt-3 text-[12.5px] text-violet-600 hover:text-violet-800 font-bold transition disabled:opacity-50"
                    >
                        {otpSending ? "Reenviando..." : "Reenviar codigo"}
                    </button>

                    <button
                        onClick={() => {
                            setNeedsOtp(false);
                            setOtpCode("");
                            setPendingSignup(null);
                            setMsg(null);
                        }}
                        className="mt-2 block w-full text-[12.5px] text-slate-500 hover:text-slate-700 transition"
                    >
                        ← Cambiar de correo
                    </button>

                    {msg && <Banner msg={msg} />}

                    <p className="text-[11.5px] text-slate-400 mt-5">
                        El codigo caduca en 15 minutos
                    </p>
                </div>
            </AuthShell>
        );
    }

    // ★ Pantalla principal: Login / Signup / Forgot
    return (
        <AuthShell justApproved={justApproved}>
            {/* Cabecera */}
            <div className="text-center mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-black tracking-wider mb-3">
                    <IconSparkles size={11} strokeWidth={2.4} />
                    {mode === "signup" ? "EMPIEZA GRATIS" : mode === "forgot" ? "RECUPERAR ACCESO" : "BIENVENIDO DE VUELTA"}
                </div>
                <h1 className="text-[24px] font-black text-slate-900 tracking-tight">
                    {mode === "login" ? "Accede a tu panel" : mode === "signup" ? "Crea tu cuenta" : "Recuperar acceso"}
                </h1>
                <p className="text-[12.5px] text-slate-500 mt-1.5">
                    {mode === "signup"
                        ? "7 dias con todo incluido. Sin permanencia."
                        : mode === "forgot"
                        ? "Te ayudamos a recuperar tu cuenta."
                        : "Entra a tu panel de gestion."}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3" autoComplete="on">
                {/* Nombre del negocio (solo signup) */}
                {mode === "signup" && (
                    <>
                        <div>
                            <label className="text-[12px] font-bold text-slate-700 ml-1">Nombre del local</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Restaurante La Esquina"
                                autoComplete="organization"
                                className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-[12px] font-bold text-slate-700 ml-1">Nombre comercial (opcional)</label>
                            <input
                                type="text"
                                value={businessName}
                                onChange={(e) => setBusinessName(e.target.value)}
                                placeholder="La Esquina S.L."
                                autoComplete="organization-title"
                                className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                            />
                        </div>
                    </>
                )}

                {/* Email */}
                <div>
                    <label className="text-[12px] font-bold text-slate-700 ml-1">Correo electronico</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tu@correo.com"
                        autoComplete="email"
                        className={`mt-1 w-full h-11 px-3 rounded-xl border bg-white text-[14px] outline-none focus:ring-2 transition ${
                            email && !emailCheck.ok
                                ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
                                : "border-slate-300 focus:border-violet-500 focus:ring-violet-500/20"
                        }`}
                        required
                    />
                    {email && !emailCheck.ok && emailCheck.friendly && (
                        <p className="text-[11.5px] text-rose-600 mt-1 ml-1">{emailCheck.friendly}</p>
                    )}
                </div>

                {/* Password (login/signup, no forgot) */}
                {mode !== "forgot" && (
                    <div>
                        <label className="text-[12px] font-bold text-slate-700 ml-1">Contrasena</label>
                        <div className="relative mt-1">
                            <input
                                type={showPwd ? "text" : "password"}
                                value={pwd}
                                onChange={(e) => setPwd(e.target.value)}
                                placeholder="********"
                                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                                className="w-full h-11 px-3 pr-10 rounded-xl border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                                required
                                minLength={6}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPwd((s) => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 transition"
                                aria-label={showPwd ? "Ocultar contrasena" : "Mostrar contrasena"}
                            >
                                {showPwd ? <IconEyeOff size={16} strokeWidth={1.8} /> : <IconEye size={16} strokeWidth={1.8} />}
                            </button>
                        </div>
                        {mode === "signup" && pwdCheck && !pwdCheck.ok && pwdCheck.friendly && (
                            <p className="text-[11.5px] text-rose-600 mt-1 ml-1">{pwdCheck.friendly}</p>
                        )}
                    </div>
                )}

                {/* Password 2 (solo signup) */}
                {mode === "signup" && (
                    <div>
                        <label className="text-[12px] font-bold text-slate-700 ml-1">Repite la contrasena</label>
                        <div className="relative mt-1">
                            <input
                                type={showPwd2 ? "text" : "password"}
                                value={pwd2}
                                onChange={(e) => setPwd2(e.target.value)}
                                placeholder="********"
                                autoComplete="new-password"
                                className={`w-full h-11 px-3 pr-10 rounded-xl border bg-white text-[14px] outline-none focus:ring-2 transition ${
                                    pwd2 && pwd !== pwd2
                                        ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
                                        : "border-slate-300 focus:border-violet-500 focus:ring-violet-500/20"
                                }`}
                                required
                                minLength={6}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPwd2((s) => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 transition"
                                aria-label={showPwd2 ? "Ocultar contrasena" : "Mostrar contrasena"}
                            >
                                {showPwd2 ? <IconEyeOff size={16} strokeWidth={1.8} /> : <IconEye size={16} strokeWidth={1.8} />}
                            </button>
                        </div>
                        {pwd2 && pwd !== pwd2 && (
                            <p className="text-[11.5px] text-rose-600 mt-1 ml-1">Las contrasenas no coinciden.</p>
                        )}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={busy}
                    className="mt-3 h-12 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 disabled:opacity-50 text-white font-black text-[14px] shadow-lg active:scale-95 transition flex items-center justify-center gap-2"
                >
                    {busy ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            {mode === "signup" ? "Creando cuenta..." : mode === "forgot" ? "Enviando..." : "Entrando..."}
                        </>
                    ) : (
                        <>
                            {mode === "signup" ? "Crear cuenta" : mode === "forgot" ? "Recuperar" : "Entrar"}
                            <IconArrowRight size={14} strokeWidth={2.4} />
                        </>
                    )}
                </button>

                {msg && <Banner msg={msg} />}
            </form>

            {/* Switch entre login / signup / forgot */}
            <div className="mt-5 pt-5 border-t border-slate-200 text-center text-[12.5px] text-slate-600">
                {mode === "login" && (
                    <>
                        <p>
                            ¿No tienes cuenta?{" "}
                            <button
                                type="button"
                                onClick={() => { setMode("signup"); setMsg(null); setPwd(""); setPwd2(""); }}
                                className="text-violet-600 font-bold hover:underline"
                            >
                                Empieza gratis
                            </button>
                        </p>
                        <button
                            type="button"
                            onClick={() => { setMode("forgot"); setMsg(null); }}
                            className="mt-2 text-[11.5px] text-slate-400 hover:text-slate-700"
                        >
                            ¿Olvidaste la contrasena?
                        </button>
                    </>
                )}
                {(mode === "signup" || mode === "forgot") && (
                    <button
                        type="button"
                        onClick={() => { setMode("login"); setMsg(null); setPwd(""); setPwd2(""); }}
                        className="text-violet-600 font-bold hover:underline"
                    >
                        ¿Ya tienes cuenta? Inicia sesion
                    </button>
                )}
            </div>

            {/* Trust footer */}
            <div className="mt-5 pt-4 border-t border-slate-100 text-center">
                <p className="text-[10.5px] text-slate-400 inline-flex items-center gap-1 justify-center">
                    <IconLock size={10} strokeWidth={2} /> Tus datos viajan cifrados de extremo a extremo
                </p>
                <p className="mt-2">
                    <a
                        href="/help.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-slate-400 hover:text-violet-600 underline transition"
                    >
                        ¿Problemas para entrar?
                    </a>
                </p>
            </div>
        </AuthShell>
    );
}

// ★ UI de espera para usuarios autenticados sin tenant (no-VIPs)
function WaitingForTenantView({ auth }: { auth: any }) {
    return (
        <div className="min-h-dvh w-full bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-3xl shadow-lg">
                    ⏳
                </div>
                <h1 className="text-[22px] font-black text-slate-900 mb-2">
                    Estamos preparando tu cuenta
                </h1>
                <p className="text-[13px] text-slate-600 mb-4">
                    Hola, <strong>{auth.user?.email}</strong>. Tu solicitud esta siendo revisada.
                    Te avisaremos por email cuando este activa (maximo 24h).
                </p>
                <p className="text-[12px] text-slate-500 mb-6">
                    Si tienes urgencia, contacta con soporte.
                </p>
                <button
                    onClick={() => auth.signOut?.()}
                    className="text-[12.5px] text-violet-600 font-bold hover:underline"
                >
                    Cerrar sesion
                </button>
            </div>
        </div>
    );
}
