import { OfflineBanner } from './components/OfflineBanner';
// =====================================================================
// MOZONA TPV — App root
// =====================================================================

import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// ★ Páginas ligeras (carga inmediata: landing, auth, pricing)
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";
// ★ v3.1.6: PricingPage import eliminado
//   La ruta /pricing ahora redirige a / (landing)
// ★ Páginas pesadas (lazy loading: TPV, settings, waiter)
const PosTerminalPro  = lazy(() => import("./pages/PosTerminalPro").then(m => ({ default: m.PosTerminalPro })));
const SettingsPage    = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const TenantSettingsPage = lazy(() => import("./pages/TenantSettingsPage").then(m => ({ default: m.TenantSettingsPage })));
const AIStudioPage    = lazy(() => import("./pages/AIStudioPage").then(m => ({ default: m.AIStudioPage })));
const RegisterPage    = lazy(() => import("./pages/RegisterPage").then(m => ({ default: m.RegisterPage })));
const BillingSuccessPage = lazy(() => import("./pages/BillingSuccessPage").then(m => ({ default: m.BillingSuccessPage })));
const BillingCancelPage  = lazy(() => import("./pages/BillingCancelPage").then(m => ({ default: m.BillingCancelPage })));
const WaiterLoginPage = lazy(() => import("./pages/WaiterLoginPage").then(m => ({ default: m.WaiterLoginPage })));
const WaiterPad       = lazy(() => import("./pages/WaiterPad").then(m => ({ default: m.WaiterPad })));
const AdminInvitesPage = lazy(() => import("./pages/AdminInvitesPage").then(m => ({ default: m.AdminInvitesPage })));
const SetupCajaPage   = lazy(() => import("./pages/SetupCajaPage").then(m => ({ default: m.SetupCajaPage })));
const InviteRedeemPage  = lazy(() => import("./pages/InviteRedeemPage").then(m => ({ default: m.InviteRedeemPage })));
const OnboardingWizardPage = lazy(() => import("./pages/OnboardingWizardPage").then(m => ({ default: m.OnboardingWizardPage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage").then(m => ({ default: m.ResetPasswordPage })));
const WaitingActivationPage = lazy(() => import("./pages/WaitingActivationPage").then(m => ({ default: m.WaitingActivationPage })));
const WelcomePage = lazy(() => import("./pages/WelcomePage").then(m => ({ default: m.WelcomePage })));
const AdminApprovePage = lazy(() => import("./pages/AdminApprovePage").then(m => ({ default: m.AdminApprovePage })));
const HealthPage = lazy(() => import("./pages/HealthPage").then(m => ({ default: m.HealthPage })));
const AdminPanelPage = lazy(() => import("./pages/AdminPanelPage").then(m => ({ default: m.AdminPanelPage })));

// ★ Página de cierre de caja (nueva, lazy)
const CashRegisterPage = lazy(() => import("./pages/CashRegisterPage").then(m => ({ default: m.CashRegisterPage })));

import { WebSocketProvider } from "./context/WebSocketContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DesktopGuard } from "./components/DesktopGuard";
import { SubscriptionGuard } from "./components/ProtectedRoute";
import { ChatPro } from "./components/ChatPro";
import { RouteAwareChatPro } from "./components/RouteAwareChatPro";
import { PrintStyles } from "./components/settings/PrintStyles";

// ★ Spinner reutilizable para Suspense
function PageLoader({ label = "Cargando…" }: { label?: string }) {
    return (
        <div className="min-h-dvh w-full flex items-center justify-center bg-slate-50">
            <div className="text-center">
                <div className="w-10 h-10 mx-auto mb-3 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <div className="text-[12px] text-slate-500">{label}</div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: (error: Error, reset: () => void) => ReactNode;
}
interface ErrorBoundaryState {
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };
    private _autoReloadTimer: ReturnType<typeof setTimeout> | null = null;

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        if (typeof console !== "undefined") {
            console.error("[ErrorBoundary]", error, info);
        }
        // ★ v4.0.7-no-loop-fix: Auto-recovery después de 5s.
        //   En lugar de atrapar al usuario en una pantalla de error,
        //   recargamos automáticamente para que la app se rehidrate.
        try {
            if (this._autoReloadTimer) clearTimeout(this._autoReloadTimer);
            this._autoReloadTimer = setTimeout(() => {
                try { window.location.reload(); } catch (_) {}
            }, 5000);
        } catch (_) {}
    }

    componentWillUnmount() {
        if (this._autoReloadTimer) clearTimeout(this._autoReloadTimer);
    }

    reset = () => {
        if (this._autoReloadTimer) {
            clearTimeout(this._autoReloadTimer);
            this._autoReloadTimer = null;
        }
        this.setState({ error: null });
    };

    render() {
        if (this.state.error) {
            if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
            // ★ v4.0.7-no-loop-fix: ErrorBoundary FULLSCREEN REAL.
            //   - fixed inset-0 z-[99999] para cubrir TODA la UI
            //   - backdrop sólido sin dejar ver la app detrás
            //   - Auto-recovery a 5s sin atrapar al usuario
            return (
                <div
                    className="fixed inset-0 z-[99999] flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4"
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
                    role="alertdialog"
                    aria-modal="true"
                >
                    <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center text-4xl">
                            ⚠️
                        </div>
                        <h1 className="text-[22px] font-black text-slate-900 mb-2">
                            Re-conectando…
                        </h1>
                        <p className="text-[14px] text-slate-600 mb-6 leading-relaxed">
                            Estamos recargando la aplicación automáticamente en 5 segundos.
                            Si no, pulsa el botón.
                        </p>
                        <div className="w-10 h-10 mx-auto mb-4 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                        <button
                            type="button"
                            onClick={() => { this.reset(); window.location.reload(); }}
                            className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white font-black text-[14px] shadow-lg transition"
                        >
                            Reintentar ahora
                        </button>
                        <p className="text-[11.5px] text-slate-400 mt-4">
                            Si el problema continua, contacta con soporte.<br/>
                            <span className="text-slate-500">WhatsApp +34 644 16 51 53</span>
                        </p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// ---------------------------------------------------------------------
// ProtectedRoute: redirige a /auth si no hay user
// ---------------------------------------------------------------------

function ProtectedRoute({ children }: { children: ReactNode }) {
    const auth = useAuth();
    if (auth.loading) {
        return (
            <div className="min-h-dvh w-full flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="w-10 h-10 mx-auto mb-3 border-[3px] border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                    <div className="text-[12px] text-slate-500">Cargando…</div>
                </div>
            </div>
        );
    }
    if (!auth.user) {
        return <Navigate to="/auth" replace />;
    }
    return <>{children}</>;
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------

export function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <ThemeProvider>
                <WebSocketProvider>
                    {/* ★ v4.0.7-print-dynamic: CSS @media print con ancho DINÁMICO (48/58/80mm) */}
                    <PrintStyles />
                    {/* ★ v4.0.8-defender: Banner visible si Supabase está caído */}
                    <OfflineBanner />
                    <BrowserRouter>
                        <Suspense fallback={<PageLoader />}>
                            <Routes>
                                {/* Públicas */}
                                <Route path="/"        element={<LandingPage />} />
                                {/* ★ v3.1.6: /pricing ELIMINADO — redirige a / */}
                                <Route path="/pricing" element={<Navigate to="/" replace />} />
                                <Route path="/auth"    element={<AuthPage />} />
                                <Route path="/reset-password" element={<Suspense fallback={<PageLoader label="Cargando…" />}><ResetPasswordPage /></Suspense>} />
                                <Route path="/register" element={<Suspense fallback={<PageLoader label="Registrando…" />}><RegisterPage /></Suspense>} />
                                <Route path="/billing/success" element={<Suspense fallback={<PageLoader />}><BillingSuccessPage /></Suspense>} />
                                <Route path="/billing/cancel"  element={<Suspense fallback={<PageLoader />}><BillingCancelPage /></Suspense>} />
                                <Route path="/waiter/login"    element={<Suspense fallback={<PageLoader />}><WaiterLoginPage /></Suspense>} />
                                <Route path="/setup-caja"      element={<Suspense fallback={<PageLoader />}><SetupCajaPage /></Suspense>} />
                                <Route path="/admin/invites"   element={<Suspense fallback={<PageLoader />}><AdminInvitesPage /></Suspense>} />
                                {/* ★ v3.0.0: /welcome (sala de espera profesional)
                                    SIN ProtectedRoute, funciona con o sin sesion */}
                                <Route path="/welcome" element={<Suspense fallback={<PageLoader label="Cargando…" />}><WelcomePage /></Suspense>} />
                                {/* ★ v1.9.87: /waiting-activation (alias legacy)
                                    SIN ProtectedRoute, funciona con o sin sesion */}
                                <Route path="/waiting-activation" element={<Suspense fallback={<PageLoader label="Cargando…" />}><WaitingActivationPage /></Suspense>} />
                                {/* ★ v4.5.17: /admin/approve — acceso SOLO con sesión de superadmin.
                                    ELIMINADO token ?token=mozona-approve-2025 (H-05). */}
                                <Route path="/admin/approve" element={<Suspense fallback={<PageLoader label="Cargando…" />}><AdminApprovePage /></Suspense>} />
                                {/* ★ v3.1.4: /admin (panel de control completo)
                                    Acceso automatico cuando rofixinsta@gmail.com hace login */}
                                <Route path="/admin" element={<Suspense fallback={<PageLoader label="Cargando panel…" />}><AdminPanelPage /></Suspense>} />
                                {/* ★ v3.0.4: /health (estado del sistema) */}
                                <Route path="/health" element={<Suspense fallback={<PageLoader label="Verificando…" />}><HealthPage /></Suspense>} />

                                {/* ★ Canje de invitación y onboarding inicial */}
                                <Route path="/invite/:token"   element={<Suspense fallback={<PageLoader label="Cargando invitación…" />}><InviteRedeemPage /></Suspense>} />
                                <Route path="/setup/onboarding" element={<ProtectedRoute><Suspense fallback={<PageLoader label="Preparando tu TPV…" />}><OnboardingWizardPage /></Suspense></ProtectedRoute>} />

                                {/* TPV Admin — solo desktop/tablet */}
                                <Route path="/app"      element={<ProtectedRoute><SubscriptionGuard><DesktopGuard><Suspense fallback={<PageLoader label="Iniciando TPV…" />}><PosTerminalPro /></Suspense></DesktopGuard></SubscriptionGuard></ProtectedRoute>} />
                                <Route path="/settings" element={<ProtectedRoute><SubscriptionGuard><DesktopGuard><Suspense fallback={<PageLoader label="Cargando ajustes…" />}><SettingsPage /></Suspense></DesktopGuard></SubscriptionGuard></ProtectedRoute>} />
                                {/* ★ v3.4.0: Configuración personalizable por tenant (tema, ticket) */}
                                <Route path="/tenant-settings" element={<ProtectedRoute><Suspense fallback={<PageLoader label="Cargando personalización…" />}><TenantSettingsPage /></Suspense></ProtectedRoute>} />
                                {/* ★ v3.5.0: AI Studio (IA 100% local) */}
                                <Route path="/ai-studio" element={<ProtectedRoute><Suspense fallback={<PageLoader label="Cargando AI Studio…" />}><AIStudioPage /></Suspense></ProtectedRoute>} />

                                {/* Cierre de caja (arqueo / turnos) */}
                                <Route path="/cash-register" element={<ProtectedRoute><SubscriptionGuard><DesktopGuard><Suspense fallback={<PageLoader label="Cierre de caja…" />}><CashRegisterPage /></Suspense></DesktopGuard></SubscriptionGuard></ProtectedRoute>} />

                                {/* Camarero — solo móvil */}
                                <Route path="/waiter"   element={<ProtectedRoute><Suspense fallback={<PageLoader label="Cargando comandero…" />}><WaiterPad /></Suspense></ProtectedRoute>} />

                                <Route path="*"        element={<Navigate to="/" replace />} />
                            </Routes>
                        </Suspense>
                    {/* ★ v4.0.7-no-chat-outside-tpv: ChatPro SOLO en /app (TPV activo).
                         Fuera del TPV (landing, auth, onboarding, etc.) está oculto. */}
                    <RouteAwareChatPro />
                    </BrowserRouter>
                </WebSocketProvider>
                </ThemeProvider>
            </AuthProvider>
        </ErrorBoundary>
    );
}

export default App;
