// =====================================================================
// MOZONA TPV — HeroMockup (versión con imagen real)
// =====================================================================

import { cn } from "../lib/cn";

export interface HeroMockupProps {
    className?: string;
    src?: string;
}

export function HeroMockup({
    className,
    src = "/demo-hero.jpg.JPG",
}: HeroMockupProps) {
    return (
        <div className={cn(
            "relative rounded-3xl overflow-hidden border border-slate-200/80 shadow-2xl",
            "bg-slate-100",
            className,
        )}>
            <img
                src={src}
                alt="MOZONA TPV — Sistema de punto de venta"
                className="w-full h-auto block"
                loading="eager"
                decoding="async"
                onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    if (img.dataset.fallback !== "1") {
                        // Intentar con extensión alternativa
                        img.dataset.fallback = "1";
                        img.src = "/demo-hero.jpg";
                    } else if (img.dataset.fallback2 !== "1") {
                        // Intentar con png
                        img.dataset.fallback2 = "1";
                        img.src = "/demo-hero.png";
                    } else {
                        img.style.display = "none";
                        const fallback = img.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                    }
                }}
            />
            {/* Placeholder fallback si la imagen no existe */}
            <div
                className="hidden absolute inset-0 flex-col items-center justify-center
                           bg-gradient-to-br from-slate-50 to-blue-50/30 p-8 text-center"
            >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700
                                text-white flex items-center justify-center mb-3 shadow-lg
                                shadow-blue-600/30">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                         strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="8" y1="21" x2="16" y2="21"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                </div>
                <p className="text-[13px] font-black text-slate-700 mb-1">
                    Sube tu imagen aquí
                </p>
                <p className="text-[11px] text-slate-500 max-w-xs">
                    Coloca el archivo en <code className="px-1 bg-slate-200/80 rounded text-slate-700">public/demo-hero.jpg</code>
                </p>
            </div>
        </div>
    );
}

export default HeroMockup;
