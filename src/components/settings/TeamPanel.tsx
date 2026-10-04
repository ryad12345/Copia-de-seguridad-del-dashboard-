// =====================================================================
// MOZONA TPV — TeamPanel (Camareros con username + password)
// =====================================================================
// El admin introduce sólo el nombre y el rol.  El sistema genera
// automáticamente:
//   • username: nombre limpio + 2 dígitos
//   • password: 6 caracteres alfanuméricos aleatorios
//   • QR con URL directa a /waiter/login
//
// Al guardar, se muestra una "tarjeta de credenciales" imprimible
// y descargable como PDF para entregar al camarero.
// =====================================================================

import { useState, useRef } from "react";
import { useWaiters } from "../../hooks/useWaiters";
import { Card } from "./FormControls";
import {
    IconPlus, IconCheck, IconX, IconRefresh, IconAlert, IconUser,
    IconPencil, IconTrash, IconPrint, IconDownload, IconQr, IconCopy,
} from "../icons";
import type { WaiterRole } from "../../lib/waiters";
import { escapeHtml } from "../../lib/htmlEscape";

const ROLE_LABELS: Record<WaiterRole, string> = {
    owner:   "Dueño",
    manager: "Encargado",
    waiter:  "Camarero",
    kitchen: "Cocina",
};
const ROLE_TONES: Record<WaiterRole, string> = {
    owner:   "bg-violet-100 text-violet-700",
    manager: "bg-amber-100 text-amber-700",
    waiter:  "bg-blue-100 text-blue-700",
    kitchen: "bg-emerald-100 text-emerald-700",
};

interface FormState {
    open:      boolean;
    editingId: string | null;
    name:      string;
    role:      WaiterRole;
}

interface IssuedCard {
    name:      string;
    username:  string;
    password:  string;
    role:      WaiterRole;
    waiterId:  string;
    issuedAt:  string;
}

const EMPTY_FORM: FormState = { open: false, editingId: null, name: "", role: "waiter" };

export function TeamPanel() {
    const { waiters, loading, error, refresh, create, update, remove, resetPassword } = useWaiters();
    const [form,  setForm]  = useState<FormState>(EMPTY_FORM);
    const [busy,  setBusy]  = useState(false);
    const [msg,   setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [card,  setCard]  = useState<IssuedCard | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const startCreate = () => setForm({ ...EMPTY_FORM, open: true });
    const startEdit = (id: string) => {
        const w = waiters.find(x => x.id === id);
        if (!w) return;
        setForm({ open: true, editingId: id, name: w.name, role: w.role ?? "waiter" });
    };
    const cancel = () => { setForm(EMPTY_FORM); setMsg(null); };

    const save = async () => {
        if (!form.name.trim()) {
            setMsg({ kind: "err", text: "El nombre es obligatorio" });
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            if (form.editingId) {
                const w = await update(form.editingId, {
                    name: form.name.trim(),
                    role: form.role,
                });
                if (w) {
                    setMsg({ kind: "ok", text: `Camarero ${w.name} actualizado` });
                    setForm(EMPTY_FORM);
                } else if (!error) {
                    setMsg({ kind: "err", text: "No se pudo actualizar" });
                }
            } else {
                const result = await create({ name: form.name.trim(), role: form.role });
                if (result) {
                    setCard({
                        name:     result.waiter.name,
                        username: result.username,
                        password: result.pin,
                        role:     result.waiter.role,
                        waiterId: result.waiter.id,
                        issuedAt: new Date().toISOString(),
                    });
                    setMsg({ kind: "ok", text: `Camarero ${result.waiter.name} creado.  Entrega la tarjeta de credenciales.` });
                    setForm(EMPTY_FORM);
                } else if (!error) {
                    setMsg({ kind: "err", text: "No se pudo crear" });
                }
            }
        } catch (e) {
            setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const del = async (id: string) => {
        const w = waiters.find(x => x.id === id);
        if (!w) return;
        if (!confirm(`¿Borrar al camarero "${w.name}"?  No se puede deshacer.`)) return;
        setBusy(true);
        try {
            const ok = await remove(id);
            setMsg(ok ? { kind: "ok", text: `${w.name} eliminado` } : { kind: "err", text: "No se pudo borrar" });
        } finally {
            setBusy(false);
        }
    };

    const handleResetPassword = async (id: string, name: string) => {
        if (!confirm(`¿Resetear la contraseña de ${name}?  Se generará una nueva.`)) return;
        setBusy(true);
        try {
            // @ts-ignore — el método puede no estar tipado en useWaiters
            const newPwd = await resetPassword?.(id);
            if (newPwd) {
                const w = waiters.find(x => x.id === id);
                setCard({
                    name:     w?.name ?? name,
                    username: w?.username ?? "",
                    password: newPwd,
                    role:     w?.role ?? "waiter",
                    waiterId: id,
                    issuedAt: new Date().toISOString(),
                });
                setMsg({ kind: "ok", text: `Contraseña reseteada para ${name}` });
            }
        } catch (e) {
            setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const handlePrint = () => {
        if (!cardRef.current) return;
        const html = cardRef.current.outerHTML;
        const w = window.open("", "_blank", "width=400,height=600");
        if (!w) return;
        // ★ Seguridad: cortar la referencia inversa para que el documento
        //   abierto no pueda navegar/controlar la ventana que lo abrió.
        try { (w as Window).opener = null; } catch (_) {}
        w.document.write(`<!doctype html><html><head>
            <title>Credenciales ${escapeHtml(card?.name)}</title>
            <meta charset="utf-8" />
            <style>
                body { font-family: -apple-system, system-ui, sans-serif; padding: 16px; }
                .print-actions { position: sticky; top: 0; background: #fff; padding: 8px 0; }
                @media print { .print-actions { display: none; } body { padding: 0; } }
            </style>
            </head><body>
            <div class="print-actions">
                <button onclick="window.print()" style="height:36px;padding:0 16px;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;border:none;cursor:pointer">Imprimir</button>
            </div>
            ${html}
            </body></html>`);
        w.document.close();
    };

    const handleDownloadHtml = () => {
        if (!cardRef.current) return;
        const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Credenciales ${escapeHtml(card?.name)}</title></head><body>
${cardRef.current.outerHTML}
</body></html>`;
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `credenciales-${card?.username ?? "camarero"}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const active = waiters.filter(w => w.is_active !== false);
    const inactive = waiters.filter(w => w.is_active === false);

    return (
        <>
        <Card
            icon={<span className="text-[15px]">👥</span>}
            title="Equipo / Camareros"
            subtitle={`${active.length} activo${active.length !== 1 ? "s" : ""} · Acceso con usuario y contraseña`}
        >
            <div className="space-y-3">
                {/* Acciones */}
                <div className="flex gap-2">
                    <button onClick={startCreate} disabled={form.open}
                            className="flex-1 h-10 rounded-xl bg-slate-900 hover:bg-slate-800
                                       text-white text-[12.5px] font-bold flex items-center
                                       justify-center gap-1.5 disabled:opacity-50
                                       active:scale-95 transition">
                        <IconPlus size={14} strokeWidth={2.4} />
                        Añadir camarero
                    </button>
                    <button onClick={refresh} disabled={loading}
                            className="h-10 w-10 rounded-xl bg-slate-100 hover:bg-slate-200
                                       flex items-center justify-center text-slate-600
                                       disabled:opacity-50 active:scale-95 transition"
                            title="Refrescar">
                        <IconRefresh size={14} strokeWidth={2} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>

                {/* Formulario */}
                {form.open && (
                    <div className="p-3 rounded-2xl bg-blue-50/50 border border-blue-200/80 space-y-2.5">
                        <div className="text-[11.5px] font-black text-blue-900 uppercase tracking-wider">
                            {form.editingId ? "Editar camarero" : "Nuevo camarero"}
                        </div>
                        <div>
                            <label className="block text-[10.5px] font-bold text-slate-600 mb-1">
                                Nombre del camarero
                            </label>
                            <input type="text" value={form.name}
                                   onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                   placeholder="Ej. Luis García"
                                   autoFocus
                                   className="h-9 w-full px-2.5 rounded-lg border border-slate-200
                                              bg-white text-[12.5px] outline-none
                                              focus:border-blue-400" />
                        </div>
                        <div>
                            <label className="block text-[10.5px] font-bold text-slate-600 mb-1">Rol</label>
                            <div className="grid grid-cols-4 gap-1">
                                {(Object.keys(ROLE_LABELS) as WaiterRole[]).map(r => (
                                    <button key={r} type="button"
                                            onClick={() => setForm(f => ({ ...f, role: r }))}
                                            className={`h-9 rounded-lg text-[11px] font-bold transition active:scale-95
                                                ${form.role === r
                                                    ? ROLE_TONES[r] + " ring-2 ring-offset-1 ring-blue-500"
                                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                                        {ROLE_LABELS[r]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="text-[10.5px] text-slate-500 italic pt-0.5">
                            Se generarán automáticamente su <strong>usuario</strong> y
                            <strong> contraseña de 6 caracteres</strong>.
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button onClick={cancel}
                                    className="h-9 px-3 rounded-lg bg-slate-100 hover:bg-slate-200
                                               text-[12px] font-bold text-slate-600
                                               flex items-center gap-1 active:scale-95 transition">
                                <IconX size={12} strokeWidth={2.2} />
                                Cancelar
                            </button>
                            <button onClick={save} disabled={busy}
                                    className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700
                                               text-white text-[12px] font-bold
                                               flex items-center justify-center gap-1
                                               disabled:opacity-50 active:scale-95 transition">
                                <IconCheck size={12} strokeWidth={2.4} />
                                {busy ? "Generando…" : (form.editingId ? "Guardar cambios" : "Crear y generar credenciales")}
                            </button>
                        </div>
                    </div>
                )}

                {msg && (
                    <div className={`p-2.5 rounded-xl border text-[12px] flex items-start gap-2
                                    ${msg.kind === "ok"
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                        : "bg-rose-50 border-rose-200 text-rose-700"}`}>
                        {msg.kind === "ok"
                            ? <IconCheck size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                            : <IconAlert size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" />}
                        <span>{msg.text}</span>
                    </div>
                )}

                {error && !msg && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[12px] text-rose-700
                                    flex items-start gap-2">
                        <IconAlert size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Lista */}
                <div className="space-y-1.5">
                    {active.length === 0 && !loading && (
                        <div className="py-6 text-center text-[12px] text-slate-400">
                            <IconUser size={20} strokeWidth={1.5} className="mx-auto mb-1 opacity-50" />
                            No hay camareros.  Añade el primero arriba.
                        </div>
                    )}
                    {active.map(w => (
                        <WaiterRow key={w.id} waiter={w}
                                   onEdit={() => startEdit(w.id)}
                                   onDelete={() => del(w.id)}
                                   onResetPwd={() => handleResetPassword(w.id, w.name)}
                                   busy={busy} />
                    ))}
                    {inactive.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-slate-100">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                Desactivados ({inactive.length})
                            </div>
                            {inactive.map(w => (
                                <WaiterRow key={w.id} waiter={w} dim
                                           onEdit={() => startEdit(w.id)}
                                           onDelete={() => del(w.id)}
                                           onResetPwd={() => handleResetPassword(w.id, w.name)}
                                           busy={busy} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Card>

        {/* Modal de tarjeta de credenciales emitida */}
        {card && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm
                            flex items-center justify-center p-4"
                 onClick={() => setCard(null)}>
                <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden
                                animate-in fade-in zoom-in-95"
                     onClick={e => e.stopPropagation()}>
                    <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-200/80 flex items-center gap-2">
                        <IconCheck size={16} strokeWidth={2.4} className="text-emerald-600 shrink-0" />
                        <div className="text-[12.5px] font-bold text-emerald-900">
                            Camarero creado · Entrega estas credenciales
                        </div>
                    </div>

                    {/* TARJETA imprimible */}
                    <div ref={cardRef} className="p-5">
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-5 bg-gradient-to-br
                                        from-slate-50 to-white">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700
                                                    text-white flex items-center justify-center font-black text-[12px]">
                                        M
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase">
                                            MOZONA TPV
                                        </div>
                                        <div className="text-[9.5px] text-slate-400">
                                            Tarjeta de acceso · Camarero
                                        </div>
                                    </div>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-black uppercase
                                                ${ROLE_TONES[card.role]}`}>
                                    {ROLE_LABELS[card.role]}
                                </span>
                            </div>

                            <div className="text-[18px] font-black text-slate-900 leading-tight">
                                {card.name}
                            </div>
                            <div className="text-[10.5px] text-slate-500 mt-0.5">
                                Emitida el {new Date(card.issuedAt).toLocaleDateString("es-ES", {
                                    day: "2-digit", month: "short", year: "numeric",
                                })}
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider">
                                        Usuario
                                    </div>
                                    <div className="text-[15px] font-black text-slate-900 font-mono tabular-nums">
                                        {card.username}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider">
                                        PIN (4 caracteres)
                                    </div>
                                    <div className="text-[18px] font-black text-slate-900 font-mono tabular-nums tracking-[0.3em]">
                                        {card.password}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between">
                                <div className="text-[10px] text-slate-500 leading-tight max-w-[60%]">
                                    Escanea para entrar desde tu móvil:
                                </div>
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(
                                        typeof window !== "undefined"
                                            ? `${window.location.origin}/waiter/login`
                                            : "https://mozonatpv.site/waiter/login"
                                    )}`}
                                    alt="QR acceso camarero"
                                    className="w-20 h-20 rounded-md"
                                />
                            </div>
                            <div className="text-center text-[8.5px] text-slate-400 mt-2 font-mono break-all">
                                {typeof window !== "undefined" ? window.location.origin : "mozonatpv.site"}/waiter/login
                            </div>
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="p-4 border-t border-slate-100 flex gap-2">
                        <button onClick={() => setCard(null)}
                                className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200
                                           text-[12px] font-bold text-slate-700
                                           flex items-center gap-1 active:scale-95 transition">
                            <IconX size={12} strokeWidth={2.2} />
                            Cerrar
                        </button>
                        <button onClick={handlePrint}
                                className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200
                                           text-[12px] font-bold text-slate-700
                                           flex items-center gap-1 active:scale-95 transition">
                            <IconPrint size={12} strokeWidth={2.2} />
                            Imprimir
                        </button>
                        <button onClick={handleDownloadHtml}
                                className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700
                                           text-white text-[12px] font-bold
                                           flex items-center justify-center gap-1.5
                                           active:scale-95 transition">
                            <IconDownload size={13} strokeWidth={2.4} />
                            Descargar tarjeta
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}

function WaiterRow({
    waiter, onEdit, onDelete, onResetPwd, busy, dim = false,
}: {
    waiter:   { id: string; name: string; role?: WaiterRole; username?: string | null; pin_code?: string | null; email?: string | null };
    onEdit:   () => void;
    onDelete: () => void;
    onResetPwd: () => void;
    busy:     boolean;
    dim?:     boolean;
}) {
    return (
        <div className={`flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 bg-white
                        ${dim ? "opacity-50" : ""}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300
                            flex items-center justify-center text-slate-700 font-black text-[12px] shrink-0">
                {waiter.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-900 truncate">
                    {waiter.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-flex px-1.5 h-4 items-center rounded text-[9.5px] font-bold ${ROLE_TONES[waiter.role ?? "waiter"]}`}>
                        {ROLE_LABELS[waiter.role ?? "waiter"]}
                    </span>
                    <span className="text-[10.5px] text-slate-400 font-mono tabular-nums truncate">
                        @{waiter.username ?? "sin-usuario"}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-0.5">
                <button onClick={onResetPwd} disabled={busy}
                        className="w-7 h-7 rounded-md text-slate-500 hover:text-amber-600
                                   hover:bg-amber-50 flex items-center justify-center
                                   active:scale-90 transition"
                        title="Resetear contraseña">
                    <IconRefresh size={12} strokeWidth={2.2} />
                </button>
                <button onClick={onEdit} disabled={busy}
                        className="w-7 h-7 rounded-md text-slate-500 hover:text-blue-600
                                   hover:bg-blue-50 flex items-center justify-center
                                   active:scale-90 transition"
                        title="Editar">
                    <IconPencil size={12} strokeWidth={2.2} />
                </button>
                <button onClick={onDelete} disabled={busy}
                        className="w-7 h-7 rounded-md text-slate-500 hover:text-rose-600
                                   hover:bg-rose-50 flex items-center justify-center
                                   active:scale-90 transition"
                        title="Borrar">
                    <IconTrash size={12} strokeWidth={2.2} />
                </button>
            </div>
        </div>
    );
}

export default TeamPanel;
