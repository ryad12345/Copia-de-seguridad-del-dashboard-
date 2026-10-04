// =====================================================================
// MOZONA TPV — TicketCanvas (v3.4.5)
// =====================================================================
// Editor visual tipo Canva para tickets térmicos.
// Drag & drop, click para editar, persistencia por tenant.
// =====================================================================

import { useRef, useState, useCallback, useEffect, type ReactNode, type MouseEvent as RM, type TouchEvent as RT } from "react";
import type { TicketElement, TicketElementType } from "../hooks/useTenantSettings";

interface TicketCanvasProps {
    layout: TicketElement[];
    onChange: (layout: TicketElement[]) => void;
    paperWidth: 48 | 58 | 80;
    sampleData: {
        id: string;
        date: string;
        time: string;
        table: string;
        waiter: string;
        payment: string;
        lines: Array<{ name: string; qty: number; price: number; total: number }>;
        subtotal: number;
        vat: number;
        total: number;
    };
    readOnly?: boolean;
}

const COLORS = {
    border: "#cbd5e1",
    selected: "#3b82f6",
    handle: "#2563eb",
    ghost: "rgba(59, 130, 246, 0.08)",
};

export function TicketCanvas({ layout, onChange, paperWidth, sampleData, readOnly }: TicketCanvasProps) {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<{
        id: string;
        startX: number;
        startY: number;
        elemX: number;
        elemY: number;
    } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const pxPerPercent = (paperWidth === 48 ? 180 : paperWidth === 58 ? 220 : 300) / 100;

    // ★ Mover elemento
    const handleMove = useCallback((clientX: number, clientY: number) => {
        if (!dragState || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const dx = ((clientX - dragState.startX) / rect.width) * 100;
        const dy = ((clientY - dragState.startY) / rect.height) * 100;
        const newX = Math.max(0, Math.min(100 - dragState.elemX, dragState.elemX + dx));
        const newY = Math.max(0, Math.min(100, dragState.elemY + dy));
        onChange(layout.map(e => e.id === dragState.id ? { ...e, x: newX, y: newY } : e));
    }, [dragState, layout, onChange]);

    // ★ Mouse handlers
    const onMouseDown = (e: RM<HTMLDivElement>, el: TicketElement) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(el.id);
        if (el.type === "text") {
            setEditingId(el.id);
            return;
        }
        setDragState({
            id: el.id,
            startX: e.clientX,
            startY: e.clientY,
            elemX: el.x,
            elemY: el.y,
        });
    };

    useEffect(() => {
        if (!dragState) return;
        const onMove = (e: MouseEvent) => {
            e.preventDefault();
            handleMove(e.clientX, e.clientY);
        };
        const onUp = () => setDragState(null);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [dragState, handleMove]);

    // ★ Touch handlers
    const onTouchStart = (e: RT<HTMLDivElement>, el: TicketElement) => {
        if (readOnly) return;
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        setSelectedId(el.id);
        if (el.type === "text") {
            setEditingId(el.id);
            return;
        }
        setDragState({
            id: el.id,
            startX: t.clientX,
            startY: t.clientY,
            elemX: el.x,
            elemY: el.y,
        });
    };

    useEffect(() => {
        if (!dragState) return;
        const onMove = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        };
        const onUp = () => setDragState(null);
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onUp);
        return () => {
            window.removeEventListener("touchmove", onMove);
            window.removeEventListener("touchend", onUp);
        };
    }, [dragState, handleMove]);

    // ★ Click en canvas deselecciona
    const onCanvasClick = (e: RM<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            setSelectedId(null);
            setEditingId(null);
        }
    };

    // ★ Editar texto inline
    const updateText = (id: string, content: string) => {
        onChange(layout.map(e => e.id === id ? { ...e, content } : e));
    };

    return (
        <div
            ref={canvasRef}
            onClick={onCanvasClick}
            className="relative bg-white shadow-lg mx-auto"
            style={{
                width: paperWidth === 48 ? "180px" : paperWidth === 58 ? "220px" : "300px",
                minHeight: "420px",
                border: `1px solid ${COLORS.border}`,
                fontFamily: "'Courier New', monospace",
                fontWeight: 800,
                userSelect: dragState ? "none" : "auto",
            }}
        >
            {/* Líneas guía de cuadrícula (sutiles) */}
            <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(0,0,0,0.04) 19px, rgba(0,0,0,0.04) 20px)",
            }} />

            {layout.filter(e => e.visible).map(el => (
                <CanvasElement
                    key={el.id}
                    el={el}
                    selected={selectedId === el.id}
                    editing={editingId === el.id}
                    sampleData={sampleData}
                    onMouseDown={(e) => onMouseDown(e, el)}
                    onTouchStart={(e) => onTouchStart(e, el)}
                    onUpdateText={(txt) => updateText(el.id, txt)}
                    onStopEditing={() => setEditingId(null)}
                    pxPerPercent={pxPerPercent}
                />
            ))}

            {layout.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">
                    Lienzo vacío. Añade un elemento.
                </div>
            )}
        </div>
    );
}

// =====================================================================
// CanvasElement
// =====================================================================

interface CanvasElementProps {
    el: TicketElement;
    selected: boolean;
    editing: boolean;
    sampleData: TicketCanvasProps["sampleData"];
    onMouseDown: (e: RM<HTMLDivElement>) => void;
    onTouchStart: (e: RT<HTMLDivElement>) => void;
    onUpdateText: (txt: string) => void;
    onStopEditing: () => void;
    pxPerPercent: number;
}

function CanvasElement({ el, selected, editing, sampleData, onMouseDown, onTouchStart, onUpdateText, onStopEditing, pxPerPercent }: CanvasElementProps) {
    const renderContent = (): ReactNode => {
        if (el.type === "text") {
            if (editing) {
                return (
                    <input
                        type="text"
                        autoFocus
                        defaultValue={el.content}
                        onBlur={(e) => { onUpdateText(e.target.value); onStopEditing(); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") { onUpdateText((e.target as HTMLInputElement).value); onStopEditing(); }
                            if (e.key === "Escape") onStopEditing();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-full bg-yellow-50 border border-blue-400 outline-none text-center"
                        style={{ fontSize: `${el.fontSize || 11}px`, fontWeight: el.fontWeight || 800, textAlign: el.align || "left" }}
                    />
                );
            }
            return <div style={{ textAlign: el.align || "left" }}>{el.content || "(texto)"}</div>;
        }

        if (el.type === "logo") {
            if (!el.src) {
                return (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-[10px] border-2 border-dashed border-slate-300">
                        Subir logo
                    </div>
                );
            }
            return <img src={el.src} alt="logo" className="w-full h-full object-contain pointer-events-none" />;
        }

        if (el.type === "block_info") {
            const fields = el.fields || ["id", "date", "time", "table"];
            return (
                <div className="text-[9.5px] leading-tight">
                    {fields.includes("id") && <div>Ticket: {sampleData.id}</div>}
                    {fields.includes("date") && <div>Fecha: {sampleData.date}</div>}
                    {fields.includes("time") && <div>Hora: {sampleData.time}</div>}
                    {fields.includes("table") && <div>Mesa: {sampleData.table}</div>}
                    {fields.includes("waiter") && <div>Camarero: {sampleData.waiter}</div>}
                    {fields.includes("payment") && <div>Pago: {sampleData.payment}</div>}
                </div>
            );
        }

        if (el.type === "block_lines") {
            return (
                <div className="text-[9.5px] leading-tight">
                    {sampleData.lines.map((l, i) => (
                        <div key={i} className="flex justify-between">
                            <span>{l.qty}x {l.name}</span>
                            <span>{l.total.toFixed(2)}€</span>
                        </div>
                    ))}
                </div>
            );
        }

        if (el.type === "block_totals") {
            return (
                <div className="text-[9.5px] leading-tight">
                    <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>{sampleData.subtotal.toFixed(2)}€</span>
                    </div>
                    <div className="flex justify-between">
                        <span>IVA (10%):</span>
                        <span>{sampleData.vat.toFixed(2)}€</span>
                    </div>
                    <div className="flex justify-between font-black border-t border-black mt-0.5 pt-0.5">
                        <span>TOTAL:</span>
                        <span>{sampleData.total.toFixed(2)}€</span>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <div
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onClick={(e) => e.stopPropagation()}
            className="absolute"
            style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                border: selected ? `2px solid ${COLORS.selected}` : "1px dashed transparent",
                background: selected ? COLORS.ghost : "transparent",
                cursor: editing ? "text" : "move",
                fontSize: el.type === "text" ? `${el.fontSize || 11}px` : undefined,
                fontWeight: el.fontWeight || 800,
                overflow: "hidden",
                boxSizing: "border-box",
                padding: "1px",
            }}
        >
            {renderContent()}

            {selected && (
                <>
                    {/* Handles de resize (esquinas) */}
                    {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
                        <ResizeHandle key={pos} el={el} corner={pos} layout={undefined} onChange={undefined} />
                    ))}
                </>
            )}
        </div>
    );
}

// ★ Handles de resize (placeholder simplificado)
function ResizeHandle({ el, corner }: { el: TicketElement; corner: string; layout: any; onChange: any }) {
    const styles: Record<string, React.CSSProperties> = {
        "top-left":     { top: -4, left: -4, cursor: "nwse-resize" },
        "top-right":    { top: -4, right: -4, cursor: "nesw-resize" },
        "bottom-left":  { bottom: -4, left: -4, cursor: "nesw-resize" },
        "bottom-right": { bottom: -4, right: -4, cursor: "nwse-resize" },
    };
    return (
        <div
            style={{
                position: "absolute",
                width: 8, height: 8,
                background: COLORS.handle,
                border: "1px solid white",
                borderRadius: 1,
                ...styles[corner],
            }}
        />
    );
}

// ★ Elemento de paleta
export function ElementPalette({ onAdd }: { onAdd: (type: TicketElementType) => void }) {
    return (
        <div className="grid grid-cols-2 gap-2">
            {([
                { type: "text" as const,        label: "📝 Texto",        desc: "Cabecera, pie, etc." },
                { type: "logo" as const,        label: "🖼️ Logo",         desc: "Imagen de empresa" },
                { type: "block_info" as const,  label: "ℹ️ Info",         desc: "ID, fecha, mesa…" },
                { type: "block_lines" as const, label: "📋 Productos",    desc: "Líneas del ticket" },
                { type: "block_totals" as const,label: "💰 Totales",      desc: "Subtotal, IVA, total" },
            ]).map(item => (
                <button
                    key={item.type}
                    onClick={() => onAdd(item.type)}
                    className="h-16 px-2 rounded-lg border-2 border-slate-200 hover:border-blue-400 bg-white text-left transition"
                >
                    <div className="text-[12px] font-bold text-slate-800">{item.label}</div>
                    <div className="text-[10px] text-slate-500">{item.desc}</div>
                </button>
            ))}
        </div>
    );
}
