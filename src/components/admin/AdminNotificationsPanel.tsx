// =====================================================================
// MOZONA TPV — AdminNotificationsPanel (v1.9.75)
// =====================================================================
// Panel de notificaciones del SuperAdmin con aprobacion 1-click.
// Sustituye EmailJS: las altas se consultan directamente desde
// la tabla admin_notifications de Supabase.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { IconShield, IconCheck, IconBell, IconLock, IconArrowRight } from "../icons";
import { getUserJwt } from "../../lib/auth-helpers";

interface AdminNotification {
    id: string;
    tenant_id: string;
    type: string;
    title: string;
    message: string | null;
    payload: Record<string, any>;
    read_at: string | null;
    created_at: string;
}


export function AdminNotificationsPanel() {
    const [notifs, setNotifs] = useState<AdminNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [approving, setApproving] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
    const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

    const fetchNotifs = useCallback(async () => {
        if (!supabaseUrl || !supabaseKey) {
            setError("Supabase no configurado");
            setLoading(false);
            return;
        }
        try {
            const r = await fetch(
                `${supabaseUrl}/rest/v1/admin_notifications?order=created_at.desc&limit=50`,
                {
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`,
                    },
                }
            );
            if (!r.ok) {
                setError("Error al cargar notificaciones");
                setLoading(false);
                return;
            }
            const arr = await r.json();
            setNotifs(arr || []);
            setLoading(false);
        } catch (e) {
            setError(String(e));
            setLoading(false);
        }
    }, [supabaseUrl, supabaseKey]);

    useEffect(() => {
        fetchNotifs();
        const t = setInterval(fetchNotifs, 30_000);
        return () => clearInterval(t);
    }, [fetchNotifs]);

    const approveTenant = useCallback(async (tenantId: string, notifId: string) => {
        setApproving(tenantId);
        try {
            // ★ v4.6.0: identidad vía JWT (Authorization Bearer), ya NO
            //   el header spoofable `x-admin-email`. El servidor valida el
            //   token y que el email sea superadmin.
            const jwt = getUserJwt();
            const r = await fetch("/api/approve-tenant", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
                },
                body: JSON.stringify({ tenantId }),
            });
            const result = await r.json();
            if (!result.ok) {
                setMsg({ kind: "err", text: "No pudimos aprobar la solicitud. Reintenta en unos segundos." });
                return;
            }
            setMsg({ kind: "ok", text: "Alta aprobada. Trial de 7 días activado para el cliente." });
            // Marcar la notificación como leída
            await fetch(`${supabaseUrl}/rest/v1/admin_notifications?id=eq.${notifId}`, {
                method: "PATCH",
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ read_at: new Date().toISOString() }),
            });
            fetchNotifs();
        } catch (e) {
            setMsg({ kind: "err", text: "Conexión interrumpida. Reintenta." });
        } finally {
            setApproving(null);
        }
    }, [supabaseUrl, supabaseKey, fetchNotifs]);

    const unread = notifs.filter(n => !n.read_at);
    const read = notifs.filter(n => n.read_at);

    return (
        <div className="w-full max-w-2xl mx-auto p-4 space-y-4">
            {msg && (
                <div
                    className={`p-3 rounded-xl text-sm font-bold ${
                        msg.kind === "ok"
                            ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                            : "bg-rose-50 border border-rose-200 text-rose-800"
                    }`}
                >
                    {msg.text}
                </div>
            )}
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white shadow-lg">
                    <IconShield size={22} strokeWidth={2.2} />
                </div>
                <div className="flex-1">
                    <h1 className="text-[20px] font-black text-slate-900 tracking-tight">
                        Panel del SuperAdmin
                    </h1>
                    <p className="text-[12px] text-slate-500">
                        {unread.length} {unread.length === 1 ? "notificación nueva" : "notificaciones nuevas"} ·{" "}
                        {notifs.length} totales
                    </p>
                </div>
                {unread.length > 0 && (
                    <div className="relative">
                        <IconBell size={22} className="text-rose-500" />
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                            {unread.length}
                        </span>
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12px] text-rose-700">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-8 text-slate-400 text-[13px]">Cargando notificaciones…</div>
            ) : notifs.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
                    <div className="w-14 h-14 mx-auto rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-2">
                        <IconBell size={26} />
                    </div>
                    <p className="text-[13px] font-semibold text-slate-700">No hay notificaciones</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                        Las nuevas altas aparecerán aquí automáticamente.
                    </p>
                </div>
            ) : (
                <>
                    {unread.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10.5px] font-black text-slate-500 uppercase tracking-wider px-1">
                                Pendientes ({unread.length})
                            </div>
                            {unread.map(n => (
                                <NotifCard
                                    key={n.id}
                                    n={n}
                                    onApprove={() => approveTenant(n.tenant_id, n.id)}
                                    approving={approving === n.tenant_id}
                                />
                            ))}
                        </div>
                    )}
                    {read.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10.5px] font-black text-slate-400 uppercase tracking-wider px-1 mt-4">
                                Procesadas ({read.length})
                            </div>
                            {read.map(n => (
                                <NotifCard key={n.id} n={n} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function NotifCard({
    n, onApprove, approving,
}: { n: AdminNotification; onApprove?: () => void; approving?: boolean }) {
    const isNewRegistration = n.type === "new_registration";
    const isApproved = n.type === "activation_approved";
    const created = new Date(n.created_at);
    const ageMs = Date.now() - created.getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const ageStr = ageMin < 1 ? "ahora" : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h`;

    return (
        <div
            className={
                "rounded-2xl border-2 p-3.5 transition " +
                (n.read_at
                    ? "bg-slate-50 border-slate-200/60"
                    : "bg-white border-blue-300 shadow-md shadow-blue-500/10")
            }
        >
            <div className="flex items-start gap-3">
                <div
                    className={
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 " +
                        (isNewRegistration
                            ? "bg-blue-100 text-blue-600"
                            : isApproved
                                ? "bg-emerald-100 text-emerald-600"
                                : "bg-slate-100 text-slate-600")
                    }
                >
                    {isApproved ? <IconCheck size={18} strokeWidth={2.4} /> : <IconBell size={18} strokeWidth={2.2} />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[13.5px] font-bold text-slate-900 leading-tight">
                            {n.title}
                        </h3>
                        <span className="text-[10px] text-slate-400 font-semibold whitespace-nowrap shrink-0">
                            {ageStr}
                        </span>
                    </div>
                    {n.message && (
                        <p className="text-[11.5px] text-slate-600 mt-1 leading-relaxed">
                            {n.message}
                        </p>
                    )}
                    {n.payload && Object.keys(n.payload).length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px]">
                            {n.payload.business_name && (
                                <Field label="Restaurante" value={n.payload.business_name} />
                            )}
                            {n.payload.plan_selected && (
                                <Field label="Plan" value={n.payload.plan_selected} />
                            )}
                            {n.payload.contact_email && (
                                <Field label="Email" value={n.payload.contact_email} />
                            )}
                            {n.payload.trial_ends_at && (
                                <Field label="Trial" value={new Date(n.payload.trial_ends_at).toLocaleString("es-ES")} />
                            )}
                        </div>
                    )}
                    {isNewRegistration && onApprove && (
                        <button
                            onClick={onApprove}
                            disabled={approving}
                            className="mt-2.5 w-full h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[12px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition touch-manipulation shadow-md shadow-emerald-500/30"
                        >
                            {approving ? (
                                <>
                                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Aprobando…
                                </>
                            ) : (
                                <>
                                    <IconCheck size={14} strokeWidth={2.6} />
                                    Aprobar y activar 7 días
                                    <IconArrowRight size={14} strokeWidth={2.4} />
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-slate-50 rounded-lg px-2 py-1">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
            <div className="text-[11px] font-semibold text-slate-800 truncate">{value}</div>
        </div>
    );
}

export default AdminNotificationsPanel;
