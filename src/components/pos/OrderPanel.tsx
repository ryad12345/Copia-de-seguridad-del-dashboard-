// =====================================================================
// MOZONA TPV — OrderPanel: columna central (comanda fiscal)
// =====================================================================
// ★ v1.9.73: SCROLL HÍBRIDO (gesto + botones) INFALIBLE EN TÁCTIL
//   - Scroll nativo optimizado (touch, momentum, momentum scrolling)
//   - Botones de scroll rápido (▲▼) más grandes y con salto de bloque
//   - Posicionamiento lateral, no intrusivos
//   - Soporte para mantener pulsado (mousedown/touchstart con auto-repeat)
// =====================================================================

import type { OrderItem } from "../../lib/types";
import { fmtEUR, fmtNum } from "../../lib/format";
import { IconMinus, IconPlus, IconX, IconReceipt } from "../icons";
import { useRef, useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface OrderPanelProps {
    items:        OrderItem[];
    tableLabel:   string | null;
    waiterName:   string | null;
    taxByRate:    Array<{ rate: number; base: number; tax: number; label: string }>;
    total:        number;
    itemCount:    number;
    onIncrement:  (id: string) => void;
    onDecrement:  (id: string) => void;
    onRemove:     (id: string) => void;
    onClear:      () => void;
    onPrintPreBill: () => void;
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function OrderPanel({
    items, tableLabel, waiterName,
    taxByRate, total, itemCount,
    onIncrement, onDecrement, onRemove, onClear, onPrintPreBill,
}: OrderPanelProps) {
    const itemsContainerRef = useRef<HTMLDivElement>(null);
    const [canScrollUp, setCanScrollUp] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const holdTimerRef = useRef<number | null>(null);
    const holdIntervalRef = useRef<number | null>(null);

    /**
     * ★ v1.9.73: SCROLL HÍBRIDO
     * - 'block': salto de 1 viewport (scroll completo)
     * - 'line':  salto pequeño (60px, para ajuste fino)
     * - 'start'/'end': ir al principio/final
     */
    const scrollItems = useCallback((direction: 'up' | 'down', mode: 'block' | 'line' = 'block') => {
        if (!itemsContainerRef.current) return;
        const el = itemsContainerRef.current;
        let amount = mode === 'block' ? el.clientHeight * 0.8 : 60;
        if (direction === 'up') amount = -amount;
        el.scrollBy({ top: amount, behavior: 'smooth' });
    }, []);

    const scrollToStart = useCallback(() => {
        itemsContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);
    const scrollToEnd = useCallback(() => {
        const el = itemsContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, []);

    // ★ v1.9.73: Auto-repeat al mantener pulsado el botón
    const startHold = useCallback((direction: 'up' | 'down') => {
        scrollItems(direction, 'line');
        holdTimerRef.current = window.setTimeout(() => {
            // Tras 400ms, repite cada 100ms con salto mayor
            holdIntervalRef.current = window.setInterval(() => {
                scrollItems(direction, 'line');
            }, 100);
        }, 400);
    }, [scrollItems]);

    const stopHold = useCallback(() => {
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
        if (holdIntervalRef.current) {
            clearInterval(holdIntervalRef.current);
            holdIntervalRef.current = null;
        }
    }, []);

    // ★ v1.9.73: Cleanup al desmontar
    useEffect(() => {
        return () => stopHold();
    }, [stopHold]);

    // ★ v1.9.73: Detecta si se puede hacer scroll (mostrar/ocultar botones)
    useEffect(() => {
        const el = itemsContainerRef.current;
        if (!el) return;
        const update = () => {
            setCanScrollUp(el.scrollTop > 4);
            setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
        };
        update();
        el.addEventListener("scroll", update, { passive: true });
        // Recalcular al cambiar items
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => {
            el.removeEventListener("scroll", update);
            ro.disconnect();
        };
    }, [items.length]);

    return (
        <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-sm min-h-0">
            {/* Cabecera compacta */}
            <header className="px-2.5 py-2.5 border-b border-slate-100 flex items-center gap-2 shrink-0">
                <div className="w-7 h-7 rounded-lg bg-slate-50 text-slate-700 flex items-center justify-center">
                    <IconReceipt size={15} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-[13px] font-bold text-slate-900 leading-tight truncate">
                        Comanda {tableLabel ? `· Mesa ${tableLabel.match(/\d+/)?.[0] ?? tableLabel}` : ""}
                    </h2>
                    <p className="text-[10px] text-slate-500 truncate">
                        {itemCount === 0
                            ? "Sin líneas"
                            : `${itemCount} ${itemCount === 1 ? "plato" : "platos"}`}
                        {waiterName && ` · ${waiterName}`}
                    </p>
                </div>
                {items.length > 0 && (
                    <button
                        onClick={onClear}
                        className="
                            px-2 h-7 rounded-lg
                            text-[10.5px] font-semibold
                            text-rose-600 hover:bg-rose-50
                            active:scale-95 transition
                        "
                    >
                        Vaciar
                    </button>
                )}
            </header>

            {/* ★ v1.9.73: Lista de líneas con scroll híbrido INFALIBLE
                 - Gestos táctiles nativos optimizados
                 - Botones de scroll rápido (mantener = auto-repeat) */}
            <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 relative
                            touch-pan-y overscroll-behavior-contain
                            [-webkit-overflow-scrolling:touch]">
                <div
                    ref={itemsContainerRef}
                    className="h-full"
                >
                    {items.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center">
                            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 mb-2">
                                <IconReceipt size={28} strokeWidth={1.4} />
                            </div>
                            {tableLabel ? (
                                <>
                                    <p className="text-[13px] font-semibold text-slate-700">
                                        Mesa {tableLabel.match(/\d+/)?.[0] ?? tableLabel} seleccionada
                                    </p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        Añade productos desde el catálogo
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-[13px] font-semibold text-slate-500">
                                        Añade productos desde el catálogo
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        Selecciona una mesa para empezar
                                    </p>
                                </>
                            )}
                        </div>
                    ) : (
                        <ul className="space-y-1.5">
                            {items.map(it => (
                                <OrderLine
                                    key={it.id}
                                    item={it}
                                    onIncrement={() => onIncrement(it.id)}
                                    onDecrement={() => onDecrement(it.id)}
                                    onRemove={() => onRemove(it.id)}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                {/* ★ v1.9.73: BOTONES DE SCROLL RÁPIDO HÍBRIDOS
                     - Más grandes (44x44px) para táctil
                     - Mantener pulsado = auto-repeat cada 100ms
                     - Tap simple = salto de bloque (80% viewport)
                     - Botones inicio/fin de lista */}
                {items.length > 3 && (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1 z-10">
                        <button
                            type="button"
                            aria-label="Ir al inicio de la comanda"
                            onClick={scrollToStart}
                            onTouchStart={(e) => { e.preventDefault(); scrollToStart(); }}
                            className="w-9 h-9 rounded-lg bg-slate-700/90 hover:bg-slate-800
                                       text-white text-[14px] font-black
                                       flex items-center justify-center
                                       shadow-md active:scale-90 transition
                                       touch-manipulation select-none"
                            title="Inicio"
                        >
                            ⤒
                        </button>
                        <button
                            type="button"
                            aria-label="Desplazar arriba (mantener para auto-repetir)"
                            onClick={() => scrollItems('up', 'block')}
                            onMouseDown={() => startHold('up')}
                            onMouseUp={stopHold}
                            onMouseLeave={stopHold}
                            onTouchStart={(e) => { e.preventDefault(); startHold('up'); }}
                            onTouchEnd={stopHold}
                            onTouchCancel={stopHold}
                            disabled={!canScrollUp}
                            className="w-9 h-9 rounded-lg bg-blue-600/95 hover:bg-blue-700
                                       text-white text-[16px] font-black
                                       flex items-center justify-center
                                       shadow-md active:scale-90 transition
                                       touch-manipulation select-none
                                       disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Arriba (mantener para auto-repetir)"
                        >
                            ▲
                        </button>
                        <button
                            type="button"
                            aria-label="Desplazar abajo (mantener para auto-repetir)"
                            onClick={() => scrollItems('down', 'block')}
                            onMouseDown={() => startHold('down')}
                            onMouseUp={stopHold}
                            onMouseLeave={stopHold}
                            onTouchStart={(e) => { e.preventDefault(); startHold('down'); }}
                            onTouchEnd={stopHold}
                            onTouchCancel={stopHold}
                            disabled={!canScrollDown}
                            className="w-9 h-9 rounded-lg bg-blue-600/95 hover:bg-blue-700
                                       text-white text-[16px] font-black
                                       flex items-center justify-center
                                       shadow-md active:scale-90 transition
                                       touch-manipulation select-none
                                       disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Abajo (mantener para auto-repetir)"
                        >
                            ▼
                        </button>
                        <button
                            type="button"
                            aria-label="Ir al final de la comanda"
                            onClick={scrollToEnd}
                            onTouchStart={(e) => { e.preventDefault(); scrollToEnd(); }}
                            className="w-9 h-9 rounded-lg bg-slate-700/90 hover:bg-slate-800
                                       text-white text-[14px] font-black
                                       flex items-center justify-center
                                       shadow-md active:scale-90 transition
                                       touch-manipulation select-none"
                            title="Final"
                        >
                            ⤓
                        </button>
                    </div>
                )}

                {/* Indicador de posición (línea fina lateral) */}
                {items.length > 8 && (canScrollUp || canScrollDown) && (
                    <div className="absolute left-0.5 top-0 bottom-0 w-1 bg-slate-200/60 rounded-full overflow-hidden">
                        <div
                            className="absolute left-0 right-0 bg-blue-500/70 rounded-full transition-all duration-200"
                            style={{
                                top: `${(itemsContainerRef.current?.scrollTop ?? 0) /
                                       Math.max(1, (itemsContainerRef.current?.scrollHeight ?? 1) -
                                                  (itemsContainerRef.current?.clientHeight ?? 1)) * 100}%`,
                                height: `${((itemsContainerRef.current?.clientHeight ?? 1) /
                                            Math.max(1, itemsContainerRef.current?.scrollHeight ?? 1)) * 100}%`,
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Footer compacto con totales + acción de pre-cuenta */}
            <footer className="border-t border-slate-100 px-2.5 py-2.5 shrink-0 space-y-1">
                <div className="space-y-0.5">
                    {taxByRate.map(t => (
                        <div key={t.rate} className="flex justify-between text-[9px] text-slate-600">
                            <span>Subtotal {t.label} ({t.rate}%)</span>
                            <span className="tabular-nums">{fmtEUR(t.base)}</span>
                        </div>
                    ))}
                    {taxByRate.map(t => (
                        <div key={`tax-${t.rate}`} className="flex justify-between text-[9px] text-slate-600">
                            <span>IVA {t.rate}%</span>
                            <span className="tabular-nums">{fmtEUR(t.tax)}</span>
                        </div>
                    ))}
                </div>
                <div className="flex items-end justify-between pt-0.5 border-t border-slate-100">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                        Total
                    </span>
                    <span className="text-[18px] font-black text-slate-900 tabular-nums leading-none">
                        {fmtEUR(total)}
                    </span>
                </div>
                <button
                    onClick={onPrintPreBill}
                    disabled={items.length === 0}
                    className="
                        w-full h-7 rounded-lg
                        bg-amber-50 text-amber-800 border border-amber-200/80
                        text-[9px] font-bold
                        disabled:opacity-40 disabled:cursor-not-allowed
                        hover:bg-amber-100 active:scale-95 transition
                    "
                >
                    🧾 Pre-cuenta
                </button>
            </footer>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponente: línea de pedido
// ---------------------------------------------------------------------

function OrderLine({
    item, onIncrement, onDecrement, onRemove,
}: {
    item: OrderItem;
    onIncrement: () => void;
    onDecrement: () => void;
    onRemove:    () => void;
}) {
    const lineTotal = item.unit_price * item.quantity;
    return (
        <li className="group bg-slate-50 rounded-xl p-2 hover:bg-slate-100/80 transition">
            <div className="flex items-start gap-2">
                {/* Controles de cantidad */}
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                    <button
                        onClick={onIncrement}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 active:scale-90 transition"
                    >
                        <IconPlus size={12} strokeWidth={2.4} />
                    </button>
                    <span className="text-[13px] font-black tabular-nums text-slate-900 w-6 text-center">
                        {item.quantity}
                    </span>
                    <button
                        onClick={onDecrement}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-rose-50 hover:text-rose-600 active:scale-90 transition"
                    >
                        <IconMinus size={12} strokeWidth={2.4} />
                    </button>
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="text-[13px] font-semibold text-slate-900 leading-tight line-clamp-2 min-w-0">
                            {item.name}
                        </div>
                        <button
                            onClick={onRemove}
                            className="shrink-0 w-5 h-5 rounded text-slate-300 hover:text-rose-500 transition opacity-0 group-hover:opacity-100"
                        >
                            <IconX size={14} strokeWidth={2.4} />
                        </button>
                    </div>
                    <div className="flex items-baseline justify-between mt-0.5">
                        <span className="text-[10.5px] text-slate-500">
                            {fmtNum(item.unit_price)} € · IVA {item.tax_rate}%
                        </span>
                        <span className="text-[14px] font-black text-slate-900 tabular-nums">
                            {fmtEUR(lineTotal)}
                        </span>
                    </div>
                </div>
            </div>
        </li>
    );
}
