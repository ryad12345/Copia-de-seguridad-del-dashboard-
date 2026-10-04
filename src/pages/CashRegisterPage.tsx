// =====================================================================
// MOZONA TPV — CashRegisterPage: Cierre de caja / Arqueo / Turnos
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
    getDailySummary,
    saveCashClosure,
    type CashSummary,
} from "../lib/cashRegister";
import { fmtEUR } from "../lib/format";

export function CashRegisterPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [summary, setSummary] = useState<CashSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [saved, setSaved]   = useState<{ ok: boolean; id?: string; diff?: number } | null>(null);
    const [notes, setNotes]   = useState("");
    const [error, setError]   = useState<string | null>(null);
    // ★ Inputs de cuadre (arqueo)
    const [initialCash, setInitialCash] = useState<string>("0");
    const [countedCash, setCountedCash] = useState<string>("");

    const tenantId = auth.tenant?.id ?? null;
    const closedBy = auth.user?.email ?? "—";

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const s = await getDailySummary(tenantId);
            setSummary(s);
            // Auto-rellenar countedCash con el esperado como ayuda
            const cashSales = s.byPayment["cash"]?.total ?? 0;
            const expected = (parseFloat(initialCash) || 0) + cashSales;
            if (!countedCash) {
                setCountedCash(expected.toFixed(2));
            }
        } catch (e) {
            console.warn("[CashRegister] load error:", e);
            setError("No pudimos cargar el resumen del día. Por favor, recarga la página.");
        }
        setLoading(false);
    };

    useEffect(() => { void load(); }, [tenantId]);

    // ★ Cálculo en tiempo real de la diferencia
    const cashSales = summary?.byPayment["cash"]?.total ?? 0;
    const initialN = parseFloat(initialCash) || 0;
    const countedN = parseFloat(countedCash) || 0;
    const expectedN = +(initialN + cashSales).toFixed(2);
    const diffN     = +(countedN - expectedN).toFixed(2);

    const handleClose = async () => {
        if (!summary) return;
        if (!confirm("¿Confirmar cierre de caja? Esta acción no se puede deshacer.")) return;
        setLoading(true);
        const result = await saveCashClosure({
            summary,
            closedBy,
            notes,
            initialCash: initialN,
            countedCash: countedN,
        });
        setSaved({ ok: result.ok, id: result.id, diff: result.diff });
        setLoading(false);
        if (result.ok) {
            await load();
        }
    };

    return (
        <div className="min-h-dvh bg-slate-50 text-slate-900">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate("/app")}
                        className="text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900"
                    >
                        ← Volver
                    </button>
                    <h1 className="text-sm font-black uppercase tracking-wider">
                        Cierre de Caja
                    </h1>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                    {closedBy}
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-4 space-y-4">
                {error && (
                    <div className="bg-rose-100 border border-rose-300 text-rose-800 px-4 py-3 rounded-xl text-xs">
                        {error}
                    </div>
                )}

                {saved?.ok && (
                    <div className="bg-emerald-100 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-xl text-xs">
                        ✓ Caja cerrada correctamente. ID: <code>{saved.id}</code>
                    </div>
                )}

                {/* Resumen del día */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                            Resumen del día
                        </h2>
                        <button
                            onClick={load}
                            disabled={loading}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                            {loading ? "Cargando…" : "↻ Recargar"}
                        </button>
                    </div>

                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Card label="Tickets" value={String(summary.ticketCount)} />
                            <Card label="Cancelados" value={String(summary.cancelledCount)} color="amber" />
                            <Card label="Total" value={fmtEUR(summary.totalRevenue)} big />
                            <Card label="Base + IVA" value={`${fmtEUR(summary.totalSubtotal)} + ${fmtEUR(summary.totalTax)}`} small />
                        </div>
                    )}
                </section>

                {/* Desglose por método de pago */}
                {summary && Object.keys(summary.byPayment).length > 0 && (
                    <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                        <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                            Desglose por método de pago
                        </h2>
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                                    <th className="text-left py-1">Método</th>
                                    <th className="text-right py-1">Tickets</th>
                                    <th className="text-right py-1">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(summary.byPayment).map(([k, v]) => (
                                    <tr key={k} className="border-t border-slate-100">
                                        <td className="py-1.5 font-bold capitalize">{k}</td>
                                        <td className="py-1.5 text-right">{v.count}</td>
                                        <td className="py-1.5 text-right font-bold">{fmtEUR(v.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}

                {/* ★ ARQUEO DE CAJA (inputs de cuadre) ★ */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                        Arqueo de caja
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Fondo inicial
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={initialCash}
                                onChange={e => setInitialCash(e.target.value)}
                                className="mt-1 w-full border border-slate-200 rounded-lg p-2 text-sm font-bold"
                                placeholder="0,00"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Recuento real (efectivo)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={countedCash}
                                onChange={e => setCountedCash(e.target.value)}
                                className="mt-1 w-full border border-slate-200 rounded-lg p-2 text-sm font-bold"
                                placeholder="0,00"
                            />
                        </div>
                    </div>

                    {/* ★ Diferencia en tiempo real */}
                    <div className={`
                        mt-3 p-3 rounded-xl border-2
                        ${Math.abs(diffN) < 0.01
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                            : diffN > 0
                                ? "bg-amber-50 border-amber-300 text-amber-800"
                                : "bg-rose-50 border-rose-300 text-rose-800"}
                    `}>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <div className="text-[10px] font-bold uppercase opacity-70">Esperado</div>
                                <div className="text-base font-black mt-0.5">{fmtEUR(expectedN)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-bold uppercase opacity-70">Contado</div>
                                <div className="text-base font-black mt-0.5">{fmtEUR(countedN)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-bold uppercase opacity-70">Diferencia</div>
                                <div className="text-lg font-black mt-0.5">
                                    {diffN > 0 ? "+" : ""}{fmtEUR(diffN)}
                                </div>
                            </div>
                        </div>
                        <div className="mt-2 text-[11px] text-center font-bold">
                            {Math.abs(diffN) < 0.01
                                ? "✓ Cuadra perfectamente"
                                : diffN > 0
                                    ? `⚠ Sobran ${fmtEUR(diffN)}`
                                    : `✗ Faltan ${fmtEUR(Math.abs(diffN))}`}
                        </div>
                    </div>
                </section>

                {/* Notas */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                        Notas del cierre
                    </h2>
                    <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Ej: caja inicial 100€, sobrante 5€…"
                        className="w-full border border-slate-200 rounded-lg p-2 text-xs"
                        rows={3}
                    />
                </section>

                {/* Acciones */}
                <div className="flex items-center gap-3">
                    <Link
                        to="/app"
                        className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
                    >
                        Volver al TPV
                    </Link>
                    <button
                        onClick={handleClose}
                        disabled={loading || !summary || summary.ticketCount === 0}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider py-3 rounded-xl"
                    >
                        {loading ? "Cerrando…" : "Cerrar caja (arqueo)"}
                    </button>
                </div>

                <p className="text-[10px] text-slate-400 text-center">
                    MOZONA TPV · Cierre de caja v1.0
                </p>
            </main>
        </div>
    );
}

function Card({ label, value, color, big, small }: {
    label: string;
    value: string;
    color?: "amber";
    big?: boolean;
    small?: boolean;
}) {
    const colorClass = color === "amber" ? "text-amber-600" : "text-slate-900";
    return (
        <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {label}
            </div>
            <div className={`mt-1 ${big ? "text-xl" : small ? "text-xs" : "text-base"} font-black ${colorClass}`}>
                {value}
            </div>
        </div>
    );
}

export default CashRegisterPage;
