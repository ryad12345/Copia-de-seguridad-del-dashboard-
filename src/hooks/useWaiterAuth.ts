// =====================================================================
// MOZONA TPV — useWaiterAuth: sesión activa del camarero/cajero
// =====================================================================
// El estado de autenticación se persiste en localStorage para que un
// camarero que cambie de pantalla (TPV → Waiter) no tenga que volver
// a meter el PIN en cada navegación.
//
// PIN VALIDATION: usa `validatePin()` que consulta la caché IndexedDB
// de tenant_users.  Esto permite validación offline (sin Supabase).
// Si no hay caché aún, llama a `syncWaiters(tenantId)` primero.
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { findByPinCached, syncWaiters } from "../lib/waiters";
import { listCachedWaiters } from "../lib/offlineStorage";

// ---------------------------------------------------------------------
// Tipos — re-exportamos el Waiter canónico de types.ts y añadimos los
// específicos de autenticación (loggedInAt obligatorio una vez logueado).
// ---------------------------------------------------------------------

export type { Waiter } from "../lib/types";
import type { Waiter } from "../lib/types";

/** Waiter con loggedInAt obligatorio (estado de sesión). */
export interface ActiveWaiter extends Waiter {
    loggedInAt: string;
    avatarUrl?: string | null;
}

export interface UseWaiterAuthReturn {
    activeWaiter:  ActiveWaiter | null;
    isAuthenticated: boolean;
    login:         (w: Omit<Waiter, "loggedInAt">) => void;
    logout:        () => void;
    /**
     * Valida un PIN contra la lista de camareros del tenant activo.
     * Si encuentra coincidencia, marca al camarero como loggedIn y
     * devuelve el Waiter.  Si no, devuelve null.
     * Acepta también los PINs maestros 1234/0000/9999 cuando no hay
     * ningún camarero activo (modo fallback).
     */
    validatePin:   (pin: string) => Promise<Waiter | null>;
}

// ---------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------

const STORAGE_KEY = "mozona.activeWaiter";

function loadFromStorage(): Waiter | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Waiter;
        if (!parsed?.id || !parsed?.name) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveToStorage(w: Waiter | null): void {
    if (typeof localStorage === "undefined") return;
    if (w) localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    else   localStorage.removeItem(STORAGE_KEY);
}

// ★ v4.6.0 (H-07): los PINs maestros son un backdoor de desarrollo. Solo
// se aceptan en modo demo explícito (VITE_DEMO_MODE=true o build de dev).
const DEMO_MODE =
    (import.meta as any)?.env?.VITE_DEMO_MODE === "true" ||
    (import.meta as any)?.env?.DEV === true;
const MASTER_PINS = new Set(DEMO_MODE ? ["1234", "0000", "9999"] : []);

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------

export function useWaiterAuth(): UseWaiterAuthReturn {
    const auth = useAuth();
    const [activeWaiter, setActive] = useState<ActiveWaiter | null>(() => loadFromStorage() as ActiveWaiter | null);

    useEffect(() => {
        saveToStorage(activeWaiter);
    }, [activeWaiter]);

    // Si llega un evento de logout desde otra pestaña, sincronizamos
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) {
                setActive(loadFromStorage() as ActiveWaiter | null);
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const login = useCallback((w: Omit<Waiter, "loggedInAt">) => {
        setActive({ ...w, loggedInAt: new Date().toISOString() });
    }, []);

    const logout = useCallback(() => {
        setActive(null);
    }, []);

    const validatePin = useCallback(async (pin: string): Promise<Waiter | null> => {
        const tenantId = auth.tenant?.id;
        if (!tenantId) {
            // Sin tenant activo: solo permite PIN maestro
            if (MASTER_PINS.has(pin)) {
                const demo: Waiter = {
                    id: "demo", name: "Modo Demo", role: "manager",
                };
                setActive({ ...demo, loggedInAt: new Date().toISOString() });
                return demo;
            }
            return null;
        }

        // 1) Buscar en caché local (rápido, offline)
        let found = await findByPinCached(tenantId, pin);
        if (!found) {
            // 2) Cache miss → sincronizar y reintentar
            try {
                await syncWaiters(tenantId);
                found = await findByPinCached(tenantId, pin);
            } catch { /* ignore */ }
        }
        if (!found) {
            // 3) PIN maestro (solo si no hay ningún camarero activo)
            try {
                const all = await listCachedWaiters(tenantId);
                if (all.length === 0 && MASTER_PINS.has(pin)) {
                    const demo: Waiter = {
                        id: "demo", name: "Cajero Demo", role: "manager",
                    };
                    setActive({ ...demo, loggedInAt: new Date().toISOString() });
                    return demo;
                }
            } catch { /* ignore */ }
            return null;
        }
        const w: Waiter = {
            id: found.id, name: found.name, role: found.role,
        };
        setActive({ ...w, loggedInAt: new Date().toISOString() });
        return w;
    }, [auth.tenant?.id]);

    return {
        activeWaiter,
        isAuthenticated: activeWaiter !== null,
        login,
        logout,
        validatePin,
    };
}
