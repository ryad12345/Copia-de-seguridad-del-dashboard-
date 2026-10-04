// =====================================================================
// MOZONA TPV — BillingSuccessPage (/billing/success)
// =====================================================================
// Página a la que Stripe redirige tras un Checkout exitoso.
// Muestra confirmación + CTA "Gestionar facturación" que abre
// el Stripe Customer Portal.
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { IconCheck, IconArrowRight, IconLogout, IconSparkles } from "../components/icons";
import { Logo } from "../components/Logo";

export function BillingSuccessPage() {
    const auth = useAuth();
    const [params] = useSearchParams();
    const sessionId = params.get("session_id");
    const [opening, setOpening] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        // Refrescar el tenant por si el webhook aún no llegó
        if (auth.refresh) void auth.refresh();
    }, [auth]);

    const openPortal = async () => {
        setOpening(true);
        setMsg(null);
        try {
            if (!isSupabaseConfigured) {
                setMsg("Modo demo: no hay portal de facturación real.");
                return;
            }
            const { data, error } = await supabase.functions.invoke("billing-portal", {
                body: { tenantId: auth.tenant?.id },
            });
            if (error) throw error;
            if (data?.url) {
                window.location.href = data.url;
                return;
            }
            setMsg("No se pudo abrir el portal de facturación.");
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setOpening(false);
        }
    };

    return (
        <div className="min-h-dvh bg-gradient-to-b from-emerald-50 to-white flex items-center justify-center p-5">
            <div className="max-w-md w-full">
                <Link to="/" className="inline-flex items-center gap-2 mb-6">
                    <Logo variant="mark" size="sm" />
                </Link>

                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-7 text-center">
                    <div className="
                        w-16 h-16 mx-auto mb-4 rounded-2xl
                        bg-emerald-100 text-emerald-600
                        flex items-center justify-center
                    ">
                        <IconCheck size={32} strokeWidth={2.4} />
                    </div>

                    <h1 className="text-[24px] font-black tracking-tight text-slate-900">
                        ¡Suscripción activa!
                    </h1>
                    <p className="mt-2 text-[13.5px] text-slate-600">
                        Tu plan <strong className="text-slate-900">{auth.tenant?.plan ?? "Plus"}</strong> ya está
                        activo.  Stripe confirmará el pago por email en breve.
                    </p>

                    {sessionId && (
                        <p className="mt-2 text-[10.5px] text-slate-400 font-mono">
                            ID: {sessionId.slice(0, 18)}…
                        </p>
                    )}

                    {msg && (
                        <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200/80
                                        text-[12px] text-rose-700">
                            {msg}
                        </div>
                    )}

                    <div className="mt-6 flex flex-col gap-2">
                        <Link to="/app"
                              className="h-12 rounded-2xl bg-slate-900 text-white font-bold text-[14px]
                                         flex items-center justify-center gap-2 active:scale-95 transition">
                            <IconSparkles size={16} strokeWidth={2.2} />
                            Empezar a usar MOZONA
                            <IconArrowRight size={16} strokeWidth={2.4} />
                        </Link>

                        <button onClick={openPortal} disabled={opening}
                                className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200
                                           text-[12.5px] font-bold text-slate-700
                                           flex items-center justify-center gap-1.5
                                           disabled:opacity-50 active:scale-95 transition">
                            <IconLogout size={14} strokeWidth={2.2} />
                            {opening ? "Abriendo…" : "Gestionar facturación"}
                        </button>
                    </div>

                    <p className="mt-5 text-[10.5px] text-slate-400">
                        Cancela o cambia tu plan cuando quieras desde el portal de Stripe.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default BillingSuccessPage;
