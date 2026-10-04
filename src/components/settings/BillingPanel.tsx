// =====================================================================
// MOZONA TPV — BillingPanel (Suscripción / Stripe Customer Portal)
// =====================================================================
// Muestra el plan actual del tenant + estado de suscripción + botones
// para abrir el portal de facturación de Stripe (cambiar tarjeta,
// cancelar, descargar facturas).
// =====================================================================

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { Card } from "./FormControls";
import { IconLogout, IconRefresh, IconAlert, IconCheck, IconArrowRight } from "../icons";

const PLAN_LABELS: Record<string, { name: string; price: string; color: string }> = {
    free:        { name: "Free",        price: "0 €",  color: "bg-slate-100 text-slate-700" },
    plus_30:     { name: "Plus",        price: "30 €", color: "bg-blue-100 text-blue-700" },
    pro_50:      { name: "Pro",         price: "50 €", color: "bg-violet-100 text-violet-700" },
    lifetime_vip:{ name: "Lifetime VIP",price: "—",    color: "bg-amber-100 text-amber-700" },
};

const STATUS_TONES: Record<string, { bg: string; text: string; label: string }> = {
    active:    { bg: "bg-emerald-50 border-emerald-200",  text: "text-emerald-700", label: "Activa" },
    trialing:  { bg: "bg-blue-50 border-blue-200",        text: "text-blue-700",    label: "En prueba" },
    past_due:  { bg: "bg-rose-50 border-rose-200",        text: "text-rose-700",    label: "Pago pendiente" },
    canceled:  { bg: "bg-slate-50 border-slate-200",      text: "text-slate-700",   label: "Cancelada" },
    incomplete:{ bg: "bg-amber-50 border-amber-200",      text: "text-amber-700",   label: "Incompleta" },
    expired:   { bg: "bg-rose-50 border-rose-200",        text: "text-rose-700",    label: "Expirada" },
    paused:    { bg: "bg-slate-50 border-slate-200",      text: "text-slate-700",   label: "Pausada" },
};

export function BillingPanel() {
    const auth = useAuth();
    const [opening, setOpening] = useState(false);
    const [msg, setMsg]         = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const planKey = (auth.tenant?.plan ?? "free").toString();
    const plan    = PLAN_LABELS[planKey] ?? PLAN_LABELS.free;
    const status  = STATUS_TONES[auth.tenant?.subscription_status ?? ""] ?? null;

    const openPortal = async () => {
        setOpening(true);
        setMsg(null);
        try {
            if (!isSupabaseConfigured) {
                setMsg({ kind: "err", text: "Supabase no configurado." });
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
            setMsg({ kind: "err", text: "No se pudo abrir el portal de facturación." });
        } catch (e) {
            setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
        } finally {
            setOpening(false);
        }
    };

    const refreshSub = async () => {
        if (auth.refresh) await auth.refresh();
        setMsg({ kind: "ok", text: "Estado actualizado." });
        setTimeout(() => setMsg(null), 2500);
    };

    return (
        <Card
            icon={<span className="text-[15px]">💳</span>}
            title="Plan y facturación"
            subtitle="Gestiona tu suscripción a MOZONA TPV."
        >
            <div className="space-y-3">
                {/* Estado actual */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div>
                        <div className="text-[10.5px] uppercase tracking-wide font-bold text-slate-500">
                            Plan actual
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                            <span className={`inline-flex px-2 h-6 items-center rounded-full text-[12px] font-black ${plan.color}`}>
                                {plan.name}
                            </span>
                            {status && (
                                <span className={`inline-flex px-2 h-6 items-center rounded-full text-[11px] font-bold border ${status.bg} ${status.text}`}>
                                    {status.label}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[18px] font-black tabular-nums text-slate-900">
                            {plan.price}
                        </div>
                        <div className="text-[10.5px] text-slate-500">/mes</div>
                    </div>
                </div>

                {msg && (
                    <div className={`p-3 rounded-xl border text-[12.5px] flex items-start gap-2
                                    ${msg.kind === "ok"
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                        : "bg-rose-50 border-rose-200 text-rose-700"}`}>
                        {msg.kind === "ok" ? (
                            <IconCheck size={14} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                        ) : (
                            <IconAlert size={14} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                        )}
                        <span>{msg.text}</span>
                    </div>
                )}

                {/* Acciones */}
                <div className="grid grid-cols-2 gap-2">
                    <button onClick={openPortal} disabled={opening || planKey === "free"}
                            className="h-11 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white
                                       text-[12.5px] font-bold flex items-center justify-center gap-1.5
                                       disabled:opacity-50 active:scale-95 transition">
                        <IconLogout size={14} strokeWidth={2.2} />
                        {opening ? "Abriendo…" : "Portal Stripe"}
                    </button>
                    <Link to="/welcome"
                          className="h-11 px-3 rounded-xl bg-slate-100 hover:bg-slate-200
                                     text-[12.5px] font-bold text-slate-700
                                     flex items-center justify-center gap-1.5 active:scale-95 transition">
                        Cambiar plan
                        <IconArrowRight size={14} strokeWidth={2.2} />
                    </Link>
                </div>

                <button onClick={refreshSub}
                        className="w-full h-9 rounded-lg text-[11.5px] text-slate-500 hover:text-slate-700
                                   hover:bg-slate-50 flex items-center justify-center gap-1.5 transition">
                    <IconRefresh size={12} strokeWidth={2} />
                    Sincronizar con Stripe
                </button>

                {planKey === "free" && (
                    <p className="text-[10.5px] text-slate-400 text-center mt-1">
                        Aún no tienes un plan de pago.  <Link to="/welcome" className="underline">Ver planes</Link>
                    </p>
                )}
            </div>
        </Card>
    );
}

export default BillingPanel;
