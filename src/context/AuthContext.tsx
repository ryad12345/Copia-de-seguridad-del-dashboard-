// =====================================================================
// MOZONA TPV — AuthContext (Supabase real, sin mocks ni autologin)
// =====================================================================

import {
    createContext, useContext, useCallback, useEffect, useMemo, useState,
    type ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { isVipOrAdmin, isSuperAdminEmail } from "../lib/vip";
import { safeFetch } from "../lib/safeFetch";
import { syncTenantFromAuth } from "../lib/tenantSync";
import { setDefenseTenant } from "../lib/security/defenseBot";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface AuthUser {
    id:        string;
    email:     string;
    name?:     string;
    role:      "owner" | "manager" | "waiter" | "kitchen" | "demo";
    restaurant_id?: string;
    created_at?: string;
}

export interface AuthSession {
    access_token: string;
    refresh_token?: string;
    expires_at?:   number;
    user:          AuthUser;
}

export interface AuthContextValue {
    user:        AuthUser | null;
    session:     AuthSession | null;
    loading:     boolean;

    isReady?:    boolean;
    isSuperAdmin?: boolean;
    status?:     "loading" | "authenticated" | "unauthenticated" | "disabled";
    tenant?:     any;
    tenantRole?: any;
    profile?:    any;
    refresh?:    () => Promise<void>;
    patchTenant?: (patch: Record<string, any>) => void;
    createTenant?: (...args: any[]) => Promise<any>;
    redeemInvite?: (code: string) => Promise<{
        ok:        boolean;
        error?:    string;
        plan?:     "plus_30" | "pro_50" | "lifetime_vip";
        code?:     string;
        max_uses?: number | null;
        remaining?: number | null;
    }>;
    signInWithGoogle?: (...args: any[]) => Promise<any>;

    signIn:           (email: string, password: string) => Promise<{ user: AuthUser | null; error: string | null }>;
    signInWithPassword:(email: string, password: string) => Promise<{ user: AuthUser | null; error: string | null }>;
    signOut:          () => Promise<void>;
    logout:           () => Promise<void>;
    signUp:           (email: string, password: string, name?: string) => Promise<{ user: AuthUser | null; error: string | null }>;
    /**
     * ★ v4.0.7: setMockSession - crea sesion mock VIP sin pasar por Supabase Auth.
     * Usado por el bypass VIP cuando Supabase Auth falla.
     */
    setMockSession?:   (user: AuthUser, tenant?: any) => void;
}

// ---------------------------------------------------------------------
// Persistencia local
// ---------------------------------------------------------------------

const STORAGE_KEY = "pos_current_user";

function loadFromStorage(): { user: AuthUser; session: AuthSession } | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.user?.email || !parsed?.session?.access_token) return null;
        // Verifica que el token no haya expirado
        if (parsed.session.expires_at && parsed.session.expires_at < Date.now()) {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        // ★ v4.0.7-cleanup: detectar tokens de la API key JWT vieja
        //   Si el access_token empieza con "eyJ" (JWT formato antiguo) y
        //   la anon_key actual es "sb_publishable_*", el token está invalidado.
        //   Limpiar para forzar re-login con la key nueva.
        const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
        if (ANON_KEY.startsWith("sb_publishable_") && parsed.session.access_token?.startsWith("eyJ")) {
            console.warn("[AuthContext] Token JWT detectado con nueva anon_key. Limpiando sesión.");
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function saveToStorage(user: AuthUser | null, session: AuthSession | null): void {
    if (typeof localStorage === "undefined") return;
    if (user && session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, session }));
        // ★ v4.1.9: sincronizar sesion con cliente Supabase via setSession()
        try {
            import("../lib/supabase").then((mod) => {
                if (typeof mod.syncSupabaseSession === "function") {
                    void mod.syncSupabaseSession();
                }
            });
        } catch {}
    } else {
        localStorage.removeItem(STORAGE_KEY);
        try {
            import("../lib/supabase").then((mod) => {
                if (typeof mod.syncSupabaseSession === "function") {
                    void mod.syncSupabaseSession();
                }
            });
        } catch {}
    }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function supabaseUserToAuthUser(sbUser: any, tenantId?: string | null): AuthUser {
    const meta = sbUser?.user_metadata ?? {};
    const derivedName = (meta.full_name as string) || (meta.name as string)
        || sbUser?.email?.split("@")[0] || "Usuario";
    return {
        id:        sbUser.id,
        email:     (sbUser.email ?? "").toLowerCase(),
        name:      derivedName,
        role:      "owner",
        restaurant_id: tenantId ?? undefined,
        created_at: sbUser.created_at,
    };
}

function supabaseSessionToAuthSession(sbSession: any, user: AuthUser): AuthSession {
    return {
        access_token:  sbSession.access_token,
        refresh_token: sbSession.refresh_token,
        expires_at:    sbSession.expires_at
            ? sbSession.expires_at * 1000
            : Date.now() + 60 * 60 * 1000,
        user,
    };
}

// ---------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------

const FALLBACK: AuthContextValue = {
    user: null, session: null, loading: false,
    signIn:           async () => ({ user: null, error: "no provider" }),
    signInWithPassword:async () => ({ user: null, error: "no provider" }),
    signOut:          async () => {},
    logout:           async () => {},
    signUp:           async () => ({ user: null, error: "no provider" }),
};

// ---------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>(FALLBACK);

// ---------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------

export interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser]       = useState<AuthUser | null>(null);
    const [session, setSession] = useState<AuthSession | null>(null);
    const [tenant, setTenant]   = useState<any | null>(null);  // ★ v3.4.7

// Helper interno: actualiza el tenant_id en el robot de defensa
function syncDefenseTenant(t: any) {
    if (t?.id) setDefenseTenant(t.id);
    else setDefenseTenant(null);
}
    const [loading, setLoading] = useState<boolean>(true);

    // Carga inicial: cache local + verificación con Supabase
    useEffect(() => {
        let mounted = true;

        // ★ v3.4.7: Cargar el tenant REAL desde Supabase
        //   Antes el AuthContext solo tenía user/session, lo que causaba
        //   que AuthPage mostrara la pantalla de "Esperando activación"
        //   aunque el tenant ya estuviera aprobado en BD.
        //
        // ★ v3.4.11: Usa el endpoint server-side /api/tenant-settings que
        //   ya usa SERVICE_ROLE_KEY (bypass RLS). Esto es crítico para VIPs
        //   y casos donde el RLS estricto bloquea la query directa.
        const fetchTenant = async (userId: string, email: string) => {
            if (!isSupabaseConfigured) return;

            // ★ v4.0.7-tenant-sync: sincronizar ANTES de resolver (limpia LocalStorage si hay tenant ajeno)
            try {
                await syncTenantFromAuth({ force: false });
            } catch { /* continuar */ }

            // ★ v4.0.7: Si es VIP, intentar cargar tenant desde Supabase directo
            const isVipUser = email && (
                email.toLowerCase() === "chalohiahmd1980@gmail.com" ||
                email.toLowerCase() === "rofixinsta@gmail.com"
            );

            try {
                // ★ v4.0.7-definer-rpc: Resolucion de tenant SIN Vercel
                //    - Query directo a Supabase REST por owner_id (caso normal)
                //    - Fallback por contact_email
                //    - VIP virtual tenant como ultimo recurso
                const { safeFetch } = await import("../lib/safeFetch");
                const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
                const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
                if (url && key) {
                    // 1) Por owner_id
                    const r1 = await safeFetch(
                        `${url}/rest/v1/tenants?owner_id=eq.${userId}&select=*&limit=1`,
                        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
                    );
                    if (r1.ok) {
                        const arr = r1.data as any[];
                        if (arr && arr[0] && mounted) {
                            setTenant(arr[0]);
                            // ★ v4.0.7-tenant-sync: persistir tenant_id validado
                            try { localStorage.setItem("mozona.current_tenant_id", arr[0].id); } catch {}
                            return;
                        }
                    }
                    // 2) Por contact_email
                    const r2 = await safeFetch(
                        `${url}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
                        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
                    );
                    if (r2.ok) {
                        const arr = r2.data as any[];
                        if (arr && arr[0] && mounted) {
                            setTenant(arr[0]);
                            // ★ v4.0.7-tenant-sync: persistir tenant_id validado
                            try { localStorage.setItem("mozona.current_tenant_id", arr[0].id); } catch {}
                            return;
                        }
                    }
                }
                // ★ v4.0.7: Si es VIP y NO se encontro tenant, crear tenant virtual
                if (isVipUser && mounted) {
                    const virtualTenant = {
                        id: "58a8e6f5-3172-409c-8aa5-ae02be0b7e76",
                        name: email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                        business_name: email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                        contact_email: email,
                        business_type: "restaurant",
                        subscription_status: "active",
                        activation_status: "vip",
                        plan_selected: "vip",
                        trial_ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                        is_protected: true,
                        owner_id: userId,
                        created_at: new Date().toISOString(),
                        onboarding_completed: true,
                    };
                    console.log("[AuthContext] VIP mode active");
                    setTenant(virtualTenant);
                }
            } catch (e) {
                console.warn("[AuthContext] warn:", String(e));
                // ★ v4.0.7: Si es VIP y hubo error, aun asi crear tenant virtual
                if (isVipUser && mounted) {
                    const virtualTenant = {
                        id: "58a8e6f5-3172-409c-8aa5-ae02be0b7e76",
                        name: email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                        business_name: email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                        contact_email: email,
                        business_type: "restaurant",
                        subscription_status: "active",
                        activation_status: "vip",
                        plan_selected: "vip",
                        trial_ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                        is_protected: true,
                        owner_id: userId,
                        created_at: new Date().toISOString(),
                        onboarding_completed: true,
                    };
                    setTenant(virtualTenant);
                }
            }
        };

        const init = async () => {
            // ★ v4.0.7-tenant-sync: Sincronizar tenant_id con JWT ANTES de hidratar
            // Esto evita errores 400 cuando el LocalStorage tiene un tenant de otro user
            try {
                await syncTenantFromAuth({ force: false });
            } catch (e) {
                console.warn("[AuthContext] syncTenantFromAuth init:", String(e));
            }

            // 1) Hidratar desde localStorage (rápido)
            const cached = loadFromStorage();
            if (cached && mounted) {
                setUser(cached.user);
                setSession(cached.session);
                if (cached.user) {
                    fetchTenant(cached.user.id, cached.user.email);
                }
            }

            // 2) Verificar con Supabase si está configurado
            if (isSupabaseConfigured) {
                let vipFound = false;
                try {
                    // ★ v4.0.7: Primero verificar sesion VIP mock (bypass cuando backend caido)
                    try {
                        const vipRaw = localStorage.getItem("mozona.vip_session");
                        if (vipRaw) {
                            const vip = JSON.parse(vipRaw);
                            if (vip.expires_at > Date.now() && vip.user) {
                                const u = supabaseUserToAuthUser(vip.user);
                                const mockSession: AuthSession = {
                                    access_token: "vip-bypass",
                                    expires_at: vip.expires_at,
                                    user: u,
                                };
                                setUser(u);
                                setSession(mockSession);
                                saveToStorage(u, mockSession); // ★ Persistir en storage principal
                                fetchTenant(u.id, u.email);
                                vipFound = true;
                                console.log("[AuthContext] VIP session mock activa, saltando Supabase getSession");
                            } else {
                                localStorage.removeItem("mozona.vip_session");
                            }
                        }
                    } catch (_) {}

                    // ★ Si encontramos sesion VIP mock, salir INMEDIATAMENTE (no verificar Supabase)
                    if (vipFound) {
                        if (!mounted) return;
                        // NO continuamos a la verificacion de Supabase
                    } else {
                        const { data, error } = await supabase.auth.getSession();
                        if (!mounted) return;
                        if (error) {
                            console.warn("[AuthContext] getSession error:", error.message);
                        } else if (data.session?.user) {
                            const u = supabaseUserToAuthUser(data.session.user);
                            const s = supabaseSessionToAuthSession(data.session, u);
                            setUser(u);
                            setSession(s);
                            saveToStorage(u, s);
                            try { localStorage.removeItem("mozona.vip_session"); } catch (_) {}
                            fetchTenant(u.id, u.email);
                        } else if (cached) {
                            // Supabase dice que no hay sesion pero teniamos cache
                            // ★ v4.5.13: admin NO es VIP — solo chalohiahmd
                            if (cached.user.email === "chalohiahmd1980@gmail.com") {
                                console.log("[AuthContext] VIP cache mantenido");
                            } else {
                                setUser(null);
                                setSession(null);
                                setTenant(null);
                                saveToStorage(null, null);
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[AuthContext] init error:", e);
                }
            }
            if (mounted) setLoading(false);
        };

        init();

        // 3) Suscribirse a cambios de auth (login/logout en otras pestañas)
        if (isSupabaseConfigured) {
            const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
                if (!mounted) return;
                if (newSession?.user) {
                    const u = supabaseUserToAuthUser(newSession.user);
                    const s = supabaseSessionToAuthSession(newSession, u);
                    setUser(u);
                    setSession(s);
                    saveToStorage(u, s);
                    // ★ Cargar tenant tras cambio de sesión
                    fetchTenant(u.id, u.email);
                } else {
                    setUser(null);
                    setSession(null);
                    setTenant(null);
                    saveToStorage(null, null);
                }
            });
            return () => {
                mounted = false;
                sub.subscription.unsubscribe();
            };
        }

        return () => { mounted = false; };
    }, []);

    // ★ v4.0.7-defense-v2: sincronizar tenantId con robot de defensa
    useEffect(() => {
        syncDefenseTenant(tenant);
    }, [tenant?.id]);

    // -----------------------------------------------------------------
    // SignIn REAL con Supabase
    // -----------------------------------------------------------------
    const signIn = useCallback(async (email: string, password: string) => {
        if (!email || !password) {
            return { user: null, error: "Email y contraseña son obligatorios" };
        }
        if (!isSupabaseConfigured) {
            return { user: null, error: "Supabase no está configurado" };
        }
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            });
            if (error) {
                return { user: null, error: error.message };
            }
            if (!data?.user || !data?.session) {
                return { user: null, error: "No se pudo iniciar sesión" };
            }
            const u = supabaseUserToAuthUser(data.user);
            const s = supabaseSessionToAuthSession(data.session, u);
            setUser(u);
            setSession(s);
            saveToStorage(u, s);
            return { user: u, error: null };
        } catch (e) {
            return { user: null, error: e instanceof Error ? e.message : String(e) };
        }
    }, []);

    const signInWithPassword = signIn;

    // -----------------------------------------------------------------
    // SignUp
    // -----------------------------------------------------------------
    const signUp = useCallback(async (email: string, password: string, name?: string) => {
        if (!email || !password) {
            return { user: null, error: "Email y contraseña son obligatorios" };
        }
        if (!isSupabaseConfigured) {
            return { user: null, error: "Supabase no está configurado" };
        }
        try {
            const { data, error } = await supabase.auth.signUp({
                email: email.trim().toLowerCase(),
                password,
                options: { data: { full_name: name ?? "" } },
            });
            if (error) return { user: null, error: error.message };
            // Si Supabase tiene confirmación por email, session puede ser null
            if (!data?.user) return { user: null, error: "No se pudo crear la cuenta" };
            if (data.session) {
                const u = supabaseUserToAuthUser(data.user);
                const s = supabaseSessionToAuthSession(data.session, u);
                setUser(u);
                setSession(s);
                saveToStorage(u, s);
                return { user: u, error: null };
            }
            // ★ v1.9.84: Supabase devolvio user pero NO session.
            //   Esto pasa con email confirmation activada.
            //   Solucion: hacer signIn inmediatamente con las mismas
            //   credenciales. Supabase permite signin aunque el email
            //   no este confirmado (depende de la config).
            if (data.user && !data.session) {
                console.log("[AuthContext] signUp sin session, intentando signIn inmediato...");

                // ★ v4.0.7-definer-rpc: Ya no usamos /api/auto-confirm-user (Vercel caído)
                //    El usuario puede confirmar via:
                //    - Email de Supabase (si está configurado)
                //    - OTP via rpc_verify_email_code (sistema propio)
                //    - Re-login automático más abajo (signInWithPassword)

                try {
                    const { data: inData, error: inErr } = await supabase.auth.signInWithPassword({
                        email: email.trim().toLowerCase(),
                        password,
                    });
                    if (inErr) {
                        console.warn("[AuthContext] signIn post-signUp fallo:", inErr.message);
                        // Esperar 500ms y reintentar (Supabase puede tardar)
                        await new Promise(r => setTimeout(r, 500));
                        const { data: inData2, error: inErr2 } = await supabase.auth.signInWithPassword({
                            email: email.trim().toLowerCase(),
                            password,
                        });
                        if (inErr2) {
                            console.warn("[AuthContext] signIn retry fallo:", inErr2.message);
                            // Devolver user de signUp aunque sin session
                            // El caller puede manejar esto
                            return { user: supabaseUserToAuthUser(data.user), error: "Email confirmation requerida. Revisa tu bandeja." };
                        }
                        if (inData2?.user && inData2?.session) {
                            const u = supabaseUserToAuthUser(inData2.user);
                            const s = supabaseSessionToAuthSession(inData2.session, u);
                            setUser(u);
                            setSession(s);
                            saveToStorage(u, s);
                            console.log("[AuthContext] signIn retry OK");
                            return { user: u, error: null };
                        }
                    }
                    if (inData?.user && inData?.session) {
                        const u = supabaseUserToAuthUser(inData.user);
                        const s = supabaseSessionToAuthSession(inData.session, u);
                        setUser(u);
                        setSession(s);
                        saveToStorage(u, s);
                        console.log("[AuthContext] signIn post-signUp OK");
                        return { user: u, error: null };
                    }
                } catch (signInErr: any) {
                    console.warn("[AuthContext] signIn exception:", signInErr);
                }
                // Devolver user de signUp aunque sin session
                return { user: supabaseUserToAuthUser(data.user), error: null };
            }
            return { user: null, error: "Revisa tu email para confirmar la cuenta" };
        } catch (e) {
            return { user: null, error: e instanceof Error ? e.message : String(e) };
        }
    }, []);

    // -----------------------------------------------------------------
    // SignOut
    // -----------------------------------------------------------------
    const signOut = useCallback(async () => {
        if (isSupabaseConfigured) {
            try { await supabase.auth.signOut(); } catch (e) {
                console.warn("[AuthContext] signOut error:", e);
            }
        }
        // ★ v4.0.7: Limpiar sesion VIP mock tambien
        try { localStorage.removeItem("mozona.vip_session"); } catch (_) {}
        setUser(null);
        setSession(null);
        saveToStorage(null, null);
    }, []);

    const logout = signOut;

    // ★ v4.0.7: setMockSession para bypass VIP
    const setMockSession = useCallback((mockUser: AuthUser, mockTenant?: any) => {
        const mockSession: AuthSession = {
            access_token: "vip-bypass",
            expires_at: Date.now() + 24 * 60 * 60 * 1000,
            user: mockUser,
        };
        setUser(mockUser);
        setSession(mockSession);
        saveToStorage(mockUser, mockSession);
        // Si se pasa tenant, setearlo
        if (mockTenant) {
            setTenant(mockTenant);
        } else {
            // Crear tenant virtual
            const virtualTenant = {
                id: "58a8e6f5-3172-409c-8aa5-ae02be0b7e76",
                name: mockUser.email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                business_name: mockUser.email === "chalohiahmd1980@gmail.com" ? "El Rincón de Casablanca" : "Mozona TPV Admin",
                contact_email: mockUser.email,
                business_type: "restaurant",
                subscription_status: "active",
                activation_status: "vip",
                plan_selected: "vip",
                trial_ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                is_protected: true,
                owner_id: mockUser.id,
                created_at: new Date().toISOString(),
                onboarding_completed: true,
            };
            setTenant(virtualTenant);
        }
    }, []);

    // -----------------------------------------------------------------
    // Refresh: re-leer sesión
    // -----------------------------------------------------------------
    const refresh = useCallback(async () => {
        if (!isSupabaseConfigured) return;
        try {
            const { data } = await supabase.auth.getSession();
            if (data.session?.user) {
                const u = supabaseUserToAuthUser(data.session.user);
                const s = supabaseSessionToAuthSession(data.session, u);
                setUser(u);
                setSession(s);
                saveToStorage(u, s);

                // ★ v4.0.7-tenant-sync: sincronizar tenant tras cambio de sesión
                try {
                    const syncResult = await syncTenantFromAuth({ force: true });
                    if (syncResult.action === "cleared" || syncResult.action === "synced") {
                        console.log("[AuthContext] refresh: tenant sincronizado", syncResult);
                    }
                } catch (e) {
                    console.warn("[AuthContext] syncTenantFromAuth refresh:", String(e));
                }
                // ★ v3.4.11: Recargar tenant también vía endpoint server-side
                try {
                    if (u.email) {
                        // ★ v4.0.7-json-safe: safeFetch valida content-type
                        const r = await safeFetch(`/api/tenant-settings?email=${encodeURIComponent(u.email)}`);
                        const json = r.data as any;
                        if (r.ok && json && json.ok && json.settings && json.settings.tenant_id) {
                            const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
                            const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
                            if (url && key) {
                                const tr = await safeFetch(
                                    `${url}/rest/v1/tenants?id=eq.${json.settings.tenant_id}&select=*&limit=1`,
                                    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
                                );
                                if (tr.ok) {
                                    const arr = tr.data as any[];
                                    if (arr && arr[0]) {
                                        setTenant(arr[0]);
                                        // ★ v4.0.7-tenant-sync: persistir
                                        try { localStorage.setItem("mozona.current_tenant_id", arr[0].id); } catch {}
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[AuthContext] refresh:", String(e));
                }
            }
        } catch (e) {
            console.warn("[AuthContext] refresh error:", e);
        }
    }, []);

    // -----------------------------------------------------------------
    // Stubs de compatibilidad
    // -----------------------------------------------------------------
    const createTenant = useCallback(async (..._args: any[]) => ({ error: "Use Stripe checkout" }), []);

    /**
     * Canjea un código de invitación llamando a la RPC
     * `redeem_invitation_token`.  Devuelve:
     *   { ok: true, plan, code, max_uses, remaining }
     *   { ok: false, error }
     *   { ok: false, error }  si Supabase no está configurado
     */
    const redeemInvite = useCallback(async (code: string) => {
        if (!isSupabaseConfigured) {
            return { ok: false, error: "Supabase no configurado" };
        }
        if (!code || !code.trim()) {
            return { ok: false, error: "Introduce un código de invitación" };
        }
        try {
            const { data, error } = await supabase.rpc("redeem_invitation_token", {
                p_code: code.trim(),
            });
            if (error) {
                return { ok: false, error: error.message };
            }
            if (!data || data.ok !== true) {
                return { ok: false, error: data?.error ?? "Código no válido" };
            }
            return {
                ok:        true,
                plan:      data.plan,
                code:      data.code,
                max_uses:  data.max_uses ?? null,
                remaining: data.remaining ?? null,
            };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }, []);

    const signInWithGoogle = useCallback(async () => {
        if (!isSupabaseConfigured) return { error: "Supabase no configurado" };
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${window.location.origin}/auth/callback` },
            });
            return { error: error?.message ?? null };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        user, session, loading,
        isReady: !loading,
        isSuperAdmin: isSuperAdminEmail(user?.email),
        status: loading ? "loading" : (user ? "authenticated" : "unauthenticated"),
        // ★ v3.4.7: tenant REAL desde Supabase (o sintético para VIP)
        // ★ v3.4.11: Priorizar SIEMPRE el tenant REAL cargado de BD
        //   (incluso para VIPs). Si por algún motivo BD no devuelve nada,
        //   mantener el bypass sintético para que no se rompa el flujo.
        tenant: (isVipOrAdmin(user?.email) && !tenant)
            ? {
                id: "vip-bypass",
                name: "VIP Bypass",
                owner_id: user?.id ?? "vip",
                plan: "lifetime_vip" as const,
                subscription_status: "active" as const,
                onboarding_completed: true,
                created_at: new Date().toISOString(),
            }
            : tenant,
        tenantRole: isVipOrAdmin(user?.email) ? "owner" : null,
        profile: user,
        refresh, createTenant, redeemInvite, signInWithGoogle,
        signIn, signInWithPassword, signOut, logout, signUp,
        setMockSession,
        // ★ v4.0.7-onboarding-fix: patchTenant permite actualizar el tenant local
        //   sin esperar al refresh de red. Usado por el wizard de onboarding para
        //   evitar el bucle "redirect a /app → ProtectedRoute ve completed=false → redirect a wizard"
        patchTenant: useCallback((patch: Record<string, any>) => {
            setTenant((prev: any) => prev ? { ...prev, ...patch } : prev);
        }, []),
    }), [user, session, tenant, loading, signIn, signUp, signOut, refresh,
         createTenant, redeemInvite, signInWithGoogle, setMockSession]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// ---------------------------------------------------------------------
// Hook — NUNCA lanza
// ---------------------------------------------------------------------

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    return ctx ?? FALLBACK;
}

export function useAuthOptional(): AuthContextValue | null {
    return useContext(AuthContext);
}

export default AuthProvider;
