// =====================================================================
// MOZONA TPV — PwaShell
// =====================================================================
// Componente "umbrella" que reúne todas las piezas PWA:
//   • OfflineIndicator  (badge sticky superior)
//   • InstallPromptBanner (banner de instalación)
//   • UpdatePrompt      (aviso de nueva versión)
//
// Úsalo dentro del árbol de la app, en cualquier nivel:
//   <PwaShell>
//     <Routes>...</Routes>
//   </PwaShell>
// =====================================================================

import { useEffect, useState, type ReactNode } from "react";
import { InstallPromptBanner } from "./InstallPromptBanner";
import { UpdatePrompt }       from "./UpdatePrompt";
import { OfflineIndicator }   from "./OfflineIndicator";
import { useNetworkSync }     from "../../hooks/useNetworkSync";
import {
    type PendingSyncItem,
} from "../../lib/offlineStorage";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface PwaShellProps {
    children: ReactNode;
    /**
     * Función que envía UN item pendiente a Supabase (o el backend remoto).
     * Si no se pasa, la sync no hace nada (útil para desarrollo).
     */
    remoteSync?: (item: PendingSyncItem) => Promise<void>;
    /**
     * Muestra el OfflineIndicator superior (default true).
     */
    showOfflineIndicator?: boolean;
}

// ---------------------------------------------------------------------
// Implementación por defecto de remoteSync (sólo log)
// ---------------------------------------------------------------------

const DEFAULT_REMOTE_SYNC = async (item: PendingSyncItem) => {
    // En desarrollo, sólo logueamos. En producción, aquí va el fetch a
    // Supabase o al endpoint REST del Tauri/LAN server.
    console.log("[PwaShell] (mock) remoteSync →", item);
    await new Promise(r => setTimeout(r, 200));
};

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function PwaShell({
    children,
    remoteSync = DEFAULT_REMOTE_SYNC,
    showOfflineIndicator = true,
}: PwaShellProps) {
    const { isOnline, pendingCount, isSyncing } = useNetworkSync({ remoteSync });
    const [_, force] = useState(0);

    // Re-render cada 30s para que "hace X minutos" se actualice
    useEffect(() => {
        const t = setInterval(() => force(n => n + 1), 30_000);
        return () => clearInterval(t);
    }, []);

    return (
        <>
            {showOfflineIndicator && (
                <OfflineIndicator online={isOnline} pendingCount={pendingCount} />
            )}
            {children}
            <InstallPromptBanner />
            <UpdatePrompt />

            {/* Indicador de sync en background (sutil) */}
            {isSyncing && (
                <div
                    className="
                        fixed bottom-3 left-3 z-30
                        px-2.5 py-1.5 rounded-full
                        bg-blue-600 text-white
                        text-[11px] font-semibold
                        shadow-lg shadow-blue-600/30
                        flex items-center gap-1.5
                    "
                >
                    <Spinner /> Sincronizando…
                </div>
            )}
        </>
    );
}

function Spinner() {
    return (
        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <path
                d="M21 12a9 9 0 0 1-9 9"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            />
        </svg>
    );
}
