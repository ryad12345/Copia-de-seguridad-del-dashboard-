// =====================================================================
// MOZONA TPV — MenuOcrUploader (Escáner IA / OCR de carta)
// =====================================================================
// Sube una foto o PDF de la carta y la envía a la Edge Function
// `extract-menu` (Gemini 1.5 Flash) que devuelve JSON estructurado.
// Si no hay Edge Function disponible, usa tesseract.js local como
// fallback y, en último caso, devuelve 5 productos de muestra.
//
// IMPORTANTE: usa `fileToBase64` con compresión canvas + chunks de 32 KB
// para evitar el "Maximum call stack size exceeded" en imágenes >1 MB.
// =====================================================================

import { useRef, useState } from "react";
import { IconCamera, IconCheck, IconX, IconSparkles, IconRefresh } from "../icons";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fileToBase64, fmtBytes } from "../../lib/imageUtils";
import type { MenuItem } from "./MenuStep";

export interface MenuOcrUploaderProps {
    onExtracted: (items: MenuItem[]) => void;
}

type Status = "idle" | "reading" | "extracting" | "preview" | "error";

const MOCK_EXTRACT: MenuItem[] = [
    { category: "Entrantes",   name: "Tabla de embutidos",     price: 12.00, tax_rate: 10, description: "Jamón, chorizo, salchichón" },
    { category: "Entrantes",   name: "Croquetas caseras",      price:  5.50, tax_rate: 10, description: "6 unidades" },
    { category: "Principales", name: "Solomillo a la pimienta",price: 16.50, tax_rate: 10, description: "Con patatas panaderas" },
    { category: "Principales", name: "Bacalao al pil-pil",     price: 15.00, tax_rate: 10, description: "" },
    { category: "Postres",     name: "Coulant de chocolate",   price:  5.50, tax_rate: 10, description: "Con helado de vainilla" },
];

export function MenuOcrUploader({ onExtracted }: MenuOcrUploaderProps) {
    const [status, setStatus]     = useState<Status>("idle");
    const [error,  setError]      = useState<string | null>(null);
    const [items,  setItems]      = useState<MenuItem[]>([]);
    const [fileName, setFileName] = useState<string>("");
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setFileName(file.name);
        setStatus("reading");
        setError(null);

        try {
            // 1) Edge Function "extract-menu" (Gemini 1.5 Flash) ---
            if (isSupabaseConfigured) {
                setStatus("extracting");
                // Compresión canvas + chunked base64 → sin stack overflow
                const { base64, mimeType, byteLength } = await fileToBase64(file, {
                    compress: file.type.startsWith("image/"),
                    maxSide:  1600,
                    quality:  0.82,
                });
                console.info(
                    `[MenuOcrUploader] ${file.name} → ${fmtBytes(byteLength)} ` +
                    `(mime=${mimeType}) enviado a extract-menu`
                );
                const { data, error: fnErr } = await supabase.functions.invoke("extract-menu", {
                    body: { fileName: file.name, mimeType, base64 },
                });
                if (fnErr) throw fnErr;
                if (Array.isArray(data?.items) && data.items.length > 0) {
                    setItems(data.items as MenuItem[]);
                    setStatus("preview");
                    return;
                }
                // Si la función devolvió vacío, cae a tesseract
                console.warn("[MenuOcrUploader] Edge function sin items, fallback OCR local");
            }
            // 2) Fallback OCR local con tesseract.js -----------------
            if (file.type.startsWith("image/")) {
                setStatus("extracting");
                const items = await ocrLocal(file);
                setItems(items);
                setStatus("preview");
                return;
            }
            // 3) Modo demo: simula 1.5s -------------------------------
            await new Promise(r => setTimeout(r, 1500));
            setItems(MOCK_EXTRACT);
            setStatus("preview");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStatus("error");
        }
    };

    // -----------------------------------------------------------------
    // OCR local con tesseract.js (lazy import vía CDN → no infla bundle)
    // -----------------------------------------------------------------
    const ocrLocal = async (file: File): Promise<MenuItem[]> => {
        // @ts-expect-error  — remote ESM, no se resuelve en build
        const { createWorker } = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/+esm");
        const { fileToBase64: f2b } = await import("../../lib/imageUtils");
        const { base64 } = await f2b(file, { compress: true, maxSide: 1800, quality: 0.9 });
        const worker = await createWorker("spa");
        const { data: { text } } = await worker.recognize(base64);
        await worker.terminate();
        return parseMenuText(text);
    };

    // Heurística muy básica para extraer (categoría, nombre, precio)
    // del texto OCR.  Busca líneas con un número con coma/punto al final.
    const parseMenuText = (text: string): MenuItem[] => {
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const items: MenuItem[] = [];
        let currentCategory = "Carta";
        for (const line of lines) {
            if (/^(entrantes?|principales|postres?|bebidas?|pizzas?|pastas?|carnes?|pescados?)$/i.test(line)) {
                currentCategory = line.charAt(0).toUpperCase() + line.slice(1).toLowerCase();
                continue;
            }
            const m = line.match(/^(.+?)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*€?\s*$/);
            if (m) {
                const name  = m[1].replace(/\s{2,}/g, " ").trim();
                const price = parseFloat(m[2].replace(",", "."));
                if (name.length >= 3 && price > 0 && price < 200) {
                    items.push({
                        category: currentCategory,
                        name,
                        price,
                        tax_rate: 10,
                        description: "",
                    });
                }
            }
        }
        return items.length > 0 ? items : MOCK_EXTRACT;
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
    };

    const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void handleFile(file);
    };

    const updateItem = (i: number, patch: Partial<MenuItem>) => {
        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
    };

    const removeItem = (i: number) => {
        setItems(prev => prev.filter((_, idx) => idx !== i));
    };

    const acceptAll = () => {
        onExtracted(items);
        setItems([]);
        setStatus("idle");
        setFileName("");
    };

    const reset = () => {
        setItems([]);
        setStatus("idle");
        setError(null);
        setFileName("");
    };

    // -----------------------------------------------------------------
    // IDLE / UPLOAD
    // -----------------------------------------------------------------
    if (status === "idle" || status === "error") {
        return (
            <div>
                <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={onDrop}
                    className="
                        cursor-pointer
                        p-8 rounded-2xl border-2 border-dashed
                        border-slate-200 hover:border-blue-400 hover:bg-blue-50/50
                        text-center
                        transition
                    "
                >
                    <div className="
                        w-14 h-14 mx-auto mb-3 rounded-2xl
                        bg-blue-50 text-blue-600
                        flex items-center justify-center
                    ">
                        <IconCamera size={26} strokeWidth={1.8} />
                    </div>
                    <div className="text-[14px] font-black text-slate-900">
                        Sube una foto o PDF de tu carta
                    </div>
                    <div className="text-[11.5px] text-slate-500 mt-1">
                        Arrastra el archivo aquí o haz click para seleccionar
                    </div>
                    <div className="text-[10.5px] text-slate-400 mt-2">
                        Formatos: JPG, PNG, WebP, PDF · Máx. 10 MB
                    </div>
                    <input ref={fileRef} type="file" hidden
                           accept="image/*,application/pdf"
                           onChange={onSelect} />
                </div>
                {error && (
                    <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200/80
                                    text-[12.5px] text-rose-700 flex items-start gap-2">
                        <IconX size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                        <div>
                            <div className="font-bold">No se pudo procesar la imagen</div>
                            <div className="opacity-80 mt-0.5">{error}</div>
                        </div>
                    </div>
                )}
                {!isSupabaseConfigured && (
                    <p className="mt-3 text-[10.5px] text-slate-400 text-center">
                        <em>
                            Modo local: se usará OCR en tu navegador (tesseract.js) para
                            imágenes, o 5 productos de muestra si no detecta texto.
                        </em>
                    </p>
                )}
            </div>
        );
    }

    // -----------------------------------------------------------------
    // READING / EXTRACTING (loading)
    // -----------------------------------------------------------------
    if (status === "reading" || status === "extracting") {
        return (
            <div className="p-8 rounded-2xl border-2 border-blue-200 bg-blue-50/30 text-center">
                <div className="
                    inline-block w-10 h-10
                    border-[3px] border-slate-200 border-t-blue-600
                    rounded-full animate-spin mb-3
                " />
                <div className="text-[14px] font-black text-slate-900">
                    {status === "reading" ? "Leyendo archivo…" : "Extrayendo productos con IA…"}
                </div>
                <div className="text-[11.5px] text-slate-500 mt-1 truncate max-w-[20rem] mx-auto">
                    {fileName}
                </div>
            </div>
        );
    }

    // -----------------------------------------------------------------
    // PREVIEW — tabla editable
    // -----------------------------------------------------------------
    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <IconSparkles size={14} strokeWidth={2.2} className="text-violet-600" />
                    <span className="text-[12.5px] font-black text-slate-700">
                        {items.length} productos extraídos
                    </span>
                </div>
                <button onClick={reset}
                        className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100
                                   flex items-center justify-center active:scale-90 transition"
                        title="Subir otra imagen">
                    <IconRefresh size={14} strokeWidth={2} />
                </button>
            </div>

            <div className="space-y-1.5 max-h-80 overflow-y-auto -mx-1 px-1">
                {items.map((it, i) => (
                    <div key={i}
                         className="grid grid-cols-[1fr_2fr_72px_64px_28px] gap-1.5 items-center
                                    p-1.5 rounded-xl bg-slate-50 border border-slate-200/80">
                        <input type="text" value={it.category}
                               onChange={e => updateItem(i, { category: e.target.value })}
                               className="h-8 px-2 text-[11.5px] bg-white rounded-md
                                          border border-slate-200 outline-none focus:border-blue-400" />
                        <input type="text" value={it.name}
                               onChange={e => updateItem(i, { name: e.target.value })}
                               className="h-8 px-2 text-[12.5px] font-semibold bg-white rounded-md
                                          border border-slate-200 outline-none focus:border-blue-400" />
                        <input type="number" value={it.price}
                               onChange={e => updateItem(i, { price: parseFloat(e.target.value) || 0 })}
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

            <div className="mt-4 flex gap-2">
                <button onClick={reset}
                        className="h-11 px-4 rounded-xl bg-slate-100 hover:bg-slate-200
                                   text-[12.5px] font-bold text-slate-700
                                   active:scale-95 transition">
                    Cancelar
                </button>
                <button onClick={acceptAll} disabled={items.length === 0}
                        className="flex-1 h-11 rounded-xl
                                   bg-emerald-600 text-white text-[12.5px] font-bold
                                   shadow-sm shadow-emerald-600/30
                                   flex items-center justify-center gap-1.5
                                   disabled:opacity-50 active:scale-95 transition">
                    <IconCheck size={14} strokeWidth={2.4} />
                    Añadir {items.length} a la carta
                </button>
            </div>
        </div>
    );
}
