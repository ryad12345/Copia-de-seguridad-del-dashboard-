// =====================================================================
// MOZONA TPV — useActiveSession (v3.3.0 — Single Source of Truth)
// =====================================================================
// Hook que SIEMPRE lee la sesión activa de Supabase Auth al montar.
// Es la única fuente de verdad para el email del usuario actual.
//
// NUNCA usa query params frájiles (?email=...).
// NUNCA usa localStorage como fuente de identidad.
// =====================================================================

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export interface ActiveSession {
    userId: string | null;
    email: string | null;
    isReady: boolean;
    isAuthenticated: boolean;
}

let cachedSession: ActiveSession | null = null;

export function useActiveSession(): ActiveSession {
    const [session, setSession] = useState<ActiveSession>(
        cachedSession || { userId: null, email: null, isReady: false, isAuthenticated: false }
    );

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const { data, error } = await supabase.auth.getUser();
                if (cancelled) return;
                if (error) {
                    console.warn("[useActiveSession] getUser error:", error.message);
                    setSession({ userId: null, email: null, isReady: true, isAuthenticated: false });
                    return;
                }
                const user = data?.user;
                if (user && user.email) {
                    const newSession = {
                        userId: user.id,
                        email: user.email.toLowerCase(),
                        isReady: true,
                        isAuthenticated: true,
                    };
                    cachedSession = newSession;
                    setSession(newSession);
                } else {
                    setSession({ userId: null, email: null, isReady: true, isAuthenticated: false });
                }
            } catch (e) {
                if (cancelled) return;
                console.warn("[useActiveSession] exception:", e);
                setSession({ userId: null, email: null, isReady: true, isAuthenticated: false });
            }
        };

        load();

        // ★ Escuchar cambios de auth (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
            if (cancelled) return;
            if (event === "SIGNED_IN" && sess?.user?.email) {
                const newSession = {
                    userId: sess.user.id,
                    email: sess.user.email.toLowerCase(),
                    isReady: true,
                    isAuthenticated: true,
                };
                cachedSession = newSession;
                setSession(newSession);
            } else if (event === "SIGNED_OUT") {
                cachedSession = null;
                setSession({ userId: null, email: null, isReady: true, isAuthenticated: false });
            }
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, []);

    return session;
}
