// =====================================================================
// MOZONA TPV — OfflineIndicator
// =====================================================================
// Pequeño badge que aparece en la parte superior cuando la app
// detecta que está sin red. Útil para que el usuario sepa que los
// cambios se están encolando en local.
// =====================================================================

import { cn } from "../../lib/cn";
import { IconWifi } from "../icons";

export interface OfflineIndicatorProps {
    online:       boolean;
    pendingCount: number;
}

export function OfflineIndicator({ online, pendingCount }: OfflineIndicatorProps) {
    if (online && pendingCount === 0) return null;

    return (
        <div
            className={cn(
                "sticky top-0 z-30",
                "px-3 py-1.5",
                "flex items-center justify-center gap-2",
                "text-[11.5px] font-semibold",
                "border-b",
                online
                    ? "bg-amber-50 text-amber-800 border-amber-200/80"
                    : "bg-rose-50 text-rose-700 border-rose-200/80"
            )}
            role="status"
        >
            <IconWifi
                size={12}
                strokeWidth={2.4}
                className={online ? "rotate-180" : ""}
            />
            <span>
                {online
                    ? `Sincronizando ${pendingCount} ${pendingCount === 1 ? "elemento" : "elementos"} pendientes…`
                    : "Sin conexión a Internet — los cambios se guardan en este equipo"
                }
            </span>
        </div>
    );
}
