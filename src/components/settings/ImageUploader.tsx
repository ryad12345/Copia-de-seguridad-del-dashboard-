// =====================================================================
// MOZONA TPV — ImageUploader
// =====================================================================
// Drop-zone estilo iOS para subir el logo o la portada. Convierte el
// archivo a data URL y lo entrega al padre vía `onChange`.
// =====================================================================

import { useRef, useState, useCallback } from "react";
import { IconUpload, IconX, IconCamera } from "../icons";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface ImageUploaderProps {
    label:       string;
    description: string;
    value:       string | null;
    onChange:    (dataUrl: string | null) => void;
    /** Forma del preview: "square" (logo) o "wide" (cover). */
    variant?:    "square" | "wide";
    /** Tamaño máximo en MB. Default 2MB. */
    maxMb?:      number;
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function ImageUploader({
    label, description, value, onChange,
    variant = "square", maxMb = 2,
}: ImageUploaderProps) {
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [drag,   setDrag]   = useState(false);
    const [error,  setError]  = useState<string | null>(null);

    const accept = (file: File) => {
        setError(null);
        if (!file.type.startsWith("image/")) {
            setError("El archivo debe ser una imagen (PNG, JPG, WebP)");
            return;
        }
        const sizeMb = file.size / 1024 / 1024;
        if (sizeMb > maxMb) {
            setError(`Imagen demasiado grande (${sizeMb.toFixed(1)} MB, máx ${maxMb} MB)`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") onChange(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) accept(f);
    };

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) accept(f);
    }, []);

    const remove = () => {
        onChange(null);
        if (fileRef.current) fileRef.current.value = "";
    };

    // Dimensiones del preview -----------------------------------------
    const previewH = variant === "square" ? "h-32" : "h-24";

    return (
        <div>
            <div className="text-[13px] font-semibold text-slate-900 mb-1">{label}</div>
            <div className="text-[11.5px] text-slate-500 mb-2 leading-relaxed">{description}</div>

            {value ? (
                // Vista previa con botón quitar ----------------------------
                <div className={cn(
                    "relative w-full rounded-2xl overflow-hidden",
                    "border border-slate-200/80 bg-slate-50",
                    previewH
                )}>
                    <img
                        src={value}
                        alt={label}
                        className={cn(
                            "w-full h-full",
                            variant === "square" ? "object-contain p-2" : "object-cover"
                        )}
                    />
                    <button
                        onClick={remove}
                        className="
                            absolute top-2 right-2
                            w-7 h-7 rounded-full
                            bg-black/70 text-white
                            flex items-center justify-center
                            hover:bg-black/85
                            active:scale-95 transition
                        "
                        title="Quitar imagen"
                    >
                        <IconX size={14} strokeWidth={2.4} />
                    </button>
                </div>
            ) : (
                // Drop zone ----------------------------------------------
                <button
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={onDrop}
                    className={cn(
                        "w-full rounded-2xl text-left",
                        "border-2 border-dashed",
                        "px-4 py-5",
                        "flex items-center gap-3",
                        "transition",
                        drag
                            ? "border-blue-500 bg-blue-50"
                            : "border-slate-200 bg-slate-50/50 hover:bg-slate-100 hover:border-slate-300"
                    )}
                >
                    <div
                        className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                            "bg-white border border-slate-200 text-slate-500",
                            drag && "bg-blue-100 border-blue-300 text-blue-600"
                        )}
                    >
                        <IconCamera size={20} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900">
                            Subir imagen
                        </div>
                        <div className="text-[11px] text-slate-500">
                            Arrastra o toca · máx {maxMb} MB
                        </div>
                    </div>
                    <IconUpload size={16} className="text-slate-400" />
                </button>
            )}

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFile}
            />

            {error && (
                <div className="mt-2 text-[11.5px] text-rose-600 font-medium">
                    {error}
                </div>
            )}
        </div>
    );
}
