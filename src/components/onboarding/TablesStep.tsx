// =====================================================================
// MOZONA TPV — Onboarding Step 2: Zonas y mesas
// =====================================================================

import { useState } from "react";
import { StepShell, HintBox } from "./BusinessStep";
import { IconPlus, IconX, IconSparkles } from "../icons";

export interface ZoneSpec {
    name:       string;
    tablePrefix: string;
    tableCount: number;
}

export interface TablesData {
    zones: ZoneSpec[];
}

export interface TablesStepProps {
    value:    TablesData;
    onChange: (next: TablesData) => void;
}

const PRESETS = ["Sala", "Terraza", "Barra", "Salón privado", "Exterior"];

export function TablesStep({ value, onChange }: TablesStepProps) {
    const [newZone, setNewZone] = useState("");

    const addZone = (name: string) => {
        const n = name.trim();
        if (!n) return;
        if (value.zones.find(z => z.name.toLowerCase() === n.toLowerCase())) return;
        onChange({
            zones: [
                ...value.zones,
                { name: n, tablePrefix: n.charAt(0).toUpperCase(), tableCount: 8 },
            ],
        });
        setNewZone("");
    };

    const updateZone = (i: number, patch: Partial<ZoneSpec>) => {
        onChange({
            zones: value.zones.map((z, idx) => idx === i ? { ...z, ...patch } : z),
        });
    };

    const removeZone = (i: number) => {
        onChange({ zones: value.zones.filter((_, idx) => idx !== i) });
    };

    const totalTables = value.zones.reduce((a, z) => a + z.tableCount, 0);

    return (
        <StepShell
            icon={<IconSparkles size={22} strokeWidth={1.8} />}
            title="Organiza tu sala"
            subtitle="Crea zonas y autogenera las mesas de cada una.  Podrás añadir más después."
        >
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 mb-4">
                {PRESETS.filter(p => !value.zones.find(z => z.name === p)).map(p => (
                    <button key={p} onClick={() => addZone(p)}
                            className="px-3 h-8 rounded-full
                                       bg-slate-100 hover:bg-slate-200
                                       text-[12px] font-semibold text-slate-700
                                       flex items-center gap-1
                                       active:scale-95 transition">
                        <IconPlus size={12} strokeWidth={2.4} />
                        {p}
                    </button>
                ))}
            </div>

            {/* Add custom zone */}
            <div className="flex gap-2 mb-4">
                <input type="text" value={newZone}
                       onChange={e => setNewZone(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && addZone(newZone)}
                       placeholder="Nueva zona (ej: Patio)"
                       className="input flex-1" />
                <button onClick={() => addZone(newZone)} disabled={!newZone.trim()}
                        className="h-11 px-4 rounded-xl
                                   bg-slate-900 text-white text-[12.5px] font-bold
                                   flex items-center gap-1.5
                                   active:scale-95 transition
                                   disabled:opacity-40">
                    <IconPlus size={14} strokeWidth={2.4} />
                    Añadir
                </button>
            </div>

            {/* Zonas creadas */}
            {value.zones.length === 0 ? (
                <div className="py-8 text-center text-[12.5px] text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                    Aún no has creado ninguna zona.  Pulsa en las sugerencias de arriba
                    o añade una personalizada.
                </div>
            ) : (
                <div className="space-y-2">
                    {value.zones.map((zone, i) => (
                        <div key={i}
                             className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80
                                        flex items-center gap-3">
                            {/* Handle + name */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-lg bg-white border border-slate-200/80
                                                    text-slate-700 flex items-center justify-center
                                                    text-[11px] font-black">
                                        {i + 1}
                                    </div>
                                    <input type="text" value={zone.name}
                                           onChange={e => updateZone(i, { name: e.target.value })}
                                           className="h-8 px-2 bg-transparent
                                                      text-[14px] font-bold text-slate-900
                                                      focus:bg-white focus:border focus:border-slate-200
                                                      rounded-md outline-none" />
                                </div>
                                <div className="mt-2 flex items-center gap-2 pl-9">
                                    <span className="text-[10.5px] text-slate-500 font-bold uppercase tracking-wider">
                                        Prefijo
                                    </span>
                                    <input type="text" value={zone.tablePrefix}
                                           maxLength={3}
                                           onChange={e => updateZone(i, {
                                               tablePrefix: e.target.value.toUpperCase().slice(0, 3),
                                           })}
                                           className="w-12 h-7 px-2 bg-white rounded-md
                                                      border border-slate-200 text-center
                                                      text-[12px] font-mono font-bold" />
                                    <span className="text-[10.5px] text-slate-500">
                                        (mesas se llamarán {zone.tablePrefix || "?"}-1 … {zone.tablePrefix || "?"}-{zone.tableCount})
                                    </span>
                                </div>
                            </div>
                            {/* Counter */}
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => updateZone(i, { tableCount: Math.max(0, zone.tableCount - 1) })}
                                        className="w-8 h-8 rounded-lg bg-white border border-slate-200/80
                                                   text-slate-600 hover:text-slate-900
                                                   flex items-center justify-center
                                                   active:scale-90 transition">−</button>
                                <div className="w-10 h-8 rounded-lg bg-white border border-slate-200/80
                                                text-center text-[13px] font-black tabular-nums
                                                flex items-center justify-center">
                                    {zone.tableCount}
                                </div>
                                <button onClick={() => updateZone(i, { tableCount: zone.tableCount + 1 })}
                                        className="w-8 h-8 rounded-lg bg-white border border-slate-200/80
                                                   text-slate-600 hover:text-slate-900
                                                   flex items-center justify-center
                                                   active:scale-90 transition">+</button>
                            </div>
                            {/* Remove */}
                            <button onClick={() => removeZone(i)}
                                    className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50
                                               flex items-center justify-center active:scale-90 transition">
                                <IconX size={14} strokeWidth={2.2} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Resumen */}
            {value.zones.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200/80
                                text-[12.5px] text-blue-800 flex items-center justify-between">
                    <span>
                        <strong>{value.zones.length}</strong> zonas ·{" "}
                        <strong>{totalTables}</strong> mesas en total
                    </span>
                    <span className="text-[10.5px] text-blue-600">
                        Se crearán al pulsar Continuar
                    </span>
                </div>
            )}

            <HintBox>
                <IconSparkles size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                <span>
                    Ejemplo: si creas la zona <strong>Terraza</strong> con 10 mesas,
                    se generarán <code className="px-1 bg-white rounded font-mono">T-1</code>{" "}
                    a <code className="px-1 bg-white rounded font-mono">T-10</code> en la
                    zona Terraza.
                </span>
            </HintBox>
        </StepShell>
    );
}
