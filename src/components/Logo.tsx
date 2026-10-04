// =====================================================================
// MOZONA TPV — Logo component
// =====================================================================
// Logo oficial SVG inline.  Recreado del brand guidelines:
//   - Monitor/tablet azul corporativo con "M" grande en pantalla
//   - Bandeja cloche con check verde (servicio completado)
//   - "MOZONA" en azul + "TPV" en verde con nube
// =====================================================================

import { cn } from "../lib/cn";

export type LogoVariant = "full" | "mark" | "text" | "square";
export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

interface LogoProps {
    variant?: LogoVariant;
    size?:    LogoSize;
    className?: string;
    brandColor?: string;
    accentColor?: string;
    withWordmark?: boolean;
}

interface SizeSpec {
    /** Alto del icono en px */
    h: number;
    /** Alto del wordmark en px (full/text) */
    wordmark: number;
    /** Ancho del wordmark en px (full) */
    wordmarkW: number;
}

const SIZE_MAP: Record<LogoSize, SizeSpec> = {
    xs: { h: 22,  wordmark: 12, wordmarkW: 56 },
    sm: { h: 32,  wordmark: 16, wordmarkW: 80 },
    md: { h: 44,  wordmark: 20, wordmarkW: 110 },
    lg: { h: 60,  wordmark: 28, wordmarkW: 150 },
    xl: { h: 88,  wordmark: 40, wordmarkW: 210 },
};

// ICONO — SVG vectorial del "monitor + bandeja cloche con check"
function LogoMarkSVG({
    h,
    brandColor = "#0F2942",
    accentColor = "#10B981",
}: { h: number; brandColor?: string; accentColor?: string }) {
    return (
        <svg
            viewBox="0 0 200 200"
            height={h}
            width={h}
            className="inline-block shrink-0"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id={`monitor-${brandColor.slice(1)}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={brandColor}/>
                    <stop offset="100%" stopColor="#0A1E30"/>
                </linearGradient>
                <linearGradient id={`screen-${brandColor.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF"/>
                    <stop offset="100%" stopColor="#F1F5F9"/>
                </linearGradient>
                <linearGradient id={`cloche-${accentColor.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accentColor}/>
                    <stop offset="100%" stopColor="#047857"/>
                </linearGradient>
            </defs>

            {/* ============ BANDEJA CLOCHE CON CHECK (arriba derecha) ============ */}
            <g transform="translate(118, 6)">
                {/* Cúpula del cloche */}
                <path
                    d="M 8 50 Q 8 4 42 4 Q 76 4 76 50 L 76 56 L 8 56 Z"
                    fill={`url(#cloche-${accentColor.slice(1)})`}
                    stroke="#047857"
                    strokeWidth="2"
                />
                {/* Mango (botón superior) */}
                <circle cx="42" cy="4" r="4" fill="#047857"/>
                {/* Línea inferior bandeja */}
                <line x1="0" y1="60" x2="84" y2="60"
                      stroke="#047857" strokeWidth="3.5" strokeLinecap="round"/>
                {/* Check sobre el cloche */}
                <path d="M 28 30 L 38 40 L 56 18"
                      fill="none" stroke="white" strokeWidth="6"
                      strokeLinecap="round" strokeLinejoin="round"/>
            </g>

            {/* ============ MONITOR / TABLET ============ */}
            {/* Cuerpo del monitor */}
            <rect x="6" y="30" width="140" height="118" rx="12"
                  fill={`url(#monitor-${brandColor.slice(1)})`}
                  stroke="#0A1E30" strokeWidth="2.5"/>

            {/* Pantalla */}
            <rect x="18" y="42" width="116" height="92" rx="5"
                  fill={`url(#screen-${brandColor.slice(1)})`}/>

            {/* Letra M grande en la pantalla */}
            <text x="76" y="118"
                  fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
                  fontWeight="900"
                  fontSize="76"
                  textAnchor="middle"
                  fill={brandColor}
                  letterSpacing="-3">M</text>

            {/* Check pequeño sobre la M */}
            <path d="M 64 76 L 70 82 L 80 70"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"/>

            {/* Teclado */}
            <rect x="22" y="142" width="108" height="14" rx="2.5"
                  fill="#0A1E30"/>
            <rect x="100" y="145" width="22" height="8" rx="1.5"
                  fill={accentColor}/>
            {/* Teclas decorativas */}
            <g fill="#1F4060">
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                    <rect key={i} x={26 + i * 7} y={145} width="5" height="1.5" rx="0.5"/>
                ))}
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                    <rect key={`r2-${i}`} x={26 + i * 7} y={148} width="5" height="1.5" rx="0.5"/>
                ))}
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                    <rect key={`r3-${i}`} x={26 + i * 7} y={151} width="5" height="1.5" rx="0.5"/>
                ))}
            </g>
        </svg>
    );
}

// NUBE decorativa
function CloudSVG({ size, color = "#10B981" }: { size: number; color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 24" fill="none"
             xmlns="http://www.w3.org/2000/svg">
            <path d="M 7 18 Q 4 18 4 14 Q 4 10 8 9 Q 9 4 16 4 Q 23 4 24 9 Q 28 9 28 14 Q 28 18 24 18 Z"
                  fill={color} stroke="#FFFFFF" strokeWidth="1.5"/>
        </svg>
    );
}

export function Logo({
    variant = "full",
    size = "md",
    className,
    brandColor = "#0F2942",
    accentColor = "#10B981",
    withWordmark = true,
}: LogoProps) {
    const s = SIZE_MAP[size];

    if (variant === "square") {
        return (
            <div className={cn("inline-flex items-center justify-center rounded-2xl shrink-0", className)}
                 style={{
                     width:  s.h,
                     height: s.h,
                     background: `linear-gradient(135deg, ${brandColor}, #0A1E30)`,
                     boxShadow: `0 4px 12px ${brandColor}30`,
                 }}>
                <LogoMarkSVG h={s.h * 0.9} brandColor="#FFFFFF" accentColor={accentColor}/>
            </div>
        );
    }

    if (variant === "mark") {
        return (
            <span className={cn("inline-flex items-center", className)}>
                <LogoMarkSVG h={s.h} brandColor={brandColor} accentColor={accentColor}/>
            </span>
        );
    }

    if (variant === "text") {
        return (
            <div className={cn("inline-flex items-baseline gap-2", className)}>
                <span className="font-black tracking-tight leading-none"
                      style={{
                          color: brandColor,
                          fontSize: `${s.wordmark}px`,
                          letterSpacing: "-0.04em",
                      }}>
                    MOZONA
                </span>
                <span className="font-bold leading-none"
                      style={{
                          color: accentColor,
                          fontSize: `${s.wordmark * 0.7}px`,
                          letterSpacing: "-0.02em",
                      }}>
                    TPV
                </span>
            </div>
        );
    }

    // variant === "full": icono + texto
    if (!withWordmark) {
        return <Logo variant="mark" size={size} brandColor={brandColor} accentColor={accentColor} className={className}/>;
    }

    return (
        <div className={cn("inline-flex items-center gap-2.5", className)}>
            <LogoMarkSVG h={s.h} brandColor={brandColor} accentColor={accentColor}/>
            <div className="flex flex-col leading-none">
                <span className="font-black tracking-tight leading-none"
                      style={{
                          color: brandColor,
                          fontSize: `${s.wordmark}px`,
                          letterSpacing: "-0.04em",
                      }}>
                    MOZONA
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                    <span className="font-bold leading-none"
                          style={{
                              color: accentColor,
                              fontSize: `${s.wordmark * 0.65}px`,
                              letterSpacing: "-0.02em",
                          }}>
                        TPV
                    </span>
                    <CloudSVG size={s.wordmark * 0.65} color={accentColor}/>
                </div>
            </div>
        </div>
    );
}

export default Logo;
