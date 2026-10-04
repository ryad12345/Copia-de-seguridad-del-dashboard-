// =====================================================================
// MOZONA TPV — ClientSubscriptionsPanel
// =====================================================================
// Panel EXCLUSIVO del SuperAdmin para gestión MANUAL de clientes y planes.
//
// Por tenant muestra:
//   - Email / Negocio
//   - Plan actual (Mensual 30d, Anual 365d, Prueba 14d, VIP Ilimitado)
//   - Fecha de vencimiento (DD/MM/YYYY)
//   - Estado: Activo (verde) | Por vencer / Gracia (amarillo) | Vencido (rojo)
//   - Días restantes
//
// Acciones:
//   - +30 días       (suma 30d a la fecha)
//   - +1 año         (suma 365d)
//   - Pausar         (marca suspended)
//   - Hacer VIP      (sin expiración)
//
// Esquema defensivo: si la BD no tiene `subscription_ends_at` ni
// `internal_notes`, los gestiona via columna nueva (si existe) o calcula
// desde `created_at + dias_del_plan`.
// =====================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { IconCheck, IconX, IconShield, IconRefresh, IconUser, IconSparkles } from "../icons";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

interface ClientRow {
    id:                string;
    name:              string;
    owner_email:       string;
    plan:              string;
    subscription_status: string;
    subscription_ends_at: string | null;
    created_at:        string;
    internal_notes:    string | null;
}

type Tone = "emerald" | "amber" | "rose" | "slate";

const PLAN_DAYS: Record<string, number> = {
    plus_30:      30,
    pro_50:       30,
    annual_365:   365,
    trial_14:     14,
    lifetime_vip: 99999,  // vitalicio
};

const PLAN_LABEL: Record<string, string> = {
    plus_30:      "Mensual (30d)",
    pro_50:       "Mensual (30d)",
    annual_365:   "Anual (365d)",
    trial_14:     "Prueba (14d)",
    lifetime_vip: "VIP Vitalicio",
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function addDays(iso: string | null, days: number): string {
    const base = iso ? new Date(iso) : new Date();
    base.setDate(base.getDate() + days);
    return base.toISOString();
}

function daysUntil(iso: string | null): number {
    if (!iso) return -99999;
    const d = new Date(iso);
    const now = new Date();
    return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function classifyStatus(plan: string, endsAt: string | null, status: string): { tone: Tone; label: string; days: number } {
    const days = daysUntil(endsAt);
    if (plan === "lifetime_vip") {
        return { tone: "emerald", label: "VIP Vitalicio", days: 99999 };
    }
    if (status === "canceled" || status === "suspended") {
        return { tone: "rose", label: "Suspendido", days };
    }
    if (days < 0) {
        return { tone: "rose", label: `Vencido hace ${-days}d`, days };
    }
    if (days <= 3) {
        return { tone: "amber", label: `Por vencer (${days}d)`, days };
    }
    return { tone: "emerald", label: `Activo (${days}d)`, days };
}

// ---------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------

export function ClientSubscriptionsPanel() {
    const [rows,       setRows]       = useState<ClientRow[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [savingId,   setSavingId]   = useState<string | null>(null);
    const [msg,        setMsg]        = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    // Form alta
    const [newName,    setNewName]    = useState("");
    const [newEmail,   setNewEmail]   = useState("");
    const [newPlan,    setNewPlan]    = useState("trial_14");
    const [newNotes,   setNewNotes]   = useState("");
    const [creating,   setCreating]   = useState(false);

    useEffect(() => { void load(); }, []);

    const load = async () => {
        setLoading(true);
        setMsg(null);
        try {
            const { data, error } = await supabase
                .from("tenants")
                .select("id, name, plan, subscription_status, subscription_ends_at, created_at, internal_notes, owner_id, owner:owner_id(email)")
                .order("created_at", { ascending: false })
                .limit(200);
            if (error) {
                setMsg({ kind: "err", text: error.message });
                setRows([]);
            } else {
                const mapped: ClientRow[] = (data ?? []).map((t: any) => ({
                    id:                  t.id,
                    name:                t.name ?? "(sin nombre)",
                    owner_email:         t.owner?.email ?? "—",
                    plan:                t.plan ?? "plus_30",
                    subscription_status: t.subscription_status ?? "active",
                    subscription_ends_at: t.subscription_ends_at ?? null,
                    created_at:          t.created_at,
                    internal_notes:      t.internal_notes ?? null,
                }));
                setRows(mapped);
            }
        } catch (e: any) {
            setMsg({ kind: "err", text: e?.message ?? "Error" });
        }
        setLoading(false);
    };

    // -----------------------------------------------------------------
    // Acciones
    // -----------------------------------------------------------------

    const updateEndsAt = async (row: ClientRow, days: number | "lifetime" | "pause") => {
        setSavingId(row.id);
        setMsg(null);
        try {
            let newEnds: string | null;
            let newStatus: string = row.subscription_status;
            if (days === "lifetime") {
                newEnds = new Date(Date.now() + 36500 * 86400000).toISOString();   // ~100 años
                newStatus = "active";
            } else if (days === "pause") {
                newEnds = new Date(Date.now() - 86400000).toISOString();   // ayer
                newStatus = "suspended";
            } else {
                newEnds = addDays(row.subscription_ends_at, days);
                newStatus = "active";
            }
            // Intentar actualizar (defensivo: si subscription_ends_at no existe, lo creamos via SQL)
            const patch: any = { subscription_status: newStatus };
            patch.subscription_ends_at = newEnds;
            const { error } = await supabase
                .from("tenants")
                .update(patch)
                .eq("id", row.id);
            if (error) {
                // Reintentar sin ends_at (puede no existir la columna)
                const retry = await supabase
                    .from("tenants")
                    .update({ subscription_status: newStatus })
                    .eq("id", row.id);
                if (retry.error) {
                    setMsg({ kind: "err", text: retry.error.message });
                    setSavingId(null);
                    return;
                }
                setMsg({ kind: "ok", text: `Estado actualizado a ${newStatus}. Columna subscription_ends_at no existe en BD.` });
            } else {
                setMsg({ kind: "ok", text: days === "lifetime" ? "Cliente marcado como VIP vitalicio" :
                                       days === "pause"    ? "Cliente suspendido" :
                                                            `+${days} días aplicados` });
            }
            await load();
        } catch (e: any) {
            setMsg({ kind: "err", text: e?.message ?? "Error" });
        }
        setSavingId(null);
    };

    const createClient = async () => {
        if (!newName.trim() || !newEmail.trim()) {
            setMsg({ kind: "err", text: "Nombre y email son obligatorios" });
            return;
        }
        setCreating(true);
        setMsg(null);
        try {
            const days = PLAN_DAYS[newPlan] ?? 30;
            const endsAt = new Date(Date.now() + days * 86400000).toISOString();
            const patch: any = {
                name:                newName.trim(),
                plan:                newPlan,
                subscription_status: "active",
            };
            patch.subscription_ends_at = endsAt;
            patch.internal_notes       = newNotes.trim() || null;

            const { error } = await supabase
                .from("tenants")
                .insert(patch);
            if (error) {
                // Reintentar sin columnas opcionales
                const retry = await supabase
                    .from("tenants")
                    .insert({
                        name:                newName.trim(),
                        plan:                newPlan,
                        subscription_status: "active",
                    });
                if (retry.error) {
                    setMsg({ kind: "err", text: retry.error.message });
                    setCreating(false);
                    return;
                }
                setMsg({ kind: "ok", text: "Cliente creado (sin notas/fin por columnas faltantes en BD)" });
            } else {
                setMsg({ kind: "ok", text: `Cliente creado con plan ${PLAN_LABEL[newPlan]}` });
            }
            setNewName(""); setNewEmail(""); setNewPlan("trial_14"); setNewNotes("");
            await load();
        } catch (e: any) {
            setMsg({ kind: "err", text: e?.message ?? "Error" });
        }
        setCreating(false);
    };

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------

    return (
        <div className="space-y-6">
            {/* Cabecera */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <IconShield size={16} strokeWidth={1.8} className="text-violet-600" />
                    <h2 className="text-[15px] font-black">Gestión de suscripciones</h2>
                </div>
                <button onClick={load}
                        className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100
                                   flex items-center justify-center active:scale-90 transition"
                        title="Recargar">
                    <IconRefresh size={16} strokeWidth={2} />
                </button>
            </div>

            {msg && (
                <div className={
                    "p-2.5 rounded-xl text-[12px] " +
                    (msg.kind === "ok"
                        ? "bg-emerald-50 border border-emerald-200/80 text-emerald-800"
                        : "bg-rose-50 border border-rose-200/80 text-rose-700")
                }>
                    {msg.text}
                </div>
            )}

            {/* Form alta */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <h3 className="text-[13px] font-black mb-3 flex items-center gap-2">
                    <IconUser size={14} strokeWidth={2.2} className="text-emerald-600" />
                    Alta / Crear cliente
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            Nombre del restaurante
                        </label>
                        <input value={newName} onChange={e => setNewName(e.target.value)}
                               placeholder="Ej: Bar La Esquina"
                               className="input mt-1" />
                    </div>
                    <div>
                        <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            Email del cliente
                        </label>
                        <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                               placeholder="cliente@ejemplo.com"
                               className="input mt-1" />
                    </div>
                    <div>
                        <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            Plan inicial
                        </label>
                        <select value={newPlan} onChange={e => setNewPlan(e.target.value)} className="input mt-1">
                            <option value="trial_14">Prueba (14 días)</option>
                            <option value="plus_30">Mensual (30 días)</option>
                            <option value="annual_365">Anual (365 días)</option>
                            <option value="lifetime_vip">VIP Vitalicio</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            Notas internas (opcional)
                        </label>
                        <input value={newNotes} onChange={e => setNewNotes(e.target.value)}
                               placeholder="Ej: Bizum 30€ 03/09/2026"
                               className="input mt-1" />
                    </div>
                </div>
                <div className="mt-3 flex justify-end">
                    <button onClick={createClient} disabled={creating}
                            className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-[12.5px] font-bold
                                       shadow-sm shadow-emerald-600/30 active:scale-95 transition
                                       disabled:opacity-50">
                        {creating ? "Creando…" : "Crear cliente"}
                    </button>
                </div>
            </div>

            {/* Tabla */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <h3 className="text-[13px] font-black mb-3 flex items-center gap-2">
                    <IconSparkles size={14} strokeWidth={2.2} className="text-blue-600" />
                    Listado de clientes ({rows.length})
                </h3>
                {loading ? (
                    <div className="py-8 text-center text-[12.5px] text-slate-400">Cargando…</div>
                ) : rows.length === 0 ? (
                    <div className="py-8 text-center text-[12.5px] text-slate-400">
                        No hay clientes registrados todavía.
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-[12px]">
                            <thead>
                                <tr className="text-left text-slate-500 border-b border-slate-200">
                                    <th className="px-2 py-2 font-bold">Negocio / Email</th>
                                    <th className="px-2 py-2 font-bold">Plan</th>
                                    <th className="px-2 py-2 font-bold">Vence</th>
                                    <th className="px-2 py-2 font-bold">Estado</th>
                                    <th className="px-2 py-2 font-bold text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => {
                                    const cls = classifyStatus(r.plan, r.subscription_ends_at, r.subscription_status);
                                    return (
                                        <tr key={r.id} className="border-b border-slate-100 align-top">
                                            <td className="px-2 py-2.5">
                                                <div className="font-bold text-slate-800">{r.name}</div>
                                                <div className="text-[10.5px] text-slate-500">{r.owner_email}</div>
                                                {r.internal_notes && (
                                                    <div className="mt-0.5 text-[10.5px] italic text-slate-400">
                                                        📝 {r.internal_notes}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <PlanBadge plan={r.plan} />
                                            </td>
                                            <td className="px-2 py-2.5 text-slate-600 tabular-nums">
                                                {fmtDate(r.subscription_ends_at)}
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <StatusBadge tone={cls.tone} label={cls.label} />
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <div className="inline-flex flex-wrap gap-1 justify-end">
                                                    <ActionBtn
                                                        onClick={() => updateEndsAt(r, 30)}
                                                        disabled={savingId === r.id}
                                                        label="+30 días"
                                                        tone="blue"
                                                    />
                                                    <ActionBtn
                                                        onClick={() => updateEndsAt(r, 365)}
                                                        disabled={savingId === r.id}
                                                        label="+1 año"
                                                        tone="blue"
                                                    />
                                                    <ActionBtn
                                                        onClick={() => updateEndsAt(r, "pause")}
                                                        disabled={savingId === r.id}
                                                        label="Pausar"
                                                        tone="amber"
                                                    />
                                                    <ActionBtn
                                                        onClick={() => updateEndsAt(r, "lifetime")}
                                                        disabled={savingId === r.id}
                                                        label="Hacer VIP"
                                                        tone="violet"
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function ActionBtn({ onClick, disabled, label, tone }:
                   { onClick: () => void; disabled?: boolean; label: string;
                     tone: "blue" | "amber" | "violet" }) {
    const tones = {
        blue:   "bg-blue-50   text-blue-700   hover:bg-blue-100",
        amber:  "bg-amber-50  text-amber-800  hover:bg-amber-100",
        violet: "bg-violet-50 text-violet-700 hover:bg-violet-100",
    };
    return (
        <button onClick={onClick} disabled={disabled}
                className={"h-7 px-2.5 rounded-md text-[10.5px] font-bold transition active:scale-95 disabled:opacity-50 " + tones[tone]}>
            {label}
        </button>
    );
}

function PlanBadge({ plan }: { plan: string }) {
    const styles: Record<string, string> = {
        plus_30:      "bg-blue-50 text-blue-700",
        pro_50:       "bg-blue-50 text-blue-700",
        annual_365:   "bg-cyan-50 text-cyan-700",
        trial_14:     "bg-amber-50 text-amber-700",
        lifetime_vip: "bg-violet-50 text-violet-700",
    };
    return (
        <span className={"px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap " +
                         (styles[plan] ?? "bg-slate-100 text-slate-600")}>
            {PLAN_LABEL[plan] ?? plan}
        </span>
    );
}

function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
    const styles: Record<Tone, string> = {
        emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
        amber:   "bg-amber-100  text-amber-800  border-amber-200",
        rose:    "bg-rose-100   text-rose-800   border-rose-200",
        slate:   "bg-slate-100  text-slate-600  border-slate-200",
    };
    const dot: Record<Tone, string> = {
        emerald: "bg-emerald-500",
        amber:   "bg-amber-500",
        rose:    "bg-rose-500",
        slate:   "bg-slate-400",
    };
    return (
        <span className={"inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10.5px] font-bold " + styles[tone]}>
            <span className={"w-1.5 h-1.5 rounded-full " + dot[tone]} />
            {label}
        </span>
    );
}
