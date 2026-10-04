// =====================================================================
// MOZONA TPV — useLocalServer: hook que expone la info del servidor
// LAN y el estado de la sincronización con la nube.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { localApi, type NetworkInfo, type SyncStatus, type DetectedPrinter, type PrinterInfo } from "../lib/local-api";

export interface UseLocalServerState {
    network:     NetworkInfo | null;
    sync:        SyncStatus | null;
    printers:    { usb: DetectedPrinter[]; serial: DetectedPrinter[] } | null;
    activePrinter: PrinterInfo | null;
    refresh: () => Promise<void>;
}

export function useLocalServer(): UseLocalServerState {
    const [network, setNetwork]       = useState<NetworkInfo | null>(null);
    const [sync, setSync]             = useState<SyncStatus | null>(null);
    const [printers, setPrinters]     = useState<{ usb: DetectedPrinter[]; serial: DetectedPrinter[] } | null>(null);
    const [activePrinter, setActive]  = useState<PrinterInfo | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [n, s, p, a] = await Promise.all([
                localApi.networkInfo(),
                localApi.syncStatus(),
                localApi.listPrinters(),
                localApi.printerStatus(),
            ]);
            setNetwork(n);
            setSync(s);
            setPrinters(p);
            setActive(a);
        } catch (e) {
            console.error("useLocalServer.refresh:", e);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const id = setInterval(refresh, 5_000);
        return () => clearInterval(id);
    }, [refresh]);

    return { network, sync, printers, activePrinter, refresh };
}
