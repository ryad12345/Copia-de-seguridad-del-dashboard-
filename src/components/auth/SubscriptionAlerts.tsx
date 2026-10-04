// =====================================================================
// MOZONA TPV — SubscriptionAlerts
// =====================================================================
// Banner superior (Fase 1) y pantalla de bloqueo (Fase 2) según el
// estado de la suscripción del tenant actual.
//
// Fase 1 (gracia/aviso): falta <= 3 días para vencer o hasta 3 días vencido
//   - TPV sigue funcionando
//   - Banner no intrusivo arriba
//   - Botón a WhatsApp para renovar
//
// Fase 2 (suspensión): vencido fuera del periodo de gracia
//   - Bloquea la interacción del TPV
//   - Pantalla limpia con CTA a WhatsApp
//
// VIP vitalicio: nunca muestra nada.
// =====================================================================

import { useEffect, useState } from "react";
import { IconBell, IconShield } from "../icons";
import { VIP_EMAILS, isVip } from "../../lib/vip";

// ---------------------------------------------------------------------
// WhatsApp link
// ---------------------------------------------------------------------

const PHONE_E164 = "34644165153";
const WA_RENEW  = `https://wa.me/${PHONE_E164}?text=${encodeURIComponent("Hola, quiero renovar mi suscripción de Mozona TPV")}`;
const WA_REACT  = `https://wa.me/${PHONE_E164}?text=${encodeURIComponent("Hola, necesito reactivar mi suscripción de Mozona TPV")}`;

interface SubInfo {
    plan:                string;
    subscription_status: string;
    subscription_ends_at: string | null;
    user_email:          string | null;
}

// ---------------------------------------------------------------------
// Hook: clasifica el estado
// ---------------------------------------------------------------------

export type SubPhase = "ok" | "grace" | "blocked" | "vip";

export function useSubscriptionPhase(info: SubInfo | null): SubPhase {
    if (!info) return "ok";
    if (isVip(info.user_email)) return "vip";
    if (info.plan === "lifetime_vip") return "vip";
    if (info.subscription_status === "canceled" || info.subscription_status === "suspended") {
        return "blocked";
    }
    if (!info.subscription_ends_at) return "ok";
    const days = Math.ceil((new Date(info.subscription_ends_at).getTime() - Date.now()) / 86400000);
    if (days < -3) return "blocked";      // vencido fuera de gracia
    if (days <= 3) return "grace";        // por vencer o en gracia
    return "ok";
}

// ---------------------------------------------------------------------
// Banner (Fase 1)
// ---------------------------------------------------------------------

export function SubscriptionBanner({ info }: { info: SubInfo | null }) {
    const phase = useSubscriptionPhase(info);
    const [visible, setVisible] = useState(true);

    useEffect(() => { setVisible(true); }, [phase]);

    if (phase !== "grace" || !visible || !info) return null;
    const endsAt = info.subscription_ends_at ? new Date(info.subscription_ends_at) : null;
    const days = endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / 86400000) : 0;
    const dateStr = endsAt ? `${String(endsAt.getDate()).padStart(2, "0")}/${String(endsAt.getMonth() + 1).padStart(2, "0")}/${endsAt.getFullYear()}` : "—";
    const isVencido = days < 0;

    return (
        <div className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950
                        border-b-2 border-amber-600/40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <IconBell size={18} strokeWidth={2.2} />
                <div className="flex-1 min-w-[200px] text-[13px] font-bold">
                    {isVencido
                        ? `Tu suscripción venció el ${dateStr}. Estás en periodo de gracia.`
                        : `Tu suscripción vence el ${dateStr} (${days} ${days === 1 ? "día" : "días"}).`}
                    {" "}Renueva tu plan para evitar interrupciones.
                </div>
                <a href={WA_RENEW} target="_blank" rel="noopener noreferrer"
                   className="h-8 px-3 rounded-lg bg-amber-900 text-amber-50 text-[12px] font-black
                              flex items-center gap-1.5 active:scale-95 transition shadow-sm">
                    📱 Renovar por WhatsApp
                </a>
                <button onClick={() => setVisible(false)}
                        className="w-7 h-7 rounded-md text-amber-900/60 hover:text-amber-900
                                   hover:bg-amber-600/20 flex items-center justify-center transition"
                        aria-label="Cerrar aviso">
                    ✕
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Bloqueo (Fase 2)
// ---------------------------------------------------------------------

export function SubscriptionBlocked({ info }: { info: SubInfo | null }) {
    const phase = useSubscriptionPhase(info);
    if (phase !== "blocked") return null;
    const endsAt = info?.subscription_ends_at ? new Date(info.subscription_ends_at) : null;
    const dateStr = endsAt ? `${String(endsAt.getDate()).padStart(2, "0")}/${String(endsAt.getMonth() + 1).padStart(2, "0")}/${endsAt.getFullYear()}` : "—";

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/85 backdrop-blur-md
                        flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
                {/* Cabecera roja */}
                <div className="bg-gradient-to-br from-rose-500 to-rose-600 px-6 py-7 text-center text-white">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-white/15 backdrop-blur
                                    flex items-center justify-center mb-3">
                        <IconShield size={28} strokeWidth={1.8} />
                    </div>
                    <h2 className="text-[20px] font-black tracking-tight">Suscripción vencida</h2>
                    <p className="mt-1 text-[12.5px] text-rose-100">
                        El periodo de uso ha finalizado.
                    </p>
                </div>

                {/* Cuerpo */}
                <div className="p-6 space-y-4">
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                            Fecha de vencimiento
                        </div>
                        <div className="mt-1 text-[18px] font-black text-slate-800 tabular-nums">
                            {dateStr}
                        </div>
                    </div>

                    <p className="text-[13.5px] text-slate-600 leading-relaxed">
                        Tus datos e histórico siguen guardados de forma segura.
                        Para volver a usar el TPV, contacta con nosotros por WhatsApp
                        y reactivamos tu cuenta en cuestión de minutos.
                    </p>

                    <a href={WA_REACT} target="_blank" rel="noopener noreferrer"
                       className="block w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600
                                  text-white text-[14px] font-black flex items-center justify-center gap-2
                                  active:scale-95 transition shadow-lg shadow-emerald-500/30">
                        📱 Contactar por WhatsApp para reactivar
                    </a>

                    <div className="text-center text-[10.5px] text-slate-400">
                        MOZONA TPV · Soporte directo
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------

export const WA_LINKS = { renew: WA_RENEW, reactivate: WA_REACT };
export const PHONE_DISPLAY = "+34 644 16 51 53";

// Para tipos: re-exporta el array VIP para chequeos rápidos
export { VIP_EMAILS };
