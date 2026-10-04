// =====================================================================
// MOZONA TPV — Set de iconos SVG (estilo iOS, line icons)
// =====================================================================
// Componentes puros, sin dependencias. strokeWidth configurable.
// Todos heredan `currentColor` para tintar con text-*.
// =====================================================================

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
    size?: number;
    strokeWidth?: number;
};

const base = (size: number, strokeWidth: number) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
});

export const IconStore = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M3 9 4.5 4h15L21 9" />
        <path d="M3 9v11h18V9" />
        <path d="M3 9h18" />
        <path d="M9 14h6" />
    </svg>
);

export const IconMenuBook = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
        <path d="M4 5v14" />
        <path d="M9 7h7M9 11h7" />
    </svg>
);

export const IconReceipt = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
);

export const IconCash = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 10v.01M18 14v.01" />
    </svg>
);

export const IconCard = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
        <path d="M6 15h4" />
    </svg>
);

export const IconQr = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v1" />
    </svg>
);

export const IconPlus = ({ size = 22, strokeWidth = 2.2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 5v14M5 12h14" />
    </svg>
);

export const IconMinus = ({ size = 22, strokeWidth = 2.2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M5 12h14" />
    </svg>
);

export const IconX = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M6 6l12 12M18 6 6 18" />
    </svg>
);

export const IconBackspace = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M9 5h11v14H9L3 12l6-7Z" />
        <path d="M14 9l4 6M18 9l-4 6" />
    </svg>
);

export const IconCamera = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
        <circle cx="12" cy="13" r="3.5" />
    </svg>
);

export const IconUpload = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 16V4M6 10l6-6 6 6" />
        <path d="M3 20h18" />
    </svg>
);

export const IconCheck = ({ size = 22, strokeWidth = 2.2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M5 12l5 5 9-11" />
    </svg>
);

export const IconChevronLeft  = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}><path d="M15 6l-6 6 6 6" /></svg>
);
export const IconChevronRight = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconChevronDown  = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}><path d="M6 9l6 6 6-6" /></svg>
);

export const IconWifi = ({ size = 18, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M5 12.55a11 11 0 0 1 14 0" />
        <path d="M8.5 16.05a6 6 0 0 1 7 0" />
        <path d="M12 20h.01" />
    </svg>
);

export const IconUsb = ({ size = 18, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 3v8" />
        <path d="M9 6h6" />
        <circle cx="12" cy="14" r="2" />
        <path d="M12 16v5M9 21h6" />
    </svg>
);

export const IconShield = ({ size = 18, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
    </svg>
);

export const IconBell = ({ size = 20, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" />
        <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
);

export const IconUser = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
);

export const IconSettings = ({ size = 20, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
);

export const IconPrint = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M6 9V3h12v6" />
        <rect x="3" y="9" width="18" height="9" rx="2" />
        <path d="M6 14h12v7H6z" />
    </svg>
);

export const IconSparkles = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />
        <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </svg>
);

export const IconShare = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 3v13" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
);

export const IconLock = ({ size = 18, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
);

export const IconDownload = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M12 3v12" />
        <path d="m6 11 6 6 6-6" />
        <path d="M3 21h18" />
    </svg>
);

export const IconRefresh = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
    </svg>
);

export const IconLogout = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
    </svg>
);

export const IconSearch = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
    </svg>
);

export const IconArrowLeftRight = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M17 11H3" />
        <path d="m7 7-4 4 4 4" />
        <path d="M7 21h14" />
        <path d="m17 17 4 4-4 4" />
    </svg>
);

export const IconAlert = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
    </svg>
);

export const IconCopy = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

export const IconTerminal = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
);

export const IconArrowRight = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

export const IconArrowLeft = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
    </svg>
);

export const IconPencil = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
);

export const IconTrash = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
);

export const IconNetwork = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg {...base(size, strokeWidth)} {...p}>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

export const IconDuplicate = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...p}>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

export const IconEye = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...p}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

export const IconEyeOff = ({ size = 22, strokeWidth = 1.8, ...p }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...p}>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);
