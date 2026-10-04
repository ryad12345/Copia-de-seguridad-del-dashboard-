// =====================================================================
// MOZONA TPV — useSubscriptionCheck
// =====================================================================
// Hook que clasifica el estado de suscripción del tenant actual.
//
// Fases posibles:
//   - 'active'   → plan pagado vigente, acceso total
//   - 'trial'    → periodo de prueba, días restantes > 0, banner
//   - 'grace'    → trial caducado pero hace <=3 días, banner fuerte
//   - 'expired'  → trial caducado >3 días, BLOQUEO
//   - 'vip'      → cuenta vitalicia o email VIP, sin caducidad
//   - 'unknown'  → no hay tenant o no hay datos
// =====================================================================

import { useMemo } from "react";
import type { Tenant } from "../lib/supabase";
import { isVip } from "../lib/vip";

export type SubPhase = "active" | "trial" | "grace" | "expired" | "vip" | "unknown";

export interface SubInfo {
    phase:        SubPhase;
    /** Días restantes hasta el fin del trial (negativo si vencido) */
    daysLeft:     number;
    /** Fecha de fin del trial (null si no aplica) */
    trialEndsAt:  string | null;
    /** Razón legible del estado */
    reason:       string;
}

const DEFAULT_GRACE_DAYS = 3;
const DEFAULT_TRIAL_DAYS  = 7;

export function useSubscriptionCheck(
    tenant: Tenant | null | undefined,
    userEmail: string | null | undefined,
): SubInfo {
    return useMemo(() => {
        if (!tenant) {
            return { phase: "unknown", daysLeft: 0, trialEndsAt: null, reason: "Sin tenant activo" };
        }
        // VIP vitalicio: por email o por plan
        if (isVip(userEmail)) {
            return { phase: "vip", daysLeft: 99999, trialEndsAt: null, reason: "Cuenta VIP vitalicia" };
        }
        const plan = (tenant as any).plan as string | undefined;
        if (plan === "lifetime_vip") {
            return { phase: "vip", daysLeft: 99999, trialEndsAt: null, reason: "Plan lifetime_vip" };
        }
        // Estado explícito de cancelación
        const status = (tenant as any).subscription_status as string | undefined;
        if (status === "active") {
            return { phase: "active", daysLeft: 99999, trialEndsAt: null, reason: "Suscripción activa" };
        }
        // Trial
        const trialEndsAt = (tenant as any).trial_ends_at as string | null | undefined;
        if (trialEndsAt) {
            const end = new Date(trialEndsAt).getTime();
            const now = Date.now();
            const daysLeft = Math.ceil((end - now) / 86400000);
            if (daysLeft > 0) {
                return {
                    phase: "trial",
                    daysLeft,
                    trialEndsAt,
                    reason: `Trial: ${daysLeft} ${daysLeft === 1 ? "día" : "días"} restantes`,
                };
            }
            if (daysLeft > -DEFAULT_GRACE_DAYS) {
                return {
                    phase: "grace",
                    daysLeft,
                    trialEndsAt,
                    reason: `Trial caducado hace ${-daysLeft} ${-daysLeft === 1 ? "día" : "días"} (periodo de gracia)`,
                };
            }
            return {
                phase: "expired",
                daysLeft,
                trialEndsAt,
                reason: `Trial caducado hace ${-daysLeft} días`,
            };
        }
        // No hay trial_ends_at y status no es active
        return {
            phase: "expired",
            daysLeft: 0,
            trialEndsAt: null,
            reason: "Sin periodo de prueba activo",
        };
    }, [tenant, userEmail]);
}

/** Helper de URL para WhatsApp */
export function buildWhatsAppLink(phone: string, message: string): string {
    return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}`;
}

export const SUPPORT_PHONE_E164 = "34644165153";
export const DEFAULT_TRIAL_DAYS_CONST = DEFAULT_TRIAL_DAYS;
