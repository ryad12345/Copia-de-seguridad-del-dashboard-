// =====================================================================
// MOZONA TPV — useInitialSync
// =====================================================================
// Hook que dispara la sincronización inicial:
//   1. Al montar (si hay red)
//   2. Cuando vuelve la conexión (evento "online")
//   3. Cuando el usuario fuerza manualmente (botón en StoragePanel)
//
// Usa el syncEngine.fullSync() (push + pull).
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { fullSync, type SyncResult } from "../lib/syncEngine";

export interface UseInitialSyncReturn {
    syncing:     boolean;
    lastResult:  SyncResult | null;
    lastError:   string | null;
    lastSyncAt:  string | null;
    /** Dispara un sync inmediato (botón manual). */
    trigger:     () => Promise<SyncResult | null>;
}

export function useInitialSync(
    options: { autoOnMount?: boolean; autoOnOnline?: boolean } = {},
): UseInitialSyncReturn {
    const { autoOnMount = true, autoOnOnline = true } = options;
    const [syncing, setSyncing]     = useState(false);
    const [lastResult, setResult]   = useState<SyncResult | null>(null);
    const [lastError, setError]     = useState<string | null>(null);
    const [lastSyncAt, setLastAt]   = useState<string | null>(null);

    const inFlight = useRef(false);

    const trigger = useCallback(async (): Promise<SyncResult | null> => {
        if (inFlight.current) return null;
        inFlight.current = true;
        setSyncing(true);
        setError(null);
        try {
            const result = await fullSync();
            setResult(result);
            if (result.errors.length > 0) {
                setError(result.errors.join(" · "));
            }
            setLastAt(new Date().toISOString());
            return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            return null;
        } finally {
            inFlight.current = false;
            setSyncing(false);
        }
    }, []);

    // 1) Auto-sync al montar (si online)
    useEffect(() => {
        if (!autoOnMount) return;
        if (typeof navigator !== "undefined" && navigator.onLine) {
            void trigger();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2) Auto-sync al volver online
    useEffect(() => {
        if (!autoOnOnline) return;
        const onOnline = () => { void trigger(); };
        window.addEventListener("online", onOnline);
        return () => window.removeEventListener("online", onOnline);
    }, [autoOnOnline, trigger]);

    return { syncing, lastResult, lastError, lastSyncAt, trigger };
}
