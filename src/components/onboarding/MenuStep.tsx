// =====================================================================
// MOZONA TPV — Onboarding Step 3: Carta / Menú
// =====================================================================
// Tres opciones:
//   1. Plantilla estándar (Bebidas, Tapas, Raciones, Postres)
//   2. Creación manual (tabla editable)
//   3. 📷 Escáner IA (sube foto o PDF y extrae la carta automáticamente)
// =====================================================================

import { useMemo, useState } from "react";
import { StepShell, HintBox } from "./BusinessStep";
import { IconPlus, IconX, IconSparkles, IconCamera, IconCheck } from "../icons";
import { MenuOcrUploader } from "./MenuOcrUploader";

export interface MenuItem {
    category:    string;
    name:        string;
    price:       number;
    tax_rate:    10 | 21;
    description: string;
}

export interface MenuData {
    items: MenuItem[];
}

export interface MenuStepProps {
    value:    MenuData;
    onChange: (next: MenuData) => void;
}

const TEMPLATE: MenuItem[] = [
    // Bebidas
    { category: "Bebidas", name: "Cerveza Mahou",        price: 2.50, tax_rate: 21, description: "" },
    { category: "Bebidas", name: "Cerveza sin alcohol",  price: 2.30, tax_rate: 21, description: "" },
    { category: "Bebidas", name: "Vino de la casa (copa)",price: 2.00, tax_rate: 21, description: "" },
    { category: "Bebidas", name: "Refresco lata",         price: 2.20, tax_rate: 21, description: "" },
    { category: "Bebidas", name: "Agua mineral 0,5L",     price: 1.80, tax_rate: 10, description: "" },
    { category: "Bebidas", name: "Café solo",             price: 1.50, tax_rate: 10, description: "" },
    { category: "Bebidas", name: "Café con leche",        price: 1.80, tax_rate: 10, description: "" },
    // Tapas
    { category: "Tapas", name: "Patatas bravas",          price: 4.50, tax_rate: 10, description: "Salsa casera picante" },
    { category: "Tapas", name: "Croquetas de jamón",      price: 5.50, tax_rate: 10, description: "Caseras, 6 unidades" },
    { category: "Tapas", name: "Tortilla española",       price: 4.80, tax_rate: 10, description: "Con cebolla" },
    { category: "Tapas", name: "Calamares a la romana",   price: 7.50, tax_rate: 10, description: "" },
    { category: "Tapas", name: "Ensaladilla rusa",        price: 4.20, tax_rate: 10, description: "" },
    // Raciones
    { category: "Raciones", name: "Paella valenciana",    price: 14.50, tax_rate: 10, description: "Para 2 personas" },
    { category: "Raciones", name: "Chuletón de ternera",   price: 22.00, tax_rate: 10, description: "500g, maduración 30 días" },
    { category: "Raciones", name: "Lubina al horno",      price: 16.50, tax_rate: 10, description: "Con verduras" },
    { category: "Raciones", name: "Risotto de setas",      price: 12.50, tax_rate: 10, description: "" },
    // Postres
    { category: "Postres", name: "Tarta de queso",        price: 4.50, tax_rate: 10, description: "Casera" },
    { category: "Postres", name: "Brownie de chocolate",  price: 4.20, tax_rate: 10, description: "Con helado de vainilla" },
    { category: "Postres", name: "Fruta del tiempo",      price: 3.00, tax_rate: 10, description: "" },
    { category: "Postres", name: "Helado (2 bolas)",      price: 3.50, tax_rate: 10, description: "Variados" },
];

export function MenuStep({ value, onChange }: MenuStepProps) {
    const [tab, setTab] = useState<"template" | "manual" | "ocr">("template");

    const categories = useMemo(() => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const it of value.items) {
            if (it.category && !seen.has(it.category)) {
                seen.add(it.category);
                result.push(it.category);
            }
        }
        return result;
    }, [value.items]);

    const addItem = () => {
        onChange({
            items: [
                ...value.items,
                { category: categories[0] ?? "General", name: "", price: 0, tax_rate: 10, description: "" },
            ],
        });
    };

    const updateItem = (i: number, patch: Partial<MenuItem>) => {
        onChange({ items: value.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) });
    };

    const removeItem = (i: number) => {
        onChange({ items: value.items.filter((_, idx) => idx !== i) });
    };

    return (
        <StepShell
            icon={<IconSparkles size={22} strokeWidth={1.8} />}
            title="Crea tu carta"
            subtitle="Añade tus platos ahora o pásalo por alto y hazlo más tarde desde Ajustes."
        >
            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1.5 mb-5 p-1 bg-slate-100 rounded-2xl">
                {([
                    { key: "template", label: "Plantilla" },
                    { key: "manual",   label: "Manual"    },
                    { key: "ocr",      label: "📷 IA"      },
                ] as const).map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                            className={
                                "h-9 rounded-xl text-[12px] font-bold transition " +
                                (tab === t.key
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700")
                            }>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* TEMPLATE */}
            {tab === "template" && (
                <div>
                    <p className="text-[12.5px] text-slate-600 mb-3">
                        Empieza con una carta típica de bar/restaurante (20 productos,
                        4 categorías).  Podrás editar todo después.
                    </p>
                    <button
                        onClick={() => onChange({ items: [...value.items, ...TEMPLATE] })}
                        disabled={value.items.length > 0}
                        className="
                            w-full h-12 rounded-2xl
                            bg-gradient-to-br from-blue-600 to-blue-700 text-white
                            text-[14px] font-black
                            shadow-lg shadow-blue-600/30
                            flex items-center justify-center gap-2
                            active:scale-95 transition
                            disabled:opacity-50
                        ">
                        <IconSparkles size={16} strokeWidth={2.2} />
                        {value.items.length > 0
                            ? `Plantilla ya cargada (${value.items.length} productos)`
                            : "Cargar plantilla típica de Bar/Restaurante"
                        }
                    </button>
                    {value.items.length > 0 && (
                        <p className="mt-2 text-[10.5px] text-emerald-700 text-center">
                            ✓ {value.items.length} productos cargados
                        </p>
                    )}
                </div>
            )}

            {/* MANUAL */}
            {tab === "manual" && (
                <div>
                    <p className="text-[12.5px] text-slate-600 mb-3">
                        Añade cada plato con su categoría, precio e IVA.  Usa el botón
                        &quot;+ Añadir&quot; para crear una fila nueva.
                    </p>

                    {value.items.length === 0 ? (
                        <button onClick={addItem}
                                className="w-full py-8 border-2 border-dashed border-slate-200 rounded-2xl
                                           text-[12.5px] text-slate-500 hover:border-blue-300 hover:text-blue-600
                                           flex items-center justify-center gap-2
                                           active:scale-95 transition">
                            <IconPlus size={14} strokeWidth={2.4} />
                            Añadir primer plato
                        </button>
                    ) : (
                        <div className="space-y-1.5 max-h-80 overflow-y-auto -mx-1 px-1">
                            {value.items.map((it, i) => (
                                <div key={i}
                                     className="grid grid-cols-[1fr_2fr_72px_64px_28px] gap-1.5 items-center
                                                p-1.5 rounded-xl bg-slate-50 border border-slate-200/80">
                                    <input type="text" value={it.category}
                                           onChange={e => updateItem(i, { category: e.target.value })}
                                           placeholder="Categoría"
                                           className="h-8 px-2 text-[11.5px] bg-white rounded-md
                                                      border border-slate-200 outline-none focus:border-blue-400" />
                                    <input type="text" value={it.name}
                                           onChange={e => updateItem(i, { name: e.target.value })}
                                           placeholder="Nombre del plato"
                                           className="h-8 px-2 text-[12.5px] font-semibold bg-white rounded-md
                                                      border border-slate-200 outline-none focus:border-blue-400" />
                                    <input type="number" value={it.price}
                                           onChange={e => updateItem(i, { price: parseFloat(e.target.value) || 0 })}
                                           placeholder="€"
                                           step="0.10" min="0"
                                           className="h-8 px-1.5 text-[12px] text-right tabular-nums
                                                      bg-white rounded-md border border-slate-200
                                                      outline-none focus:border-blue-400" />
                                    <select value={it.tax_rate}
                                            onChange={e => updateItem(i, { tax_rate: parseInt(e.target.value) as 10 | 21 })}
                                            className="h-8 text-[11.5px] bg-white rounded-md
                                                       border border-slate-200 px-1 outline-none">
                                        <option value={10}>10%</option>
                                        <option value={21}>21%</option>
                                    </select>
                                    <button onClick={() => removeItem(i)}
                                            className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-600
                                                       hover:bg-rose-50 flex items-center justify-center
                                                       active:scale-90 transition">
                                        <IconX size={12} strokeWidth={2.2} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {value.items.length > 0 && (
                        <button onClick={addItem}
                                className="mt-3 w-full h-10 rounded-xl bg-slate-100 hover:bg-slate-200
                                           text-[12px] font-bold text-slate-700
                                           flex items-center justify-center gap-1.5
                                           active:scale-95 transition">
                            <IconPlus size={14} strokeWidth={2.4} />
                            Añadir plato
                        </button>
                    )}
                </div>
            )}

            {/* OCR */}
            {tab === "ocr" && (
                <MenuOcrUploader
                    onExtracted={(items) => onChange({ items: [...value.items, ...items] })}
                />
            )}

            {/* Resumen categorías */}
            {value.items.length > 0 && (
                <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200/80
                                text-[12px] text-emerald-800">
                    <IconCheck size={14} strokeWidth={2.4} className="inline mr-1.5" />
                    <strong>{value.items.length}</strong> productos en{" "}
                    <strong>{categories.length}</strong> categorías
                    {categories.length > 0 && (
                        <span className="text-emerald-700">
                            : {categories.join(" · ")}
                        </span>
                    )}
                </div>
            )}

            <HintBox>
                <IconCamera size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                <span>
                    ¿No tienes la carta digitalizada?  Sube una <strong>foto</strong> o un
                    <strong> PDF</strong> en la pestaña IA y la extraeremos automáticamente
                    con una tabla editable para que corrijas precios.
                </span>
            </HintBox>
        </StepShell>
    );
}
