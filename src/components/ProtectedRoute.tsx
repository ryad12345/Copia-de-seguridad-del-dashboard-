// =====================================================================
// MOZONA TPV — Route guards
// =====================================================================
// Tres componentes que envuelven a las rutas:
//   • <ProtectedRoute>          — exige sesión activa
//   • <AdminRoute>              — exige email == SuperAdmin
//   • <SubscriptionGuard>       — exige tenant con suscripción activa
//                                 (salta si es VIP, SuperAdmin, o si el
//                                 modo demo está activo)
// =====================================================================

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isVipOrAdmin } from "../lib/vip";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------
// Shared: spinner mientras se carga la sesión
// ---------------------------------------------------------------------

function LoadingScreen({ message = "Cargando…" }: { message?: string }) {
    return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-50">
            <div className="text-center">
                <div className="inline-block w-10 h-10 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin mb-3" />
                <div className="text-[12.5px] text-slate-500">{message}</div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// ProtectedRoute
// ---------------------------------------------------------------------

export function ProtectedRoute({ children }: { children: ReactNode }) {
    const auth = useAuth();
    const location = useLocation();

    if (!auth.isReady || auth.status === "loading") return <LoadingScreen />;
    if (auth.status === "disabled") {
        // Modo sin Supabase: permite todo (modo demo / local)
        return <>{children}</>;
    }
    if (!auth.user) {
        return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
    }
    return <>{children}</>;
}

// ---------------------------------------------------------------------
// AdminRoute
// ---------------------------------------------------------------------

export function AdminRoute({ children }: { children: ReactNode }) {
    const auth = useAuth();
    if (!auth.isReady) return <LoadingScreen />;
    if (!auth.isSuperAdmin) {
        return <Navigate to="/app" replace />;
    }
    return <>{children}</>;
}

// ---------------------------------------------------------------------
// VipGuard: solo permite el paso a emails VIP (ni siquiera SuperAdmin)
// ---------------------------------------------------------------------

export function VipGuard({ children }: { children: ReactNode }) {
    const auth = useAuth();
    if (!auth.isReady) return <LoadingScreen />;
    if (!auth.user) return <Navigate to="/auth" replace />;
    if (!isVipOrAdmin(auth.user.email)) {
        return <Navigate to="/app" replace />;
    }
    return <>{children}</>;
}

// ---------------------------------------------------------------------
// SubscriptionGuard
// ---------------------------------------------------------------------

export function SubscriptionGuard({ children }: { children: ReactNode }) {
    const auth = useAuth();
    const location = useLocation();
    if (!auth.isReady) return <LoadingScreen />;
    if (auth.status === "disabled") return <>{children}</>;
    if (!auth.user) return <Navigate to="/auth" state={{ from: location.pathname }} replace />;

    // ★ VIP / SuperAdmin → bypass TOTAL
    //    Estos emails NUNCA son redirigidos a /pricing bajo ninguna
    //    circunstancia, tengan o no tengan tenant en la BD.
    if (isVipOrAdmin(auth.user.email) || auth.isSuperAdmin) {
        return <>{children}</>;
    }

    // Sin tenant → /welcome (sala de espera)
    // ★ v3.1.6: Ya NO mandamos a /pricing. El usuario sin tenant va
    //    a la sala de espera donde el admin puede aprobarlo.
    if (!auth.tenant) {
        if (location.pathname !== "/welcome" && !location.pathname.startsWith("/welcome")) {
            return <Navigate to="/welcome" state={{ from: location.pathname }} replace />;
        }
        return <>{children}</>;
    }
    // ★ v1.9.75: Suscripción pending_activation → sala de espera
    //    (24h de cortesía + aprobación del SuperAdmin)
    const status = auth.tenant.subscription_status;
    if (status === "pending_activation") {
        if (location.pathname !== "/welcome" && !location.pathname.startsWith("/welcome")) {
            return <Navigate to="/welcome" state={{ from: location.pathname }} replace />;
        }
        return <>{children}</>;
    }
    // Suscripción inactiva → sala de espera
    if (status !== "active" && status !== "trialing") {
        if (location.pathname !== "/welcome" && !location.pathname.startsWith("/welcome")) {
            return <Navigate to="/welcome" state={{ from: location.pathname }} replace />;
        }
        return <>{children}</>;
    }
    // Onboarding incompleto → wizard (salvo si ya estamos en él)
    if (auth.tenant.onboarding_completed === false
        && !location.pathname.startsWith("/setup/onboarding")) {
        return <Navigate to="/setup/onboarding" state={{ from: location.pathname }} replace />;
    }
    return <>{children}</>;
}
