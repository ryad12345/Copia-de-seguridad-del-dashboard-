// =====================================================================
// MOZONA TPV — ColorPicker
// =====================================================================
// Selector de color de marca: paleta rápida de 8 colores + hex input
// + color picker nativo HTML.  Cambios se aplican al documento
// mediante una CSS variable `--brand-color`.
// =====================================================================

import { useEffect } from "react";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface ColorPickerProps {
    value:    string;
    onChange: (hex: string) => void;
}

// Paleta de colores "Apple-ish" más comunes
const SWATCHES: string[] = [
    "#2563EB", // iOS Blue
    "#7C3AED", // Pro Purple
    "#059669", // Esmeralda
    "#D97706", // Naranja
    "#DC2626", // Rojo
    "#DB2777", // Rosa
    "#0891B2", // Cyan
    "#475569", // Slate
];

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function ColorPicker({ value, onChange }: ColorPickerProps) {
    // Aplicar la variable CSS al documento entero para que cualquier
    // componente que use `bg-[var(--brand-color)]` cambie en vivo.
    useEffect(() => {
        document.documentElement.style.setProperty("--brand-color", value);
    }, [value]);

    return (
        <div>
            {/* Paleta rápida ----------------------------------------- */}
            <div className="grid grid-cols-8 gap-2 mb-3">
                {SWATCHES.map(c => (
                    <button
                        key={c}
                        onClick={() => onChange(c)}
                        title={c}
                        className={cn(
                            "aspect-square rounded-xl",
                            "ring-2 ring-offset-2 ring-offset-white transition",
                            value.toLowerCase() === c.toLowerCase()
                                ? "ring-slate-900 scale-105"
                                : "ring-transparent hover:scale-105"
                        )}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>

            {/* Hex + color picker ----------------------------------- */}
            <div className="flex items-center gap-2">
                <div
                    className="w-12 h-12 rounded-2xl border border-slate-200 shrink-0 shadow-inner"
                    style={{ backgroundColor: value }}
                />
                <label className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-500 select-none">
                        #
                    </span>
                    <input
                        type="text"
                        value={value.replace(/^#/, "").toUpperCase()}
                        onChange={e => {
                            const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                            if (raw.length === 6) onChange("#" + raw);
                            else if (raw.length === 0) onChange("#000000");
                        }}
                        spellCheck={false}
                        className="
                            w-full h-12 pl-7 pr-3
                            rounded-xl border border-slate-200
                            text-[14px] font-mono font-semibold tracking-wider
                            text-slate-900
                            focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                            outline-none transition
                        "
                    />
                </label>
                <label className="relative">
                    <input
                        type="color"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        className="sr-only"
                    />
                    <span
                        className="
                            inline-flex items-center justify-center
                            w-12 h-12 rounded-xl
                            border border-slate-200
                            text-[11px] font-semibold text-slate-700
                            cursor-pointer
                            hover:bg-slate-50
                            active:scale-95 transition
                        "
                    >
                        HEX
                    </span>
                </label>
            </div>
        </div>
    );
}
