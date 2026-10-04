// =====================================================================
// MOZONA TPV — Onboarding Step 4: Equipo y seguridad
// =====================================================================
// Alta rápida de camareros con asignación de PIN de 4 dígitos.
// =====================================================================

import { useState } from "react";
import { StepShell, HintBox } from "./BusinessStep";
import { IconPlus, IconX, IconUser, IconShield } from "../icons";

export type WaiterRole = "waiter" | "cashier" | "owner";

export interface WaiterSpec {
    name: string;
    pin:  string;
    role: WaiterRole;
}

export interface TeamData {
    waiters: WaiterSpec[];
}

export interface TeamStepProps {
    value:    TeamData;
    onChange: (next: TeamData) => void;
}

const ROLE_TONES: Record<WaiterRole, string> = {
    waiter:  "bg-blue-50 text-blue-700",
    cashier: "bg-emerald-50 text-emerald-700",
    owner:   "bg-violet-50 text-violet-700",
};

export function TeamStep({ value, onChange }: TeamStepProps) {
    const [err, setErr] = useState<string | null>(null);

    const addWaiter = () => {
        const next: WaiterSpec = {
            name: "",
            pin:  generatePin(value.waiters.map(w => w.pin)),
            role: "waiter",
        };
        onChange({ waiters: [...value.waiters, next] });
        setErr(null);
    };

    const updateWaiter = (i: number, patch: Partial<WaiterSpec>) => {
        onChange({
            waiters: value.waiters.map((w, idx) => idx === i ? { ...w, ...patch } : w),
        });
        setErr(null);
    };

    const removeWaiter = (i: number) => {
        onChange({ waiters: value.waiters.filter((_, idx) => idx !== i) });
        setErr(null);
    };

    return (
        <StepShell
            icon={<IconUser size={22} strokeWidth={1.8} />}
            title="Tu equipo"
            subtitle="Añade a tus camareros.  Cada uno entra con su PIN en el comandero o la caja."
        >
            {value.waiters.length === 0 ? (
                <button onClick={addWaiter}
                        className="
                            w-full p-8 border-2 border-dashed border-slate-200 rounded-2xl
                            text-[12.5px] text-slate-500 hover:border-blue-300 hover:text-blue-600
                            flex flex-col items-center justify-center gap-2
                            active:scale-95 transition
                        ">
                    <div className="
                        w-12 h-12 rounded-2xl
                        bg-blue-50 text-blue-600
                        flex items-center justify-center
                    ">
                        <IconPlus size={22} strokeWidth={2.2} />
                    </div>
                    Añadir primer miembro del equipo
                </button>
            ) : (
                <div className="space-y-2">
                    {value.waiters.map((w, i) => {
                        const pinOk = /^\d{4}$/.test(w.pin);
                        const dupPin = value.waiters.some(
                            (other, j) => j !== i && other.pin === w.pin && w.pin.length > 0
                        );
                        return (
                            <div key={i}
                                 className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80
                                            flex items-center gap-2">
                                {/* Avatar */}
                                <div className="
                                    w-9 h-9 rounded-xl
                                    bg-white border border-slate-200/80
                                    text-slate-500
                                    flex items-center justify-center
                                    shrink-0
                                ">
                                    <IconUser size={16} strokeWidth={1.8} />
                                </div>
                                {/* Name + role */}
                                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                    <input type="text" value={w.name}
                                           onChange={e => updateWaiter(i, { name: e.target.value })}
                                           placeholder="Nombre del camarero"
                                           className="h-8 px-2 bg-white text-[13px] font-semibold
                                                      rounded-md border border-slate-200
                                                      outline-none focus:border-blue-400" />
                                    <select value={w.role}
                                            onChange={e => updateWaiter(i, { role: e.target.value as WaiterRole })}
                                            className={
                                                "h-8 px-2 text-[11.5px] font-bold rounded-md border border-slate-200 " +
                                                "outline-none " + ROLE_TONES[w.role]
                                            }>
                                        <option value="waiter">Camarero</option>
                                        <option value="cashier">Cajero</option>
                                        <option value="owner">Encargado</option>
                                    </select>
                                </div>
                                {/* PIN */}
                                <div className="shrink-0">
                                    <input type="text" value={w.pin}
                                           onChange={e => updateWaiter(i, {
                                               pin: e.target.value.replace(/\D/g, "").slice(0, 4),
                                           })}
                                           placeholder="PIN"
                                           maxLength={4}
                                           inputMode="numeric"
                                           pattern="[0-9]{4}"
                                           className={
                                               "w-16 h-8 px-2 text-center text-[13px] font-black tabular-nums " +
                                               "bg-white rounded-md border outline-none " +
                                               (pinOk && !dupPin
                                                   ? "border-slate-200"
                                                   : "border-rose-300 text-rose-700")
                                           } />
                                </div>
                                {/* Remove */}
                                <button onClick={() => removeWaiter(i)}
                                        className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600
                                                   hover:bg-rose-50 flex items-center justify-center
                                                   active:scale-90 transition shrink-0">
                                    <IconX size={14} strokeWidth={2.2} />
                                </button>
                            </div>
                        );
                    })}

                    <button onClick={addWaiter}
                            className="
                                w-full h-10 rounded-xl
                                bg-slate-100 hover:bg-slate-200
                                text-[12px] font-bold text-slate-700
                                flex items-center justify-center gap-1.5
                                active:scale-95 transition
                            ">
                        <IconPlus size={14} strokeWidth={2.4} />
                        Añadir otro miembro
                    </button>
                </div>
            )}

            {err && (
                <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200/80
                                text-[12.5px] text-rose-700 flex items-start gap-2">
                    <IconX size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                    {err}
                </div>
            )}

            <HintBox>
                <IconShield size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                <span>
                    Los PINs son <strong>únicos por restaurante</strong> y se almacenan
                    cifrados.  Recomendamos <strong>PINs distintos para cada persona</strong>
                    para que el log de auditoría refleje quién hizo cada operación.
                </span>
            </HintBox>
        </StepShell>
    );
}

// ---------------------------------------------------------------------
// Generador de PINs que evita colisiones con los ya existentes
// ---------------------------------------------------------------------

function generatePin(existing: string[]): string {
    const used = new Set(existing);
    for (let attempt = 0; attempt < 20; attempt++) {
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        if (!used.has(pin)) return pin;
    }
    // Fallback determinístico
    return "0000";
}
