// =====================================================================
// MOZONA TPV — StoragePanel
// =====================================================================
// Panel de Almacenamiento y Sincronización para SettingsPage:
//   • Indicador de espacio ocupado / cuota (navigator.storage.estimate)
//   • Número de facturas pendientes de sincronizar
//   • Configuración del restaurant_id (necesario para el pull)
//   • Botón "Forzar Sincronización con la Nube"
//   • Botón "Limpiar Caché Local"
//   • Resultado de la última sincronización
// =====================================================================

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Card, Field } from "./FormControls";
import { IconShield, IconRefresh, IconX, IconCheck, IconWifi } from "../icons";
import { isSupabaseConfigured } from "../../lib/supabase";
import {
    countPending, getStorageEstimate, wipeAll, getMeta, setMeta,
} from "../../lib/offlineStorage";
import { useInitialSync, type UseInitialSyncReturn } from "../../hooks/useInitialSync";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface StoragePanelProps {
    /** Permite al padre controlar el sync (alternativa al auto). */
    initialSync?: UseInitialSyncReturn;
    onChange?:    () => void;       // se llama tras clear/sync para refrescar el padre
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function StoragePanel({ initialSync, onChange }: StoragePanelProps) {
    const sync = initialSync ?? useInitialSync();

    const [usage,        setUsage]        = useState<{ usage: number; quota: number } | null>(null);
    const [pendingCount, setPendingCount] = useState(0);
    const [restaurantId, setRestaurantId] = useState<string>("");
    const [editingId,    setEditingId]    = useState(false);
    const [draftId,      setDraftId]      = useState("");
    const [confirmClear, setConfirmClear] = useState(false);
    const [online,       setOnline]       = useState(
        typeof navigator !== "undefined" ? navigator.onLine : true
    );

    // -----------------------------------------------------------------
    // Carga inicial
    // -----------------------------------------------------------------
    const refresh = useCallback(async () => {
        try {
            const [est, count, stored] = await Promise.all([
                getStorageEstimate(),
                countPending(),
                getMeta<string>("mozona.restaurant_id"),
            ]);
            setUsage(est);
            setPendingCount(count);
            setRestaurantId(stored ?? "");
            setDraftId(stored ?? "");
        } catch (e) {
            console.error("[StoragePanel] refresh:", e);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { onChange?.(); }, [sync.lastSyncAt, onChange]);

    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
        };
    }, []);

    // -----------------------------------------------------------------
    // Handlers
    // -----------------------------------------------------------------
    const handleSaveId = async () => {
        const v = draftId.trim();
        if (!v) return;
        await setMeta("mozona.restaurant_id", v);
        setRestaurantId(v);
        setEditingId(false);
    };

    const handleClear = async () => {
        if (!confirmClear) {
            setConfirmClear(true);
            setTimeout(() => setConfirmClear(false), 4000);
            return;
        }
        await wipeAll();
        setConfirmClear(false);
        await refresh();
        onChange?.();
    };

    const handleSync = async () => {
        await sync.trigger();
        await refresh();
    };

    // -----------------------------------------------------------------
    // Derivados
    // -----------------------------------------------------------------
    const percent = usage?.quota
        ? Math.min(100, (usage.usage / usage.quota) * 100)
        : 0;
    const usageLabel = formatBytes(usage?.usage);
    const quotaLabel = formatBytes(usage?.quota);

    const lastError    = sync.lastError;
    const lastResult   = sync.lastResult;
    const lastSyncAt   = sync.lastSyncAt;

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------
    return (
        <Card
            title="Almacenamiento y Sincronización"
            subtitle="Datos locales en IndexedDB y réplica en Supabase Cloud"
            icon={<IconShield size={18} strokeWidth={1.8} />}
        >
            {/* Estado de red + Supabase */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <StatusChip
                    label="Internet"
                    ok={online}
                    okText="Conectado"
                    badText="Sin conexión"
                    icon={<IconWifi size={12} strokeWidth={2.2} />}
                />
                <StatusChip
                    label="Supabase Cloud"
                    ok={isSupabaseConfigured}
                    okText="Configurado"
                    badText="No configurado (.env)"
                    icon={<IconShield size={12} strokeWidth={2.2} />}
                />
            </div>

            <div className="h-px bg-slate-100" />

            {/* Almacenamiento */}
            <Field
                label="Almacenamiento local"
                description="Datos en IndexedDB. La cuota del navegador suele ser 50–60% del disco."
            >
                <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                        <span className="text-[20px] font-black text-slate-900 tabular-nums">
                            {usageLabel}
                        </span>
                        <span className="text-[11.5px] text-slate-500">
                            de {quotaLabel}
                        </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className={cn(
                                "h-full transition-all duration-500",
                                percent < 60  ? "bg-emerald-500" :
                                percent < 85  ? "bg-amber-500"  :
                                "bg-rose-500"
                            )}
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                    <div className="text-[11px] text-slate-500">
                        {pendingCount > 0
                            ? `${pendingCount} ${pendingCount === 1 ? "factura pendiente" : "facturas pendientes"} de sincronizar`
                            : "Sin facturas pendientes de sincronizar"
                        }
                    </div>
                </div>
            </Field>

            <div className="h-px bg-slate-100" />

            {/* Restaurant ID */}
            <Field
                label="Restaurant ID"
                description="Identificador del restaurante en Supabase. Necesario para descargar el catálogo."
            >
                {editingId ? (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={draftId}
                            onChange={e => setDraftId(e.target.value)}
                            placeholder="UUID del restaurante"
                            className="
                                flex-1 h-10 px-3
                                rounded-xl border border-slate-200
                                text-[13px] font-mono
                                focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                outline-none
                            "
                        />
                        <button
                            onClick={handleSaveId}
                            disabled={!draftId.trim()}
                            className="
                                h-10 px-4 rounded-xl
                                bg-emerald-600 text-white
                                text-[12.5px] font-bold
                                disabled:bg-slate-200 disabled:text-slate-400
                                active:scale-95 transition
                            "
                        >
                            Guardar
                        </button>
                        <button
                            onClick={() => { setEditingId(false); setDraftId(restaurantId); }}
                            className="
                                h-10 px-3 rounded-xl
                                bg-slate-100 text-slate-700
                                text-[12.5px] font-semibold
                                active:scale-95 transition
                            "
                        >
                            Cancelar
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <code className="
                            flex-1 h-10 px-3
                            rounded-xl border border-slate-200 bg-slate-50
                            text-[13px] font-mono text-slate-700
                            flex items-center
                            truncate
                        ">
                            {restaurantId || <span className="text-slate-400 italic">No configurado</span>}
                        </code>
                        <button
                            onClick={() => { setDraftId(restaurantId); setEditingId(true); }}
                            className="
                                h-10 px-4 rounded-xl
                                bg-slate-100 text-slate-700
                                text-[12.5px] font-semibold
                                active:scale-95 transition
                            "
                        >
                            Cambiar
                        </button>
                    </div>
                )}
            </Field>

            <div className="h-px bg-slate-100" />

            {/* Acciones */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ActionButton
                    onClick={handleSync}
                    disabled={sync.syncing || !online}
                    tone="blue"
                    icon={sync.syncing ? <Spinner /> : <IconRefresh size={16} strokeWidth={2} />}
                >
                    {sync.syncing ? "Sincronizando…" : "Forzar Sincronización"}
                </ActionButton>

                <ActionButton
                    onClick={handleClear}
                    tone={confirmClear ? "rose-strong" : "rose"}
                    icon={confirmClear ? <IconCheck size={16} strokeWidth={2.2} /> : <IconX size={16} strokeWidth={2.2} />}
                >
                    {confirmClear ? "Confirmar borrado" : "Limpiar Caché Local"}
                </ActionButton>
            </div>

            {/* Resultado de la última sync */}
            {lastResult && (
                <div
                    className={cn(
                        "rounded-2xl border p-3",
                        lastResult.errors.length === 0
                            ? "bg-emerald-50 border-emerald-200/80"
                            : "bg-rose-50 border-rose-200/80"
                    )}
                >
                    <div className="flex items-center gap-1.5 text-[12px] font-bold mb-1.5">
                        {lastResult.errors.length === 0
                            ? <IconCheck size={14} strokeWidth={2.4} className="text-emerald-600" />
                            : <IconX    size={14} strokeWidth={2.4} className="text-rose-600" />}
                        <span className={lastResult.errors.length === 0 ? "text-emerald-800" : "text-rose-800"}>
                            Última sincronización ({lastResult.durationMs} ms)
                        </span>
                    </div>
                    <div className="text-[11.5px] text-slate-700 space-y-0.5">
                        <div>
                            <strong>{lastResult.pushed}</strong> facturas enviadas,
                            {" "}<strong>{lastResult.pull.products}</strong> productos descargados,
                            {" "}<strong>{lastResult.pull.tables}</strong> mesas,
                            {" "}<strong>{lastResult.pull.categories}</strong> categorías
                        </div>
                        {lastResult.skipped.length > 0 && (
                            <div className="text-slate-500 italic">
                                Omitido: {lastResult.skipped.join(", ")}
                            </div>
                        )}
                        {lastResult.errors.map((e, i) => (
                            <div key={i} className="text-rose-700">· {e}</div>
                        ))}
                    </div>
                </div>
            )}

            {!lastResult && lastError && (
                <div className="rounded-2xl border border-rose-200/80 bg-rose-50 p-3 text-[11.5px] text-rose-700">
                    {lastError}
                </div>
            )}

            {lastSyncAt && !lastResult && (
                <div className="text-[11px] text-slate-500">
                    Última sync: {new Date(lastSyncAt).toLocaleString("es-ES")}
                </div>
            )}
        </Card>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function StatusChip({
    label, ok, okText, badText, icon,
}: { label: string; ok: boolean; okText: string; badText: string; icon: ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-xl",
                "border text-[12px] font-semibold",
                ok
                    ? "bg-emerald-50 border-emerald-200/80 text-emerald-800"
                    : "bg-rose-50 border-rose-200/80 text-rose-700"
            )}
        >
            <span className={cn(
                "w-2 h-2 rounded-full shrink-0",
                ok ? "bg-emerald-500" : "bg-rose-500"
            )} />
            {icon}
            <span className="text-slate-500 font-medium">{label}:</span>
            <span>{ok ? okText : badText}</span>
        </div>
    );
}

type ActionTone = "blue" | "rose" | "rose-strong";

const ACTION_TONES: Record<ActionTone, string> = {
    "blue":        "bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/30",
    "rose":        "bg-rose-50 text-rose-700 border border-rose-200/80 hover:bg-rose-100",
    "rose-strong": "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/30",
};

function ActionButton({
    onClick, disabled, tone, icon, children,
}: { onClick: () => void; disabled?: boolean; tone: ActionTone; icon: ReactNode; children: ReactNode }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "h-11 px-4 rounded-xl",
                "inline-flex items-center justify-center gap-2",
                "text-[13px] font-bold",
                "transition active:scale-95",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                ACTION_TONES[tone]
            )}
        >
            {icon}
            {children}
        </button>
    );
}

function Spinner() {
    return (
        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------

function formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null) return "—";
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
