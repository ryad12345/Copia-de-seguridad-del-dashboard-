// =====================================================================
// MOZONA TPV — MigrationPanel (v4.0.7-migration)
// =====================================================================
// UI que permite al usuario ejecutar la migración desde localStorage
// → Supabase de forma controlada, con feedback detallado.
// =====================================================================

import { useState } from "react";
import { IconCheck, IconShield } from "../icons";
import { runMigration, isMigrationCompleted, type MigrationResult } from "../../lib/migration";

export function MigrationPanel() {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<MigrationResult | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    const handleMigrate = async () => {
        setBusy(true);
        setResult(null);
        try {
            const r = await runMigration();
            setResult(r);
        } catch (e: any) {
            setResult({
                ok: false,
                customers: { migrated: 0, skipped: 0, failed: 0 },
                orders:    { migrated: 0, skipped: 0, failed: 0 },
                pre_bills: { migrated: 0, skipped: 0, failed: 0 },
                errors: [e?.message || "Error desconocido"],
                duration_ms: 0,
            });
        } finally {
            setBusy(false);
        }
    };

    const completed = isMigrationCompleted();
    const totalMigrated = result ? (result.customers.migrated + result.orders.migrated + result.pre_bills.migrated) : 0;
    const totalSkipped = result ? (result.customers.skipped + result.orders.skipped + result.pre_bills.skipped) : 0;
    const totalFailed = result ? (result.customers.failed + result.orders.failed + result.pre_bills.failed) : 0;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                        <IconShield size={20} className="text-emerald-600" />
                        Sincronización inicial
                    </h3>
                    <p className="text-[12.5px] text-slate-500 mt-1">
                        Migra clientes, tickets y pre-cuentas guardados localmente a la base de datos.
                    </p>
                </div>
                {completed && !result && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 font-semibold">
                        <IconCheck size={12} /> Sincronizado
                    </span>
                )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Clientes</p>
                    <p className="text-lg font-black text-slate-800">
                        {result ? result.customers.migrated : "—"}
                    </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Pedidos</p>
                    <p className="text-lg font-black text-slate-800">
                        {result ? result.orders.migrated : "—"}
                    </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Pre-cuentas</p>
                    <p className="text-lg font-black text-slate-800">
                        {result ? result.pre_bills.migrated : "—"}
                    </p>
                </div>
            </div>

            {result && (
                <div className="space-y-2">
                    <div className={`rounded-xl p-3 text-[12.5px] font-medium ${
                        result.ok
                            ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                            : "bg-rose-50 border border-rose-200 text-rose-900"
                    }`}>
                        {result.ok ? (
                            <>
                                ✓ Sincronización completada en {result.duration_ms}ms
                            </>
                        ) : (
                            <>
                                ⚠ Sincronización con {totalFailed} error(es). Revisa los detalles.
                            </>
                        )}
                        {totalSkipped > 0 && (
                            <span className="ml-2 text-slate-600">
                                ({totalSkipped} ya existían)
                            </span>
                        )}
                    </div>

                    {result.errors.length > 0 && (
                        <div>
                            <button
                                onClick={() => setShowDetails(!showDetails)}
                                className="text-[11px] text-slate-500 hover:text-slate-800 font-semibold underline"
                            >
                                {showDetails ? "Ocultar" : "Ver"} detalles ({result.errors.length})
                            </button>
                            {showDetails && (
                                <pre className="mt-2 text-[10px] bg-slate-900 text-slate-100 p-3 rounded-lg overflow-auto max-h-48 font-mono">
                                    {result.errors.join("\n")}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            )}

            <button
                onClick={handleMigrate}
                disabled={busy}
                className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[13px] font-black transition"
            >
                {busy ? "Sincronizando..." : completed && !result ? "Re-sincronizar" : "Iniciar sincronización"}
            </button>

            <p className="text-[10.5px] text-slate-400 text-center">
                Proceso idempotente. Los registros existentes NO se sobrescriben.
            </p>
        </div>
    );
}
