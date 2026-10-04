// =====================================================================
// MOZONA TPV — SalesDateFilter: presets + datepicker visual
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import {
    getPresetDateRange, endOfDay, startOfDay,
    type DateRange, type DateRangePreset,
} from "../../lib/dateRanges";

// ★ Alias local: rangeForPreset → getPresetDateRange
const rangeForPreset = getPresetDateRange;

export type { DateRange, DateRangePreset };

export interface SalesDateFilterProps {
    value: DateRange;
    preset: DateRangePreset;
    onChange: (range: DateRange, preset: DateRangePreset) => void;
}

// ---------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------

function fmtDateShort(d: Date): string {
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}
function fmtDateLong(d: Date): string {
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}
function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

const PRESETS: Array<{ key: DateRangePreset; label: string }> = [
    { key: "today",     label: "Hoy" },
    { key: "yesterday", label: "Ayer" },
    { key: "week",      label: "Esta semana" },
    { key: "month",     label: "Este mes" },
    { key: "lastMonth", label: "Mes anterior" },
    { key: "30d",       label: "Últimos 30 días" },
];

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function SalesDateFilter({ value, preset, onChange }: SalesDateFilterProps) {
    const [open, setOpen] = useState(false);
    const [pickerStart, setPickerStart] = useState<Date>(value.start);
    const [pickerEnd,   setPickerEnd]   = useState<Date>(value.end);
    const [pickingStart, setPickingStart] = useState<boolean>(true);
    const [viewMonth, setViewMonth]   = useState<number>(value.start.getMonth());
    const [viewYear,  setViewYear]    = useState<number>(value.start.getFullYear());

    // Sincronizar el picker con el value externo cuando cambia
    useEffect(() => {
        setPickerStart(value.start);
        setPickerEnd(value.end);
        setViewMonth(value.start.getMonth());
        setViewYear(value.start.getFullYear());
    }, [value.start, value.end]);

    const monthName = useMemo(
        () => new Date(viewYear, viewMonth, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
        [viewMonth, viewYear],
    );

    // Generar matriz 6x7 de días (con padding)
    const days = useMemo(() => {
        const first = new Date(viewYear, viewMonth, 1);
        const last  = new Date(viewYear, viewMonth + 1, 0);
        const startWeekday = (first.getDay() + 6) % 7; // lunes = 0
        const out: Array<Date | null> = [];
        for (let i = 0; i < startWeekday; i++) out.push(null);
        for (let d = 1; d <= last.getDate(); d++) out.push(new Date(viewYear, viewMonth, d));
        while (out.length % 7 !== 0) out.push(null);
        return out;
    }, [viewYear, viewMonth]);

    const navMonth = (delta: number) => {
        const d = new Date(viewYear, viewMonth + delta, 1);
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
    };

    const onPickDay = (d: Date) => {
        if (pickingStart) {
            setPickerStart(startOfDay(d));
            setPickerEnd(endOfDay(d));
            setPickingStart(false);
        } else {
            // Si pickea fecha anterior a start, swap
            if (d < pickerStart) {
                setPickerStart(startOfDay(d));
                setPickerEnd(endOfDay(pickerStart));
            } else {
                setPickerEnd(endOfDay(d));
            }
            // Auto-aplicar al elegir el rango
            onChange({ start: pickerStart, end: endOfDay(d) }, "custom");
            setPickingStart(true);
            setOpen(false);
        }
    };

    const applyCustom = () => {
        onChange({ start: pickerStart, end: pickerEnd }, "custom");
        setOpen(false);
    };

    const inRange = (d: Date) => d >= pickerStart && d <= pickerEnd;
    const isEdge  = (d: Date) => sameDay(d, pickerStart) || sameDay(d, pickerEnd);

    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* ★ Botón principal: muestra el rango activo */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                    <span className="text-slate-500">📅</span>
                    <span>{labelForRange(preset, value)}</span>
                    <span className="text-slate-400">▾</span>
                </button>

                {open && (
                    <div className="absolute z-30 left-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 w-[480px]">
                        <div className="grid grid-cols-2 gap-3">
                            {/* Presets */}
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                    Rango rápido
                                </div>
                                {PRESETS.map(p => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => {
                                            const r = rangeForPreset(p.key);
                                            onChange(r, p.key);
                                            setOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold ${
                                            preset === p.key
                                                ? "bg-blue-50 text-blue-700"
                                                : "hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const r = rangeForPreset("all");
                                        onChange(r, "all");
                                        setOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold ${
                                        preset === "all"
                                            ? "bg-blue-50 text-blue-700"
                                            : "hover:bg-slate-50 text-slate-700"
                                    }`}
                                >
                                    Histórico completo
                                </button>
                            </div>

                            {/* Calendario */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <button
                                        type="button"
                                        onClick={() => navMonth(-1)}
                                        className="w-6 h-6 rounded-lg hover:bg-slate-100 text-slate-600 font-bold"
                                    >
                                        ‹
                                    </button>
                                    <div className="text-xs font-black uppercase tracking-wider text-slate-700 capitalize">
                                        {monthName}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => navMonth(1)}
                                        className="w-6 h-6 rounded-lg hover:bg-slate-100 text-slate-600 font-bold"
                                    >
                                        ›
                                    </button>
                                </div>
                                <div className="grid grid-cols-7 gap-1 mb-1">
                                    {["L", "M", "X", "J", "V", "S", "D"].map(d => (
                                        <div key={d} className="text-[10px] font-bold text-slate-400 text-center">{d}</div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-7 gap-1">
                                    {days.map((d, i) => {
                                        if (!d) return <div key={i} className="h-7" />;
                                        const sel = inRange(d);
                                        const edge = isEdge(d);
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => onPickDay(d)}
                                                className={`h-7 rounded-lg text-[11px] font-bold transition ${
                                                    edge
                                                        ? "bg-blue-600 text-white"
                                                        : sel
                                                            ? "bg-blue-100 text-blue-700"
                                                            : "hover:bg-slate-100 text-slate-700"
                                                }`}
                                            >
                                                {d.getDate()}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-3 flex items-center justify-between">
                                    <div className="text-[10px] text-slate-500">
                                        {fmtDateLong(pickerStart)} → {fmtDateLong(pickerEnd)}
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => { setPickingStart(true); }}
                                            className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50 rounded"
                                        >
                                            {pickingStart ? "Elige inicio" : "Elige fin"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={applyCustom}
                                            className="px-2 py-1 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-700"
                                        >
                                            Aplicar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ★ Botones de presets como chips (visibilidad rápida) */}
            <div className="flex flex-wrap gap-1">
                {PRESETS.slice(0, 4).map(p => (
                    <button
                        key={p.key}
                        type="button"
                        onClick={() => onChange(rangeForPreset(p.key), p.key)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                            preset === p.key
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function labelForRange(preset: DateRangePreset, value: DateRange): string {
    switch (preset) {
        case "today":     return "Hoy";
        case "yesterday": return "Ayer";
        case "week":      return `Semana (${fmtDateShort(value.start)} - ${fmtDateShort(value.end)})`;
        case "month":     return `Mes (${fmtDateShort(value.start)} - ${fmtDateShort(value.end)})`;
        case "lastMonth": return `Mes ant. (${fmtDateShort(value.start)} - ${fmtDateShort(value.end)})`;
        case "30d":       return `30d (${fmtDateShort(value.start)} - ${fmtDateShort(value.end)})`;
        case "all":       return "Histórico";
        case "custom":    return `${fmtDateShort(value.start)} - ${fmtDateShort(value.end)}`;
    }
}
