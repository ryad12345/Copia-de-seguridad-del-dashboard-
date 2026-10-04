// =====================================================================
// MOZONA TPV — src/context/WaiterSessionContext.tsx
// v4.5.17: Sesión de camarero SIN PIN en storage persistente.
// Cumple H-07 de la auditoría: PIN vive solo en memoria con autolock 5min.
//
// Reglas:
//   - PIN: NUNCA en localStorage/sessionStorage. Solo en closures/eventos.
//   - ID + nombre: en sessionStorage (se borra al cerrar pestaña).
//   - localStorage: LIMPIADO en mount (defense migration).
//   - Autolock: 5min sin actividad → lock(). visibilitychange → lock().
// =====================================================================

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { ApiError, isApiError, withSession } from "../lib/api";

type WaiterSession = {
    waiterId: string;
    name: string;
    role: string;
};

type Ctx = {
    waiter: WaiterSession | null;
    /** Desbloquea terminal con waiterId + PIN. Valida via RPC. */
    unlock: (waiterId: string, name: string, role: string, pin: string) => Promise<boolean>;
    /** Bloquea terminal: olvida waiter y limpia PIN. */
    lock: () => void;
    /** Para depurar. */
    lastError: string | null;
};

const AUTOLOCK_MS = 5 * 60 * 1000;
const SS_KEY = "mozona.waiter_session.v2";

const WaiterSessionContext = createContext<Ctx | null>(null);

export function WaiterSessionProvider({ children }: { children: ReactNode }) {
    const [waiter, setWaiter] = useState<WaiterSession | null>(() => {
        try {
            const raw = sessionStorage.getItem(SS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return typeof parsed?.waiterId === "string" ? parsed : null;
        } catch {
            return null;
        }
    });
    const [lastError, setLastError] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Limpieza de migración: borra restos legacy inseguros (cualquier PIN
    // o credencial en localStorage de versiones anteriores).
    useEffect(() => {
        try {
            ["waiter_pin", "waiterId", "waiter", "pin",
             "mozona.waiter_session", "mozona.waiters",
             "mozona.waiter_pin"].forEach((k) => {
                try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
            });
            sessionStorage.removeItem("mozona.waiter_session");
            sessionStorage.removeItem("waiter_pin");
        } catch (_) { /* ignore */ }
    }, []);

    const lock = useCallback(() => {
        setWaiter(null);
        try { sessionStorage.removeItem(SS_KEY); } catch (_) { /* ignore */ }
        setLastError(null);
    }, []);

    // Autolock por inactividad + al ocultar pestaña
    useEffect(() => {
        if (!waiter) return;
        const reset = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(lock, AUTOLOCK_MS);
        };
        reset();
        const evts: Array<keyof DocumentEventMap | keyof WindowEventMap> = [
            "pointerdown", "keydown", "scroll", "touchstart"
        ];
        evts.forEach((e) => {
            window.addEventListener(e as string, reset);
        });
        const onVisibility = () => { if (document.hidden) lock(); };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            evts.forEach((e) => window.removeEventListener(e as string, reset));
            document.removeEventListener("visibilitychange", onVisibility);
            if (timer.current) clearTimeout(timer.current);
        };
    }, [waiter, lock]);

    const unlock = useCallback(async (
        waiterId: string,
        name: string,
        role: string,
        pin: string
    ): Promise<boolean> => {
        setLastError(null);
        try {
            const res = await withSession(() =>
                supabase.rpc("verify_waiter_pin", {
                    p_waiter_id: waiterId,
                    p_pin: pin,
                })
            );
            // v4.5.17: la RPC devuelve JSON { ok, error?, until? }
            // (depending on whether it's JSON-typed) — normalizamos
            const ok = (res as any)?.ok === true;
            if (ok) {
                const sess: WaiterSession = { waiterId, name, role };
                setWaiter(sess);
                try { sessionStorage.setItem(SS_KEY, JSON.stringify(sess)); } catch (_) { /* ignore */ }
                return true;
            }
            const err = (res as any)?.error ?? "bad_pin";
            setLastError(err);
            return false;
        } catch (e) {
            if (isApiError(e)) {
                setLastError(e.message);
            } else {
                setLastError("Error desconocido");
            }
            return false;
        }
    }, []);

    return (
        <WaiterSessionContext.Provider value={{ waiter, unlock, lock, lastError }}>
            {children}
        </WaiterSessionContext.Provider>
    );
}

export function useWaiterSession(): Ctx {
    const ctx = useContext(WaiterSessionContext);
    if (!ctx) {
        // Si no hay provider, devolvemos un no-op para no romper tests
        return {
            waiter: null,
            unlock: async () => false,
            lock: () => { /* noop */ },
            lastError: null,
        };
    }
    return ctx;
}

export { ApiError };