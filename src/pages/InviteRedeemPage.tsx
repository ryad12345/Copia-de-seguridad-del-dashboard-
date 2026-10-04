// =====================================================================
// MOZONA TPV — InviteRedeemPage (/invite/:token)
// =====================================================================
// Pantalla de canje de invitación generada en /admin/invites.
// El hostelero abre el enlace, ve el email pre-asignado, define su
// contraseña y activa la cuenta.
//
// Flujo:
//   1) Valida el token (existe + no usado)
//   2) Email en solo lectura (asignado por el SuperAdmin)
//   3) Contraseña + repetir contraseña
//   4) Al enviar: signUp en Supabase Auth con ese email
//   5) Marca invitación como aceptada (status='accepted', used_at=now())
//   6) Auto-login y redirige a /app
// =====================================================================

import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { supabase, isSupabaseConfigured, PUBLIC_URL } from "../lib/supabase";
import { IconCheck, IconShield } from "../components/icons";

interface InviteInfo {
    id:            string;
    token:         string;
    target_email:  string | null;
    is_redeemed:   boolean;
    plan_granted:  string;
    expires_at:    string | null;
}

const PLAN_LABEL: Record<string, string> = {
    plus_30:      "Plus (Mensual 30d)",
    pro_50:       "Pro (Mensual 30d)",
    annual_365:   "Anual (365d)",
    trial_14:     "Prueba (14d)",
    lifetime_vip: "VIP Vitalicio",
};

export function InviteRedeemPage() {
    const nav = useNavigate();
    const params = useParams<{ token: string }>();
    const [search] = useSearchParams();

    // Acepta tanto /invite/:token como /auth?invite=:token
    const token = params.token ?? search.get("invite") ?? "";

    const [invite,    setInvite]    = useState<InviteInfo | null>(null);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState<string | null>(null);

    const [pwd,       setPwd]       = useState("");
    const [pwd2,      setPwd2]      = useState("");
    const [showPwd,   setShowPwd]   = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [success,   setSuccess]   = useState(false);

    useEffect(() => { void load(); }, [token]);

    const load = async () => {
        if (!token) {
            setError("Falta el token de invitación");
            setLoading(false);
            return;
        }
        if (!isSupabaseConfigured) {
            setError("Supabase no configurado");
            setLoading(false);
            return;
        }
        try {
            const { data, error: qErr } = await supabase
                .from("free_invitations")
                .select("id, token, target_email, is_redeemed, plan_granted, expires_at")
                .eq("token", token)
                .maybeSingle();
            if (qErr) {
                setError(qErr.message);
            } else if (!data) {
                setError("Invitación no encontrada o token inválido");
            } else if (data.is_redeemed) {
                setError("Esta invitación ya fue canjeada");
                setInvite(data as InviteInfo);
            } else if (data.expires_at && new Date(data.expires_at) < new Date()) {
                setError("Esta invitación ha caducado");
                setInvite(data as InviteInfo);
            } else {
                setInvite(data as InviteInfo);
            }
        } catch (e: any) {
            console.warn("[inviteRedeem] error:", e);
            setError("No pudimos validar tu invitación. Por favor, inténtalo de nuevo.");
        }
        setLoading(false);
    };

    const validatePwd = (): string | null => {
        if (pwd.length < 8) return "La contraseña debe tener al menos 8 caracteres";
        if (pwd !== pwd2)   return "Las contraseñas no coinciden";
        return null;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!invite) return;
        if (!invite.target_email) {
            setError("Esta invitación no tiene email asignado. Contacta con el administrador.");
            return;
        }
        const pwdErr = validatePwd();
        if (pwdErr) { setError(pwdErr); return; }

        setSubmitting(true);
        try {
            // 1) Registrar en Supabase Auth
            const { data: signUp, error: signErr } = await supabase.auth.signUp({
                email:    invite.target_email,
                password: pwd,
            });
            if (signErr) {
                setError(signErr.message);
                setSubmitting(false);
                return;
            }
            // 2) Marcar invitación como canjeada
            const { error: updateErr } = await supabase
                .from("free_invitations")
                .update({
                    is_redeemed:  true,
                    used_at:      new Date().toISOString(),
                    redeemed_by:  invite.target_email,
                })
                .eq("id", invite.id);
            if (updateErr) {
                console.warn("[InviteRedeem] no se pudo marcar como canjeada:", updateErr.message);
            }

            // 3) Auto-login (signUp ya inicia sesión si confirmation email está desactivado)
            if (signUp.session) {
                setSuccess(true);
                setTimeout(() => nav("/app", { replace: true }), 1500);
            } else {
                // Si requiere confirmación, intentar login
                const { error: signInErr } = await supabase.auth.signInWithPassword({
                    email:    invite.target_email,
                    password: pwd,
                });
                if (signInErr) {
                    setError("Cuenta creada. Inicia sesión en " + PUBLIC_URL);
                    setTimeout(() => nav("/auth", { replace: true }), 2000);
                } else {
                    setSuccess(true);
                    setTimeout(() => nav("/app", { replace: true }), 1500);
                }
            }
        } catch (e: any) {
            console.warn("[inviteActivate] error:", e);
            setError("No pudimos activar tu cuenta. Por favor, inténtalo de nuevo.");
        }
        setSubmitting(false);
    };

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------

    if (loading) {
        return (
            <CenterCard>
                <div className="text-[13px] text-slate-500">Validando invitación…</div>
            </CenterCard>
        );
    }

    if (success) {
        return (
            <CenterCard>
                <div className="text-center">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600
                                    flex items-center justify-center mb-3">
                        <IconCheck size={28} strokeWidth={2.4} />
                    </div>
                    <h2 className="text-[18px] font-black text-slate-800">¡Cuenta activada!</h2>
                    <p className="mt-1 text-[12.5px] text-slate-500">
                        Te estamos llevando al TPV…
                    </p>
                </div>
            </CenterCard>
        );
    }

    if (error && !invite) {
        return (
            <CenterCard>
                <div className="text-center">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-100 text-rose-600
                                    flex items-center justify-center mb-3 text-[26px]">
                        ✕
                    </div>
                    <h2 className="text-[16px] font-black text-slate-800">Invitación no válida</h2>
                    <p className="mt-1 text-[12.5px] text-slate-500">{error}</p>
                    <Link to="/auth" className="mt-4 inline-block text-[12.5px] font-bold text-blue-600 hover:underline">
                        Ir a inicio de sesión
                    </Link>
                </div>
            </CenterCard>
        );
    }

    const planLabel = invite ? (PLAN_LABEL[invite.plan_granted] ?? invite.plan_granted) : "";

    return (
        <CenterCard>
            <div className="flex items-center gap-2 mb-1">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-violet-700
                                text-white flex items-center justify-center">
                    <IconShield size={18} strokeWidth={1.8} />
                </div>
                <div>
                    <h1 className="text-[15px] font-black text-slate-800">Activa tu cuenta</h1>
                    <p className="text-[10.5px] text-slate-500">
                        Plan asignado: <span className="font-bold text-violet-700">{planLabel}</span>
                    </p>
                </div>
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3">
                <div>
                    <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                        Email asignado
                    </label>
                    <input
                        type="email"
                        value={invite?.target_email ?? ""}
                        readOnly
                        className="input mt-1 bg-slate-50 text-slate-700 cursor-not-allowed"
                    />
                </div>

                <div>
                    <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                        Crea tu contraseña
                    </label>
                    <div className="relative">
                        <input
                            type={showPwd ? "text" : "password"}
                            value={pwd}
                            onChange={e => setPwd(e.target.value)}
                            minLength={8}
                            required
                            placeholder="Mínimo 8 caracteres"
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
                        Repite tu contraseña
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
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-[12px] text-rose-700">
                        {error}
                    </div>
                )}

                <button type="submit" disabled={submitting}
                        className="w-full h-12 rounded-xl bg-violet-600 text-white text-[14px] font-black
                                   shadow-sm shadow-violet-600/30 active:scale-95 transition
                                   disabled:opacity-50">
                    {submitting ? "Activando…" : "Activar mi cuenta y acceder"}
                </button>

                <p className="text-center text-[10.5px] text-slate-400">
                    Al activar aceptas los términos del plan {planLabel}.
                </p>
            </form>
        </CenterCard>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function CenterCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-dvh w-full bg-slate-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200/80
                            p-6 sm:p-8">
                {children}
            </div>
        </div>
    );
}
