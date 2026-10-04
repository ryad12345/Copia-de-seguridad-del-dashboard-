// =====================================================================
// MOZONA TPV — PosTopBar: barra superior del terminal
// =====================================================================

import type { Restaurant, ConnectionStatus } from "../lib/types";
import {
    IconStore, IconShield, IconSettings,
    IconUser, IconCash,
} from "./icons";
import { cn } from "../lib/cn";
import { Link, useLocation } from "react-router-dom";

// ---------------------------------------------------------------------
// Tipos del componente
// ---------------------------------------------------------------------

export interface PosTopBarProps {
    restaurant: Restaurant | null;
    connection: ConnectionStatus;
    /** Versión de la build, sale en el badge PRO */
    version?: string;
    /** Cajero activo (en real sale de auth) */
    cashier?: { name: string; role: string; avatar?: string };
    onOpenSettings?:  () => void;
    onLogout?:            () => void;
    onOpenCashRegister?:  () => void;   // ★ Acceso directo al arqueo
    /** ★ v1.9.74: indica si hay sesión activa (controla el botón login/salir) */
    isAuthenticated?: boolean;
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function PosTopBar({
    restaurant, connection, version = "0.1.0",
    cashier = { name: "Cajero 01", role: "Camarero" },
    onOpenSettings, onLogout, onOpenCashRegister,
    isAuthenticated = true,
}: PosTopBarProps) {
    const initial = restaurant?.business_name?.[0] ?? "M";
    const shortName =
        restaurant?.business_name?.split(/\s+/).slice(0, 2).join(" ") ?? "MOZONA TPV";
    const location = useLocation();
    // ★ v1.9.74: oculta el botón si YA estamos en /auth (evita link redundante)
    const onAuthPage = location.pathname === "/auth" || location.pathname.startsWith("/auth");

    return (
        <header
            className="
                sticky top-0 z-30
                h-14 shrink-0
                flex items-center justify-between gap-2 sm:gap-3
                overflow-hidden
                px-4
                bg-white/85 backdrop-blur-xl
                border-b border-slate-200/80
                shadow-[0_1px_0_rgba(15,23,42,0.04)]
            "
        >
            {/* LOGO + Nombre ============================================ */}
            <div className="flex items-center gap-2 sm:gap-3 sm:pr-4 sm:border-r sm:border-slate-200/80 sm:h-10 shrink-0">
                <div
                    className="
                        w-9 h-9 sm:w-10 sm:h-10 rounded-2xl
                        bg-gradient-to-br from-blue-600 to-blue-700
                        flex items-center justify-center
                        text-white font-black text-base sm:text-lg
                        shadow-sm shadow-blue-600/20
                    "
                >
                    {initial}
                </div>
                <div className="leading-tight min-w-0">
                    <div className="text-[14px] sm:text-[15px] font-bold tracking-tight text-slate-900 truncate">
                        {shortName}
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold tracking-wider text-slate-500">
                            MOZONA
                        </span>
                        <span
                            className="
                                inline-flex items-center gap-1
                                px-1.5 py-0.5 rounded-md
                                bg-violet-600 text-white
                                text-[9px] font-black tracking-wider
                                shadow-sm shadow-violet-600/30
                            "
                        >
                            <IconShield size={9} strokeWidth={2.4} />
                            PRO CLOUD
                        </span>
                        <span className="text-[9px] font-medium text-slate-400">
                            v{version}
                        </span>
                    </div>
                </div>
            </div>

            {/* ★ v1.9.24: Marca de agua centrada ====================== */}
            <div className="
                flex-1 min-w-0
                flex items-center justify-center
                select-none pointer-events-none
                px-2
            ">
                <span className="
                    text-[12px] sm:text-[13px]
                    text-slate-400
                    font-medium
                    tracking-tight
                    whitespace-nowrap
                ">
                    {/* ★ v1.9.73: en móvil solo "Mozona.online" para no saturar */}
                    <span className="sm:hidden">
                        <a
                            href="https://mozona.online"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-500 font-semibold pointer-events-auto"
                        >
                            Mozona.online
                        </a>
                    </span>
                    <span className="hidden sm:inline">
                        Plataforma creada por{" "}
                        <a
                            href="https://mozona.online"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="
                                text-slate-500
                                font-semibold
                                hover:text-blue-600
                                transition
                                pointer-events-auto
                            "
                        >
                            Mozona.online
                        </a>
                        {" · "}
                        <span className="text-slate-400">Riyad Mouzouna</span>
                    </span>
                </span>
            </div>

            {/* Acciones rápidas ======================================== */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {isAuthenticated && (
                    <IconButton onClick={onOpenSettings} title="Ajustes">
                        <IconSettings size={18} strokeWidth={1.8} />
                    </IconButton>
                )}
                {isAuthenticated && onOpenCashRegister && (
                    <IconButton
                        onClick={onOpenCashRegister}
                        title="Cierre de caja / Arqueo"
                        className="hidden sm:inline-flex"
                    >
                        <IconCash size={18} strokeWidth={1.8} />
                    </IconButton>
                )}
                {/* ★ v1.9.74: Botón de Acceso / Login / Logout SIEMPRE visible
                    (móvil + desktop, sin importar el tamaño de pantalla)
                    - Si NO hay sesión: muestra "Acceder" con icono user (link a /auth)
                    - Si hay sesión: muestra "Salir" con icono user
                    - Mínimo 44x36px (táctil recomendado)
                    - Border + bg-slate-100 para destacar */}
                {!isAuthenticated && !onAuthPage ? (
                    <Link
                        to="/auth"
                        title="Iniciar sesión en tu cuenta"
                        aria-label="Iniciar sesión"
                        className="
                            h-9 px-2.5 sm:px-3 rounded-xl
                            flex items-center justify-center gap-1.5
                            text-white font-bold
                            bg-blue-600 hover:bg-blue-700
                            active:scale-95
                            transition touch-manipulation select-none
                            border border-blue-700/30
                            shadow-sm shadow-blue-600/20
                        "
                    >
                        <IconUser size={15} strokeWidth={2.2} />
                        <span className="hidden sm:inline text-[12px] tracking-tight">
                            Acceder
                        </span>
                    </Link>
                ) : isAuthenticated && onLogout ? (
                    <button
                        onClick={onLogout}
                        title="Cerrar sesión / Cambiar de usuario"
                        aria-label="Cerrar sesión"
                        className="
                            h-9 px-2 sm:px-3 rounded-xl
                            flex items-center justify-center gap-1.5
                            text-slate-600
                            bg-slate-100 hover:bg-rose-50 hover:text-rose-600
                            active:scale-95
                            transition touch-manipulation
                            border border-slate-200/80
                        "
                    >
                        <IconUser size={16} strokeWidth={1.8} />
                        <span className="hidden sm:inline text-[11px] font-bold tracking-tight">
                            Salir
                        </span>
                    </button>
                ) : null}
            </div>

            {/* Perfil del cajero (sm+, solo si autenticado) ============ */}
            {isAuthenticated && (
                <div className="
                    hidden sm:flex items-center gap-2.5
                    pl-3 ml-1 border-l border-slate-200/80 h-10
                    shrink-0
                ">
                <div className="text-right leading-tight max-w-[7rem]">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">
                        {cashier.name}
                    </div>
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                        {cashier.role}
                    </div>
                </div>
                <div
                    className="
                        w-9 h-9 rounded-full
                        bg-gradient-to-br from-slate-200 to-slate-300
                        flex items-center justify-center
                        text-slate-700
                        ring-2 ring-white shadow-sm
                    "
                >
                    <IconUser size={18} strokeWidth={1.8} />
                </div>
                </div>
            )}
        </header>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes privados
// ---------------------------------------------------------------------

type Tone = "ok" | "violet" | "danger" | "muted" | "warning";

const toneStyles: Record<Tone, string> = {
    ok:      "bg-emerald-50 text-emerald-700 border-emerald-200/80",
    violet:  "bg-violet-50 text-violet-700 border-violet-200/80",
    danger:  "bg-rose-50 text-rose-700 border-rose-200/80",
    warning: "bg-amber-50 text-amber-700 border-amber-200/80",
    muted:   "bg-slate-50 text-slate-500 border-slate-200/80",
};

function StatusPill({
    icon, label, tone = "muted", pulse = false,
}: { icon: React.ReactNode; label: string; tone?: Tone; pulse?: boolean }) {
    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5",
                "px-2.5 py-1 rounded-full",
                "text-xs font-semibold whitespace-nowrap shrink-0",
                "border",
                toneStyles[tone]
            )}
        >
            {pulse && (
                <span className="relative flex h-2 w-2">
                    <span className="
                        absolute inline-flex h-full w-full
                        rounded-full bg-violet-400 opacity-75
                        animate-ping
                    " />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-600" />
                </span>
            )}
            {icon}
            <span className="whitespace-nowrap">{label}</span>
        </div>
    );
}

function IconButton({
    children, onClick, title, badge, className,
}: {
    children: React.ReactNode;
    onClick?: () => void;
    title: string;
    badge?: number;
    className?: string;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={cn(
                "relative w-9 h-9 rounded-xl",
                "flex items-center justify-center",
                "text-slate-600",
                "hover:bg-slate-100 hover:text-slate-900",
                "active:scale-95 active:bg-slate-200/70",
                "transition",
                className,
            )}
        >
            {children}
            {badge !== undefined && (
                <span
                    className="
                        absolute -top-0.5 -right-0.5
                        min-w-[16px] h-4 px-1
                        rounded-full
                        bg-rose-500 text-white
                        text-[9px] font-bold
                        flex items-center justify-center
                        ring-2 ring-white
                    "
                >
                    {badge}
                </span>
            )}
        </button>
    );
}
