// =====================================================================
// MOZONA TPV — TenantSettingsPage (v3.4.5)
// =====================================================================
// Editor visual tipo Canva + temas persistentes
//   - Drag & drop de elementos del ticket
//   - Subir logo redimensionable
//   - Editor inline de textos
//   - Persistencia en Supabase por tenant
// =====================================================================

import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSession } from "../hooks/useActiveSession";
import {
    useTenantSettings,
    DEFAULT_TENANT_SETTINGS,
    DEFAULT_TICKET_LAYOUT,
    type TenantSettings,
    type TicketElement,
    type TicketElementType,
} from "../hooks/useTenantSettings";
import { useTheme } from "../context/ThemeContext";
import { TicketCanvas, ElementPalette } from "../components/TicketCanvas";
import { IconShield, IconCheck, IconArrowLeft, IconTrash, IconDuplicate } from "../components/icons";
import { compressImage, saveLogo, loadLogo, clearLogo, logoSizeKB, isValidLogoDataUrl } from "../lib/logoStorage";

const SAMPLE_DATA = {
    id: "T-00042",
    date: "10/09/2026",
    time: "21:45",
    table: "5",
    waiter: "Juan",
    payment: "Efectivo",
    lines: [
        { name: "Tajin carne", qty: 1, price: 8.0, total: 8.0 },
        { name: "Pan", qty: 1, price: 1.0, total: 1.0 },
        { name: "Coca-Cola", qty: 2, price: 2.5, total: 5.0 },
    ],
    subtotal: 12.73,
    vat: 1.27,
    total: 14.0,
};

export function TenantSettingsPage() {
    const navigate = useNavigate();
    const session = useActiveSession();
    const { settings, saving, save, error } = useTenantSettings();
    const { isDark } = useTheme();
    const [localSettings, setLocalSettings] = useState<TenantSettings>(settings);
    const [savedOk, setSavedOk] = useState(false);

    useEffect(() => {
        if (session.isReady && !session.isAuthenticated) {
            navigate("/auth", { replace: true });
        }
    }, [session.isReady, session.isAuthenticated, navigate]);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    // ★ Layout (asegurar default si está vacío)
    // ★ v4.0.7-tenant-replace: inyecta datos REALES del tenant en lugar de "MI RESTAURANTE"
    const layout: TicketElement[] = useMemo(() => {
        let baseLayout: TicketElement[];
        if (localSettings.ticket_layout_json && Array.isArray(localSettings.ticket_layout_json) && localSettings.ticket_layout_json.length > 0) {
            baseLayout = localSettings.ticket_layout_json;
        } else {
            baseLayout = JSON.parse(JSON.stringify(DEFAULT_TICKET_LAYOUT));
        }

        // ★ Reemplazar textos genéricos con datos REALES del tenant
        const tenantName = (settings as any)?.tenant?.name || "Restaurante";

        return baseLayout.map(el => {
            if (el.type !== "text") return el;
            const content = (el.content || "").trim();
            // Reemplazar textos genéricos hardcoded
            if (content === "MI RESTAURANTE" || content === "RESTAURANT NAME" || content === "") {
                return { ...el, content: tenantName };
            }
            return el;
        });
    }, [localSettings.ticket_layout_json, settings]);

    const updateLayout = useCallback((newLayout: TicketElement[]) => {
        setLocalSettings(prev => ({ ...prev, ticket_layout_json: newLayout }));
    }, []);

    // ★ Añadir elemento
    const addElement = (type: TicketElementType) => {
        const id = `${type}-${Date.now()}`;
        const yOffset = layout.length * 8;
        const newEl: TicketElement = {
            id,
            type,
            x: 5,
            y: Math.min(95, yOffset),
            w: type === "logo" ? 30 : 90,
            h: type === "logo" ? 14 : type === "block_lines" ? 30 : 8,
            visible: true,
        };
        if (type === "text") {
            newEl.content = "Nuevo texto";
            newEl.fontSize = 12;
            newEl.fontWeight = 800;
            newEl.align = "center";
        } else if (type === "block_info") {
            newEl.fields = ["id", "date", "time"];
        }
        updateLayout([...layout, newEl]);
    };

    // ★ Eliminar elemento
    const removeElement = (id: string) => {
        updateLayout(layout.filter(e => e.id !== id));
    };

    // ★ Duplicar
    const duplicateElement = (id: string) => {
        const el = layout.find(e => e.id === id);
        if (!el) return;
        const copy: TicketElement = { ...el, id: `${el.id}-copy-${Date.now()}`, x: Math.min(95, el.x + 3), y: Math.min(95, el.y + 3) };
        updateLayout([...layout, copy]);
    };

    // ★ Toggle visibility
    const toggleVisibility = (id: string) => {
        updateLayout(layout.map(e => e.id === id ? { ...e, visible: !e.visible } : e));
    };

    // ★ v4.0.7-logo-fix: Subir logo con compresión + persistencia robusta
    const [logoBusy, setLogoBusy] = useState(false);
    const [logoError, setLogoError] = useState<string | null>(null);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            setLogoError("Selecciona un archivo de imagen válido.");
            return;
        }
        if (file.size > 4 * 1024 * 1024) {
            setLogoError("Imagen demasiado grande (>4MB). Usa una imagen más pequeña.");
            return;
        }

        setLogoBusy(true);
        setLogoError(null);
        try {
            // Comprimir a <100KB antes de guardar
            const dataUrl = await compressImage(file, 100 * 1024, 400);

            // Validar antes de persistir
            if (!isValidLogoDataUrl(dataUrl)) {
                throw new Error("La imagen comprimida no es válida");
            }

            // Persistir con manejo de cuota
            const result = saveLogo(dataUrl);
            if (!result.ok) {
                throw new Error(result.error || "No se pudo guardar el logo");
            }

            // Actualizar el layout (estado visual)
            const existingLogo = layout.find(e => e.type === "logo");
            if (existingLogo) {
                updateLayout(layout.map(el => el.type === "logo" ? { ...el, src: dataUrl, visible: true } : el));
            } else {
                const logoEl: TicketElement = {
                    id: `logo-${Date.now()}`,
                    type: "logo",
                    x: 35, y: 0, w: 30, h: 14,
                    visible: true,
                    src: dataUrl,
                };
                updateLayout([logoEl, ...layout]);
            }

            // Limpia el input file para permitir re-subir el mismo archivo
            e.target.value = "";
        } catch (err: any) {
            setLogoError(err?.message || "Error al procesar el logo");
        } finally {
            setLogoBusy(false);
        }
    };

    // ★ v4.0.7-logo-fix: Eliminar logo (limpia storage + layout)
    const handleLogoRemove = () => {
        clearLogo();
        updateLayout(layout.map(el => el.type === "logo" ? { ...el, src: "", visible: false } : el));
        setLogoError(null);
    };

    // ★ v4.0.7-logo-fix: Restaurar logo desde localStorage al montar
    useEffect(() => {
        const persistedLogo = loadLogo();
        if (!persistedLogo) return;
        // Solo restaura si el layout no tiene ya un logo válido
        const existing = layout.find(e => e.type === "logo");
        if (existing && isValidLogoDataUrl(existing.src)) return;
        if (existing) {
            updateLayout(layout.map(el => el.type === "logo" ? { ...el, src: persistedLogo, visible: true } : el));
        } else {
            updateLayout([
                { id: `logo-${Date.now()}`, type: "logo", x: 35, y: 0, w: 30, h: 14, visible: true, src: persistedLogo },
                ...layout,
            ]);
        }
        // Solo restaurar una vez al montar
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const updateSelected = (id: string, patch: Partial<TicketElement>) => {
        updateLayout(layout.map(e => e.id === id ? { ...e, ...patch } : e));
    };

    const handleSave = async () => {
        const ok = await save(localSettings);
        if (ok) setSavedOk(true);
        setTimeout(() => setSavedOk(false), 3000);
    };

    const update = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    if (!session.isReady) {
        return <div className="p-8 text-center text-slate-500">Cargando...</div>;
    }
    if (!session.isAuthenticated) {
        return <div className="p-8 text-center text-slate-500">Redirigiendo al login...</div>;
    }

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = layout.find(e => e.id === selectedId) || null;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-5">
            <div className="max-w-7xl mx-auto space-y-3">
                {/* Cabecera */}
                <div className="bg-gradient-to-br from-blue-600 via-violet-600 to-blue-700 rounded-2xl shadow-xl p-4 text-white">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <IconShield size={28} />
                            <div>
                                <h1 className="text-xl font-black">Personalización</h1>
                                <p className="text-[11.5px] text-blue-100">
                                    Editor visual de tickets + temas · {session.email}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => navigate("/settings")}
                                className="h-9 px-3 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[12px] font-bold flex items-center gap-1"
                            >
                                <IconArrowLeft size={12} /> Volver a Configuración
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-400 text-white text-[12px] font-black flex items-center gap-1.5"
                            >
                                {saving ? "Guardando..." : <><IconCheck size={12} /> Guardar</>}
                            </button>
                        </div>
                    </div>
                </div>

                {savedOk && (
                    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-3 flex items-center gap-2">
                        <IconCheck size={16} className="text-emerald-600" />
                        <span className="text-[12.5px] text-emerald-900 font-semibold">Configuración guardada correctamente</span>
                    </div>
                )}
                {error && (
                    <div className="bg-rose-50 border-2 border-rose-200 rounded-xl p-3">
                        <span className="text-[12.5px] text-rose-900 font-semibold">❌ {error}</span>
                    </div>
                )}

                {/* ★ v4.0.7-modo-offline: aviso sutil si no hay conexión con backend */}
                {saving && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 text-center">
                        <span className="text-[11px] text-slate-600 font-medium">Guardando en local...</span>
                    </div>
                )}

                {/* ★ EDITOR CANVAS + PALETA + PROPIEDADES */}
                <div className="grid grid-cols-12 gap-3">
                    {/* Paleta */}
                    <div className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow p-4 space-y-3">
                        <h2 className="text-[12px] font-black uppercase tracking-widest text-slate-600">Elementos</h2>
                        <ElementPalette onAdd={addElement} />

                        <div className="pt-2 border-t border-slate-200">
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-widest">Ancho del rollo</label>
                            <div className="grid grid-cols-3 gap-2 mt-2">
                                {([
                                    { v: 48 as const, l: "48mm" },
                                    { v: 58 as const, l: "58mm" },
                                    { v: 80 as const, l: "80mm" },
                                ]).map(p => (
                                    <button
                                        key={p.v}
                                        onClick={() => update("ticket_paper_width", p.v)}
                                        className={`h-9 rounded-lg text-[12px] font-bold border-2 transition ${
                                            localSettings.ticket_paper_width === p.v
                                                ? "bg-blue-600 text-white border-blue-600"
                                                : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                                        }`}
                                    >
                                        {p.l}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-widest">Logo del ticket</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleLogoUpload}
                                disabled={logoBusy}
                                className="block w-full mt-2 text-[11px] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-bold disabled:opacity-50"
                            />
                            {logoBusy && (
                                <p className="mt-1 text-[10px] text-blue-600 font-medium">Comprimiendo imagen...</p>
                            )}
                            {logoError && (
                                <p className="mt-1 text-[10px] text-rose-600 font-semibold">⚠ {logoError}</p>
                            )}
                            {(() => {
                                const existingLogo = layout.find(e => e.type === "logo");
                                if (existingLogo && isValidLogoDataUrl(existingLogo.src)) {
                                    const size = logoSizeKB(existingLogo.src);
                                    return (
                                        <div className="mt-1 flex items-center justify-between">
                                            <p className="text-[10px] text-emerald-600 font-medium">✓ Logo guardado ({size} KB)</p>
                                            <button
                                                type="button"
                                                onClick={handleLogoRemove}
                                                className="text-[10px] text-rose-600 hover:text-rose-800 font-bold underline"
                                            >
                                                Quitar
                                            </button>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>

                        <div className="pt-2 border-t border-slate-200 text-[10.5px] text-slate-500">
                            <strong>Tip:</strong> Arrastra cualquier elemento del ticket para recolocarlo. Haz clic en un texto para editarlo.
                        </div>
                    </div>

                    {/* Canvas */}
                    <div className="col-span-12 lg:col-span-6 bg-slate-200 rounded-2xl p-6 flex items-start justify-center overflow-auto">
                        <div
                            onClick={() => setSelectedId(null)}
                            className="w-full"
                        >
                            <div onClick={(e) => e.stopPropagation()}>
                                <TicketCanvas
                                    layout={layout}
                                    onChange={updateLayout}
                                    paperWidth={localSettings.ticket_paper_width}
                                    sampleData={SAMPLE_DATA}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Propiedades */}
                    <div className="col-span-12 lg:col-span-3 bg-white rounded-2xl shadow p-4 space-y-3">
                        <h2 className="text-[12px] font-black uppercase tracking-widest text-slate-600">Propiedades</h2>
                        {selected ? (
                            <ElementProperties
                                el={selected}
                                onChange={(patch) => updateSelected(selected.id, patch)}
                                onDelete={() => removeElement(selected.id)}
                                onDuplicate={() => duplicateElement(selected.id)}
                                onToggleVisible={() => toggleVisibility(selected.id)}
                            />
                        ) : (
                            <div className="text-[11.5px] text-slate-500 p-3 rounded-lg bg-slate-50">
                                Selecciona un elemento del ticket para editar sus propiedades.
                            </div>
                        )}

                        <div className="pt-2 border-t border-slate-200">
                            <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-widest mb-2">Elementos ({layout.length})</h3>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {layout.map(el => (
                                    <button
                                        key={el.id}
                                        onClick={() => setSelectedId(el.id)}
                                        className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-1.5 ${
                                            selectedId === el.id ? "bg-blue-100 text-blue-900" : "hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        <span>{el.type === "text" ? "📝" : el.type === "logo" ? "🖼️" : el.type === "block_info" ? "ℹ️" : el.type === "block_lines" ? "📋" : "💰"}</span>
                                        <span className="flex-1 truncate">{el.content || el.id.split("-")[0]}</span>
                                        <span onClick={(e) => { e.stopPropagation(); toggleVisibility(el.id); }} className="text-slate-400 hover:text-slate-700">
                                            {el.visible ? "👁️" : "🚫"}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ★ TEMA */}
                <div className="bg-white rounded-2xl shadow p-4 space-y-3">
                    <h2 className="text-[12px] font-black uppercase tracking-widest text-slate-600">Tema y estilo</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                        <SelectBox label="Modo" value={localSettings.theme_mode} onChange={v => update("theme_mode", v as any)} options={[
                            { v: "light", l: "☀️ Claro" },
                            { v: "dark",  l: "🌙 Oscuro" },
                            { v: "auto",  l: "⚙️ Auto" },
                        ]} />
                        <div>
                            <Label>Color acento</Label>
                            <div className="grid grid-cols-5 gap-1 mt-1.5">
                                {[
                                    { v: "blue",   c: "#2563eb" },
                                    { v: "green",  c: "#16a34a" },
                                    { v: "orange", c: "#ea580c" },
                                    { v: "red",    c: "#dc2626" },
                                    { v: "violet", c: "#7c3aed" },
                                ].map(a => (
                                    <button
                                        key={a.v}
                                        onClick={() => update("theme_accent", a.v as any)}
                                        className={`h-8 rounded-lg border-2 ${localSettings.theme_accent === a.v ? "border-slate-900 scale-110" : "border-slate-200"}`}
                                        style={{ background: a.c }}
                                    />
                                ))}
                            </div>
                        </div>
                        <SelectBox label="Contraste" value={localSettings.theme_contrast} onChange={v => update("theme_contrast", v as any)} options={[
                            { v: "normal", l: "Normal" },
                            { v: "high", l: "Alto" },
                        ]} />
                        <SelectBox label="Botones" value={localSettings.button_size} onChange={v => update("button_size", v as any)} options={[
                            { v: "sm", l: "Pequeño" },
                            { v: "md", l: "Mediano" },
                            { v: "lg", l: "Grande" },
                        ]} />
                        <SelectBox label="Densidad" value={localSettings.grid_density} onChange={v => update("grid_density", v as any)} options={[
                            { v: "compact", l: "Compacto" },
                            { v: "normal", l: "Normal" },
                            { v: "comfortable", l: "Cómodo" },
                        ]} />
                        <SelectBox label="Layout" value={localSettings.panel_layout} onChange={v => update("panel_layout", v as any)} options={[
                            { v: "horizontal", l: "Horizontal" },
                            { v: "vertical", l: "Vertical" },
                        ]} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-widest">{children}</label>;
}

function SelectBox({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ v: string; l: string }> }) {
    return (
        <div>
            <Label>{label}</Label>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full h-9 mt-1.5 px-2 rounded-lg border border-slate-300 text-[12px]"
            >
                {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
        </div>
    );
}

function ElementProperties({ el, onChange, onDelete, onDuplicate, onToggleVisible }: {
    el: TicketElement;
    onChange: (patch: Partial<TicketElement>) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onToggleVisible: () => void;
}) {
    return (
        <div className="space-y-2 text-[12px]">
            <div className="text-[10.5px] font-bold text-slate-500 uppercase tracking-widest">Tipo: {el.type}</div>

            {el.type === "text" && (
                <>
                    <div>
                        <Label>Contenido</Label>
                        <input
                            type="text"
                            value={el.content || ""}
                            onChange={e => onChange({ content: e.target.value })}
                            className="w-full h-8 mt-1 px-2 rounded border border-slate-300 text-[12px]"
                        />
                    </div>
                    <div>
                        <Label>Tamaño fuente ({el.fontSize}px)</Label>
                        <input
                            type="range" min="7" max="20" value={el.fontSize || 11}
                            onChange={e => onChange({ fontSize: Number(e.target.value) })}
                            className="w-full mt-1"
                        />
                    </div>
                    <div>
                        <Label>Alineación</Label>
                        <div className="grid grid-cols-3 gap-1 mt-1">
                            {(["left", "center", "right"] as const).map(a => (
                                <button
                                    key={a}
                                    onClick={() => onChange({ align: a })}
                                    className={`h-7 rounded text-[10px] font-bold ${el.align === a ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
                                >
                                    {a === "left" ? "←" : a === "center" ? "↔" : "→"}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {el.type === "block_info" && (
                <div>
                    <Label>Campos visibles</Label>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                        {([
                            ["id", "ID"],
                            ["date", "Fecha"],
                            ["time", "Hora"],
                            ["table", "Mesa"],
                            ["waiter", "Camarero"],
                            ["payment", "Pago"],
                        ] as const).map(([k, l]) => (
                            <label key={k} className="flex items-center gap-1 text-[11px]">
                                <input
                                    type="checkbox"
                                    checked={el.fields?.includes(k as any) || false}
                                    onChange={e => {
                                        const fields = el.fields || [];
                                        const next = e.target.checked
                                            ? [...fields, k]
                                            : fields.filter(f => f !== k);
                                        onChange({ fields: next as any });
                                    }}
                                    className="w-3 h-3"
                                />
                                {l}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <Label>Posición</Label>
                <div className="grid grid-cols-2 gap-1 mt-1 text-[10.5px]">
                    <input
                        type="number" min="0" max="100"
                        value={Math.round(el.x)}
                        onChange={e => onChange({ x: Number(e.target.value) })}
                        className="h-7 px-1.5 rounded border border-slate-300"
                        placeholder="X %"
                    />
                    <input
                        type="number" min="0" max="100"
                        value={Math.round(el.y)}
                        onChange={e => onChange({ y: Number(e.target.value) })}
                        className="h-7 px-1.5 rounded border border-slate-300"
                        placeholder="Y %"
                    />
                </div>
            </div>

            <div>
                <Label>Tamaño (W × H %)</Label>
                <div className="grid grid-cols-2 gap-1 mt-1 text-[10.5px]">
                    <input
                        type="number" min="5" max="100"
                        value={Math.round(el.w)}
                        onChange={e => onChange({ w: Number(e.target.value) })}
                        className="h-7 px-1.5 rounded border border-slate-300"
                    />
                    <input
                        type="number" min="3" max="100"
                        value={Math.round(el.h)}
                        onChange={e => onChange({ h: Number(e.target.value) })}
                        className="h-7 px-1.5 rounded border border-slate-300"
                    />
                </div>
            </div>

            <div className="flex gap-1 pt-2 border-t border-slate-200">
                <button
                    onClick={onToggleVisible}
                    className="flex-1 h-8 rounded bg-slate-100 hover:bg-slate-200 text-[11px] font-bold"
                >
                    {el.visible ? "👁️ Visible" : "🚫 Oculto"}
                </button>
                <button
                    onClick={onDuplicate}
                    className="h-8 w-8 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                    title="Duplicar"
                >
                    <IconDuplicate size={12} />
                </button>
                <button
                    onClick={onDelete}
                    className="h-8 w-8 rounded bg-rose-100 hover:bg-rose-200 text-rose-600 flex items-center justify-center"
                    title="Eliminar"
                >
                    <IconTrash size={12} />
                </button>
            </div>
        </div>
    );
}

export default TenantSettingsPage;
