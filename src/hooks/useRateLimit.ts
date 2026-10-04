// =====================================================================
// MOZONA TPV — useRateLimit: rate limiter client-side (anti-fuerza-bruta)
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";

interface RateLimitConfig {
    key:           string;       // namespace (p.ej. "auth_login")
    maxAttempts:   number;       // nº máximo de intentos en la ventana
    windowMs:      number;       // ventana en ms
    blockMs?:      number;       // duración del bloqueo (por defecto = windowMs)
}

interface RateLimitState {
    attempts:        number;
    blockedUntil:    number;     // timestamp ms
}

interface UseRateLimitReturn {
    attempts:        number;
    maxAttempts:     number;
    isBlocked:       boolean;
    remainingSeconds: number;
    recordFailure:   () => { blocked: boolean; remainingMs: number };
    reset:           () => void;
}

const STORAGE_PREFIX = "mozona.ratelimit.";

function loadState(key: string): RateLimitState {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return { attempts: 0, blockedUntil: 0 };
        const parsed = JSON.parse(raw) as RateLimitState;
        return {
            attempts:     Number(parsed.attempts ?? 0),
            blockedUntil: Number(parsed.blockedUntil ?? 0),
        };
    } catch (e) {
        return { attempts: 0, blockedUntil: 0 };
    }
}

function saveState(key: string, state: RateLimitState): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
    } catch (e) { /* noop */ }
}

export function useRateLimit(cfg: RateLimitConfig): UseRateLimitReturn {
    const { key, maxAttempts, windowMs, blockMs = windowMs } = cfg;
    const [state, setState] = useState<RateLimitState>(() => loadState(key));
    const tickRef = useRef<number | null>(null);

    // Re-leer al montar
    useEffect(() => {
        setState(loadState(key));
    }, [key]);

    // Si cambia la ventana, también re-leer
    useEffect(() => {
        const id = window.setInterval(() => {
            const cur = loadState(key);
            setState(cur);
        }, 1000);
        return () => window.clearInterval(id);
    }, [key]);

    const now = Date.now();
    const isBlocked = state.blockedUntil > now;
    const remainingSeconds = isBlocked ? Math.ceil((state.blockedUntil - now) / 1000) : 0;

    const recordFailure = useCallback((): { blocked: boolean; remainingMs: number } => {
        const cur = loadState(key);
        const next: RateLimitState = { ...cur, attempts: cur.attempts + 1 };
        if (next.attempts >= maxAttempts) {
            next.blockedUntil = Date.now() + blockMs;
        }
        saveState(key, next);
        setState(next);
        return {
            blocked: next.blockedUntil > Date.now(),
            remainingMs: Math.max(0, next.blockedUntil - Date.now()),
        };
    }, [key, maxAttempts, blockMs]);

    const reset = useCallback(() => {
        const fresh: RateLimitState = { attempts: 0, blockedUntil: 0 };
        saveState(key, fresh);
        setState(fresh);
    }, [key]);

    // cleanup del tick
    useEffect(() => {
        return () => {
            if (tickRef.current !== null) {
                window.clearInterval(tickRef.current);
            }
        };
    }, []);

    return {
        attempts:        state.attempts,
        maxAttempts,
        isBlocked,
        remainingSeconds,
        recordFailure,
        reset,
    };
}
