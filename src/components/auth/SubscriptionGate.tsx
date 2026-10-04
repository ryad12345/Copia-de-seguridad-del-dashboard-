// =====================================================================
// MOZONA TPV — SubscriptionGate
// =====================================================================
// Banner superior (trial/grace) y pantalla de bloqueo (expired).
//
// Trial:    banner azul, no intrusivo
// Grace:    banner ámbar, fuerte, con CTA
// Expired:  overlay fullscreen con WhatsApp CTA
// =====================================================================

import { useEffect, useState } from "react";
import { IconShield, IconBell } from "../icons";
import {
    useSubscriptionCheck,
    buildWhatsAppLink,
    SUPPORT_PHONE_E164,
} from "../../hooks/useSubscriptionCheck";
import type { Tenant } from "../../lib/supabase";
import { AIAssistantModal } from "../assistant/AIAssistantModal";

// ---------------------------------------------------------------------
// WhatsApp messages
// ---------------------------------------------------------------------

function buildWhatsAppMessage(tenantName: string | null | undefined, phase: string): string {
    const safeName = (tenantName ?? "mi restaurante").replace(/[^\w\sÀ-ÿ]/g, "").trim();
    if (phase === "grace") {
        return `Hola, ha caducado el periodo de prueba de ${safeName} y quiero renovarlo.`;
    }
    return `Hola, ha caducado el periodo de prueba de mi restaurante (${safeName}) y quiero activar mi suscripción de MOZONA TPV.`;
}

// ---------------------------------------------------------------------
// Banner (trial + grace)
// ---------------------------------------------------------------------

export function SubscriptionBanner({
    tenant,
    userEmail,
}: { tenant: Tenant | null | undefined; userEmail: string | null | undefined }) {
    const sub = useSubscriptionCheck(tenant, userEmail);
    const [visible, setVisible] = useState(true);

    useEffect(() => { setVisible(true); }, [sub.phase]);

    if (sub.phase !== "trial" && sub.phase !== "grace") return null;
    if (!visible) return null;

    const endsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const dateStr = endsAt
        ? `${String(endsAt.getDate()).padStart(2, "0")}/${String(endsAt.getMonth() + 1).padStart(2, "0")}/${endsAt.getFullYear()}`
        : "—";
    const isGrace = sub.phase === "grace";

    const waMessage = buildWhatsAppMessage((tenant as any)?.name, sub.phase);
    const waLink = buildWhatsAppLink(SUPPORT_PHONE_E164, waMessage);

    return (
        <div className={
            "w-full text-slate-950 border-b-2 shadow-sm " +
            (isGrace
                ? "bg-gradient-to-r from-rose-400 to-rose-500 border-rose-600/40"
                : "bg-gradient-to-r from-blue-400 to-blue-500 border-blue-600/40")
        }>
            <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
                {isGrace
                    ? <IconShield size={18} strokeWidth={2.2} />
                    : <IconBell   size={18} strokeWidth={2.2} />}
                <div className="flex-1 min-w-[200px] text-[13px] font-bold">
                    {isGrace
                        ? `Tu prueba gratuita caducó el ${dateStr}. Tienes ${-sub.daysLeft} ${-sub.daysLeft === 1 ? "día" : "días"} de gracia. Activa tu plan para evitar el bloqueo.`
                        : `Te quedan ${sub.daysLeft} ${sub.daysLeft === 1 ? "día" : "días"} de prueba gratuita (hasta el ${dateStr}).`}
                </div>
                <a href={waLink} target="_blank" rel="noopener noreferrer"
                   className={"h-8 px-3 rounded-lg text-[12px] font-black flex items-center gap-1.5 active:scale-95 transition shadow-sm " +
                              (isGrace
                                  ? "bg-rose-900 text-rose-50"
                                  : "bg-blue-900 text-blue-50")}>
                    📱 Activar plan por WhatsApp
                </a>
                <button onClick={() => setVisible(false)}
                        className={"w-7 h-7 rounded-md flex items-center justify-center transition " +
                                   (isGrace
                                       ? "text-rose-900/60 hover:text-rose-900 hover:bg-rose-600/20"
                                       : "text-blue-900/60 hover:text-blue-900 hover:bg-blue-600/20")}
                        aria-label="Cerrar aviso">
                    ✕
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Bloqueo (expired)
// ---------------------------------------------------------------------

export function SubscriptionPaywall({
    tenant,
    userEmail,
}: { tenant: Tenant | null | undefined; userEmail: string | null | undefined }) {
    const sub = useSubscriptionCheck(tenant, userEmail);
    if (sub.phase !== "expired") return null;

    const waMessage = buildWhatsAppMessage((tenant as any)?.name, "expired");
    const waLink = buildWhatsAppLink(SUPPORT_PHONE_E164, waMessage);

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md
                        flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
                {/* Cabecera roja */}
                <div className="bg-gradient-to-br from-rose-500 to-rose-600 px-6 py-7 text-center text-white">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-white/15 backdrop-blur
                                    flex items-center justify-center mb-3">
                        <IconShield size={28} strokeWidth={1.8} />
                    </div>
                    <h2 className="text-[20px] font-black tracking-tight">
                        Tu periodo de prueba ha finalizado
                    </h2>
                    <p className="mt-1 text-[12.5px] text-rose-100">
                        El acceso al TPV está temporalmente bloqueado.
                    </p>
                </div>

                {/* Cuerpo */}
                <div className="p-6 space-y-4">
                    <p className="text-[13.5px] text-slate-600 leading-relaxed">
                        Para continuar utilizando el TPV y gestionar tus ventas, activa tu
                        plan poniéndote en contacto con nuestro equipo de soporte.
                        Tus datos e histórico siguen guardados de forma segura.
                    </p>

                    <a href={waLink} target="_blank" rel="noopener noreferrer"
                       className="block w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600
                                  text-white text-[14px] font-black flex items-center justify-center gap-2
                                  active:scale-95 transition shadow-lg shadow-emerald-500/30">
                        📱 Contactar por WhatsApp para activar
                    </a>

                    {/* ★ v1.9.34: botón al asistente IA para captura in-app */}
                    <PaywallAssistantButton
                        tenant={tenant}
                        userEmail={userEmail}
                    />

                    <div className="text-center text-[10.5px] text-slate-400">
                        MOZONA TPV · +34 644 16 51 53 · Soporte directo
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ★ v1.9.34: botón que abre el AIAssistantModal desde el paywall */
function PaywallAssistantButton({
    tenant, userEmail,
}: { tenant: Tenant | null | undefined; userEmail: string | null | undefined }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                    className="block w-full h-10 rounded-xl bg-violet-50
                               border border-violet-200/80 text-violet-700
                               text-[12.5px] font-bold
                               hover:bg-violet-100 active:scale-95 transition">
                🤖 Hablar con el asistente IA
            </button>
            <AIAssistantModal
                open={open}
                onClose={() => setOpen(false)}
                source="paywall"
                ctxEmail={userEmail ?? undefined}
                ctxName={(tenant as any)?.name}
            />
        </>
    );
}
