// =====================================================================
// MOZONA TPV — PaywallModal (v3.5.0)
// =====================================================================
// Modal "Paywall Visual de Lujo" con glassmorphism estilo macOS/Vercel.
// Para features Pro bloqueadas, el dueño ve un modal atractivo.
// VIPs pasan automáticamente (whitelist backend).
// =====================================================================

import { useEffect } from "react";

export type PlanFeature = {
    id: string;
    title: string;
    description: string;
    icon: string;
    plan: "basic" | "pro" | "enterprise";
};

interface PaywallModalProps {
    open: boolean;
    onClose: () => void;
    feature: PlanFeature | null;
    onUpgrade?: () => void;
}

const PLAN_HIERARCHY = {
    basic: { name: "Basic", color: "#94a3b8" },
    pro: { name: "Pro", color: "#8b5cf6" },
    enterprise: { name: "VIP", color: "#f59e0b" },
};

export function PaywallModal({ open, onClose, feature, onUpgrade }: PaywallModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open || !feature) return null;

    const planInfo = PLAN_HIERARCHY[feature.plan];

    return (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
            style={{
                background: "rgba(15, 23, 42, 0.7)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
            }}
            onClick={onClose}
        >
            <div
                className="relative max-w-md w-full rounded-3xl overflow-hidden"
                style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                    backdropFilter: "blur(40px)",
                    WebkitBackdropFilter: "blur(40px)",
                    boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.5)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Brillo superior */}
                <div
                    className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full"
                    style={{
                        background: `radial-gradient(circle, ${planInfo.color}80 0%, transparent 70%)`,
                        filter: "blur(40px)",
                    }}
                />

                {/* Contenido */}
                <div className="relative p-7">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
                    >
                        ✕
                    </button>

                    <div
                        className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-4"
                        style={{
                            background: `linear-gradient(135deg, ${planInfo.color}30 0%, ${planInfo.color}10 100%)`,
                            border: `1px solid ${planInfo.color}40`,
                        }}
                    >
                        {feature.icon}
                    </div>

                    <div
                        className="text-center text-[10px] font-black uppercase tracking-widest mb-2 inline-block px-3 py-1 rounded-full"
                        style={{
                            color: planInfo.color,
                            background: `${planInfo.color}15`,
                        }}
                    >
                        {planInfo.name}
                    </div>

                    <h2 className="text-[24px] font-black text-slate-900 text-center mb-2">
                        {feature.title}
                    </h2>
                    <p className="text-[13.5px] text-slate-600 text-center leading-relaxed mb-6">
                        {feature.description}
                    </p>

                    <div
                        className="rounded-2xl p-4 mb-5"
                        style={{
                            background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(245,158,11,0.08))",
                            border: "1px solid rgba(139,92,246,0.15)",
                        }}
                    >
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                            Lo que obtienes con {planInfo.name}
                        </div>
                        <ul className="space-y-1.5 text-[12.5px] text-slate-700">
                            <li className="flex gap-2"><span className="text-emerald-500">✓</span> Sin límites de uso</li>
                            <li className="flex gap-2"><span className="text-emerald-500">✓</span> Soporte prioritario 24/7</li>
                            <li className="flex gap-2"><span className="text-emerald-500">✓</span> Actualizaciones inmediatas</li>
                            <li className="flex gap-2"><span className="text-emerald-500">✓</span> IA local privada (sin APIs externas)</li>
                        </ul>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-bold"
                        >
                            Quizás luego
                        </button>
                        <button
                            onClick={onUpgrade}
                            className="flex-1 h-11 rounded-xl text-white text-[12.5px] font-black"
                            style={{
                                background: `linear-gradient(135deg, ${planInfo.color} 0%, ${planInfo.color}cc 100%)`,
                                boxShadow: `0 8px 24px ${planInfo.color}50`,
                            }}
                        >
                            🚀 Mejorar a {planInfo.name}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ★ Catálogo de features (para usar en distintos lugares)
export const PLAN_FEATURES: PlanFeature[] = [
    {
        id: "ai-invoice",
        title: "Escáner de Facturas con IA",
        description: "Fotografía una factura de proveedor y la IA local extrae productos, cantidades y precios automáticamente. Cero datos enviados a la nube.",
        icon: "📸",
        plan: "pro",
    },
    {
        id: "ai-voice",
        title: "Comandas por Voz",
        description: "Tus camareros hablan, Whisper local transcribe, Llama estructura los items. Manos libres en hora punta.",
        icon: "🎙️",
        plan: "pro",
    },
    {
        id: "ai-supplier",
        title: "Barista Fantasma",
        description: "Auto-detecta qué falta y te prepara pedidos a proveedores por WhatsApp con un clic.",
        icon: "🌌",
        plan: "pro",
    },
    {
        id: "ai-profit",
        title: "Socio Oculto",
        description: "Análisis de rentabilidad plato a plato. Te dice cuándo subir precios y qué proveedor renegociar.",
        icon: "👥",
        plan: "pro",
    },
    {
        id: "ai-pricing",
        title: "Anti-mermas Predictivo",
        description: "Predice qué se va a desperdiciar y genera alertas automáticas antes de que ocurra.",
        icon: "📈",
        plan: "pro",
    },
    {
        id: "stress-mode",
        title: "Hora Punta Ciega",
        description: "Interfaz dinámica que se adapta automáticamente cuando hay muchas comandas. Botones gigantes, sin distracciones.",
        icon: "🎭",
        plan: "basic",
    },
];

export function usePaywall() {
    // Helper: detectar si un feature está bloqueado para el plan actual
    return {
        isLocked: (featureId: string, userIsVip: boolean, planName: string): PlanFeature | null => {
            if (userIsVip) return null;  // VIP ve todo
            const feat = PLAN_FEATURES.find(f => f.id === featureId);
            if (!feat) return null;
            const isPro = planName === "pro" || planName === "enterprise" || planName === "vip" || planName === "lifetime";
            if (feat.plan === "basic") return null;  // siempre desbloqueado
            if (feat.plan === "pro" && isPro) return null;
            return feat;
        },
    };
}
