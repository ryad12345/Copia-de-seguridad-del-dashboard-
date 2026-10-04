// =====================================================================
// MOZONA TPV — PinAuthModal
// =====================================================================
// Modal de acceso rápido por PIN (4-6 dígitos). Estilo iOS lock screen:
//   • 4 puntos que se van rellenando
//   • Teclado numérico táctil 3x4
//   • Vibración háptica al pulsar (vibration API)
//   • Auto-submit al alcanzar la longitud
//
// Fallbacks para primera instalación / cloud:
//   • Si `allowMasterPin` está activo y no hay waiters, los PINs
//     `1234` o `0000` crean un usuario "Cajero Demo" al vuelo.
//   • Si `allowOfflineMode` está activo, aparece un botón "Acceder
//     sin PIN" que entra como Cajero offline.
//
// Uso:
//   <PinAuthModal
//      isOpen={showAuth}
//      pinLength={4}
//      onCancel={() => setShowAuth(false)}
//      onSubmit={async (pin) => { ... }}
//      allowMasterPin
//      allowOfflineMode
//      onOfflineAccess={() => { /* crear waiter dummy */ }}
//   />
// =====================================================================

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { IconBackspace, IconLock, IconX, IconUser, IconAlert } from "../icons";
import { unlockAudio, playKeyTick, playError } from "../../lib/sounds";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface PinAuthModalProps {
    isOpen:      boolean;
    pinLength?:  4 | 5 | 6;
    title?:      string;
    subtitle?:   string;
    /** Devuelve `null` si el PIN no es válido */
    onSubmit:    (pin: string) => Promise<unknown> | unknown;
    onCancel?:   () => void;
    /** Mensaje de error mostrado debajo de los puntos */
    errorMessage?: string;
    /**
     * Si no hay waiters, los PINs `1234` y `0000` se aceptan y crean
     * un usuario de contingencia.  Default: true.
     */
    allowMasterPin?: boolean;
    /**
     * Si no hay waiters, muestra un botón "Acceder sin PIN" para
     * entrar como usuario offline.  Default: true.
     */
    allowOfflineMode?: boolean;
    /** Llamado al pulsar el botón offline (debe crear un waiter dummy). */
    onOfflineAccess?: () => void;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const MASTER_PINS = new Set(["1234", "0000", "9999"]);

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function PinAuthModal({
    isOpen,
    pinLength = 4,
    title = "Introduce tu PIN",
    subtitle = "Acceso rápido para empleados",
    onSubmit, onCancel,
    errorMessage,
    allowMasterPin = true,
    allowOfflineMode = true,
    onOfflineAccess,
}: PinAuthModalProps) {
    const [pin, setPin]     = useState("");
    const [busy, setBusy]   = useState(false);
    const [shake, setShake] = useState(false);

    // Reset al abrir/cerrar
    useEffect(() => {
        if (isOpen) {
            setPin("");
            setBusy(false);
            setShake(false);
            // Reanudar audio (algunos navegadores lo bloquean hasta el 1er gesto)
            void unlockAudio();
        }
    }, [isOpen]);

    // Vibración háptica (helper)
    const haptic = useCallback((ms: number) => {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            try { navigator.vibrate(ms); } catch { /* ignore */ }
        }
    }, []);

    // Submit automático al alcanzar la longitud
    useEffect(() => {
        if (pin.length !== pinLength || busy) return;
        setBusy(true);

        // Shortcut: PIN maestro cuando no hay waiters
        if (allowMasterPin && MASTER_PINS.has(pin)) {
            Promise.resolve(onSubmit(pin))
                .then((res) => {
                    if (res === null || res === undefined || res === false) {
                        // El padre rechazó el PIN maestro → shake
                        setShake(true);
                        playError();
                        haptic(80);
                        setTimeout(() => {
                            setShake(false);
                            setPin("");
                            setBusy(false);
                        }, 400);
                    }
                    // Si lo aceptó, onSubmit devolverá el waiter y cerramos.
                })
                .catch(() => {
                    setShake(true);
                    playError();
                    haptic(80);
                    setTimeout(() => {
                        setShake(false);
                        setPin("");
                        setBusy(false);
                    }, 400);
                });
            return;
        }

        Promise.resolve(onSubmit(pin))
            .then((res) => {
                if (res === null || res === undefined || res === false) {
                    setShake(true);
                    playError();
                    haptic(80);
                    setTimeout(() => {
                        setShake(false);
                        setPin("");
                        setBusy(false);
                    }, 400);
                }
            })
            .catch(() => {
                setShake(true);
                playError();
                haptic(80);
                setTimeout(() => {
                    setShake(false);
                    setPin("");
                    setBusy(false);
                }, 400);
            });
    }, [pin, pinLength, busy, onSubmit, haptic, allowMasterPin]);

    if (!isOpen) return null;

    const press = (digit: string) => {
        if (busy) return;
        if (pin.length >= pinLength) return;
        haptic(15);
        playKeyTick();
        setPin(p => p + digit);
    };

    const backspace = () => {
        if (busy) return;
        haptic(15);
        setPin(p => p.slice(0, -1));
    };

    const clear = () => {
        if (busy) return;
        haptic(20);
        setPin("");
    };

    const handleOffline = () => {
        if (busy) return;
        haptic(20);
        onOfflineAccess?.();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            {/* Backdrop con blur */}
            <div
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-md"
                onClick={onCancel}
            />

            {/* Card */}
            <div
                className={`
                    relative
                    w-full max-w-sm
                    bg-white rounded-3xl
                    shadow-2xl
                    border border-slate-200/80
                    overflow-hidden
                    ${shake ? "animate-[pinShake_0.4s_ease-in-out]" : ""}
                `}
            >
                {/* Cabecera */}
                <div className="relative pt-8 pb-5 text-center">
                    {onCancel && (
                        <button
                            onClick={onCancel}
                            className="
                                absolute top-3 right-3
                                w-10 h-10 rounded-full
                                flex items-center justify-center
                                text-slate-400 hover:bg-slate-100 hover:text-slate-700
                                transition active:scale-95
                            "
                            title="Cerrar"
                            aria-label="Cerrar"
                        >
                            <IconX size={20} strokeWidth={2.2} />
                        </button>
                    )}

                    <div className="
                        w-16 h-16 mx-auto mb-3
                        rounded-2xl
                        bg-gradient-to-br from-blue-600 to-blue-700
                        flex items-center justify-center
                        text-white
                        shadow-lg shadow-blue-600/30
                    ">
                        <IconLock size={28} strokeWidth={1.8} />
                    </div>
                    <h2 className="text-[20px] font-black text-slate-900 tracking-tight">
                        {title}
                    </h2>
                    <p className="text-[12.5px] text-slate-500 mt-1 px-6">
                        {subtitle}
                    </p>
                </div>

                {/* Puntos */}
                <div className="flex justify-center gap-3 pb-5">
                    {Array.from({ length: pinLength }).map((_, i) => {
                        const filled = i < pin.length;
                        return (
                            <div
                                key={i}
                                className={`
                                    w-4 h-4 rounded-full transition-all duration-150
                                    ${filled
                                        ? "bg-blue-600 scale-110"
                                        : "bg-slate-200"
                                    }
                                `}
                            />
                        );
                    })}
                </div>

                {/* Mensaje de error o info */}
                <div className="h-5 text-center text-[12px] font-semibold">
                    {errorMessage && (
                        <span className="text-rose-600">{errorMessage}</span>
                    )}
                </div>

                {/* Teclado */}
                <div className="px-4 pb-4 pt-3">
                    <div className="grid grid-cols-3 gap-2">
                        {DIGITS.map(d => (
                            <PinKey key={d} onPress={() => press(d)}>
                                {d}
                            </PinKey>
                        ))}
                        <PinKey onPress={clear} muted>C</PinKey>
                        <PinKey onPress={() => press("0")}>0</PinKey>
                        <PinKey onPress={backspace} muted>
                            <IconBackspace size={22} strokeWidth={2} />
                        </PinKey>
                    </div>
                </div>

                {/* Botón de acceso offline (visible siempre que esté permitido) */}
                {allowOfflineMode && onOfflineAccess && (
                    <div className="px-4 pb-5">
                        <button
                            onClick={handleOffline}
                            className="
                                w-full h-11 rounded-xl
                                bg-slate-100 hover:bg-slate-200
                                text-[12.5px] font-bold text-slate-700
                                flex items-center justify-center gap-2
                                active:scale-95 transition
                            "
                        >
                            <IconUser size={14} strokeWidth={2.2} />
                            Acceder sin PIN (modo offline)
                        </button>
                        {allowMasterPin && (
                            <div className="
                                mt-2 px-3 py-1.5 rounded-lg
                                bg-amber-50 border border-amber-200/80
                                text-[10.5px] text-amber-800
                                flex items-start gap-1.5
                            ">
                                <IconAlert size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                                <span>
                                    <strong>Primera instalación?</strong> Usa PIN{" "}
                                    <code className="px-1 bg-white rounded font-mono">1234</code>{" "}
                                    o <code className="px-1 bg-white rounded font-mono">0000</code>{" "}
                                    para crear un usuario de prueba.
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer con botón "Atrás" grande si hay cancel y no hay offline */}
                {onCancel && !allowOfflineMode && (
                    <div className="px-4 pb-5">
                        <button
                            onClick={onCancel}
                            className="
                                w-full h-11 rounded-xl
                                bg-slate-100 hover:bg-slate-200
                                text-[12.5px] font-bold text-slate-700
                                flex items-center justify-center gap-2
                                active:scale-95 transition
                            "
                        >
                            Volver atrás
                        </button>
                    </div>
                )}
            </div>

            {/* Animación de shake (inyectada en línea para no tocar globals.css) */}
            <style>{`
                @keyframes pinShake {
                    0%, 100% { transform: translateX(0); }
                    20%      { transform: translateX(-8px); }
                    40%      { transform: translateX(8px); }
                    60%      { transform: translateX(-6px); }
                    80%      { transform: translateX(6px); }
                }
            `}</style>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponente: tecla del PIN
// ---------------------------------------------------------------------

function PinKey({
    onPress, children, muted = false,
}: { onPress: () => void; children: ReactNode; muted?: boolean }) {
    return (
        <button
            onClick={onPress}
            className={`
                h-16 rounded-2xl
                text-2xl font-black tabular-nums
                transition select-none
                active:scale-95
                ${muted
                    ? "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-900 hover:bg-slate-100 active:bg-slate-200"
                }
            `}
        >
            {children}
        </button>
    );
}
