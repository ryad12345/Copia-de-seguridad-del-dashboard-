// =====================================================================
// MOZONA TPV — useNetworkSync (v4.0.7-bidir-sync)
// =====================================================================
// Hook que activa el auto-sync en background:
// - Procesa queue cuando vuelve la conexión
// - Procesa queue al cargar si hay cambios pendientes
// - Notifica al usuario cuando hay cambios sincronizados
//
// Soporta DOS firmas para retro-compatibilidad:
//   - useNetworkSync({ remoteSync }) → firma legacy PwaShell
//   - useNetworkSync() → firma nueva con syncNow()
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { processQueue, autoSyncOnReconnect, getQueueSize, onSyncProgress } from "../lib/bidirectionalSync";

export interface SyncState {
    inProgress: boolean;
    queueSize: number;
    lastSyncAt: number | null;
    lastResult: { processed: number; failed: number; remaining: number } | null;
}

/** Firma legacy (PwaShell): useNetworkSync({ remoteSync }) */
export interface LegacyOptions {
    remoteSync?: (item: any) => Promise<void>;
}

export function useNetworkSync(
    optionsOrAutoStart: LegacyOptions | boolean = true
): SyncState & {
    syncNow: () => Promise<void>;
    // Legacy aliases para PwaShell
    isOnline: boolean;
    pendingCount: number;
    isSyncing: boolean;
} {
    const autoStart = typeof optionsOrAutoStart === "boolean"
        ? optionsOrAutoStart
        : true;

    const [inProgress, setInProgress] = useState(false);
    const [queueSize, setQueueSize] = useState(getQueueSize());
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [lastResult, setLastResult] = useState<SyncState["lastResult"]>(null);
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== "undefined" ? navigator.onLine : true
    );

    const syncNow = useCallback(async () => {
        if (inProgress) return;
        setInProgress(true);
        try {
            const result = await processQueue();
            setLastResult(result);
            setLastSyncAt(Date.now());
            setQueueSize(result.remaining);
        } catch (e) {
            console.error("[useNetworkSync] error:", e);
        } finally {
            setInProgress(false);
        }
    }, [inProgress]);

    useEffect(() => {
        if (!autoStart) return;

        // Activar listeners globales
        autoSyncOnReconnect();

        // Suscribirse a progreso
        const unsub = onSyncProgress(() => {
            setQueueSize(getQueueSize());
        });

        // Online/offline
        const onOnline = () => { setIsOnline(true); syncNow().catch(() => {}); };
        const onOffline = () => setIsOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        // Auto-sync inicial si hay queue
        if (getQueueSize() > 0) {
            setTimeout(() => syncNow().catch(() => {}), 3000);
        }

        return () => {
            unsub();
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, [autoStart, syncNow]);

    return {
        inProgress,
        queueSize,
        lastSyncAt,
        lastResult,
        syncNow,
        // Legacy aliases
        isOnline,
        pendingCount: queueSize,
        isSyncing: inProgress,
    };
}
