// =====================================================================
// MOZONA TPV — AdminPanelPage (v3.1.4)
// =====================================================================
// Panel de control completo del superadmin.
// Acceso automático cuando rofixinsta@gmail.com hace login en /auth.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSuperAdminEmail } from "../lib/vip";
import { supabase } from "../lib/supabase";
import { IconShield, IconArrowRight, IconUser, IconCheck, IconLock } from "../components/icons";
import { MigrationPanel } from "../components/admin/MigrationPanel";
import {
    rpcListTenantRequests,
    rpcApproveTenantRequest,
    rpcRejectTenantRequest,
    type TenantRequestRpc,
} from "../lib/secureRpc";

interface Tenant {
    id: string;
    name?: string;
    business_name?: string;
    contact_email?: string;
    plan_selected?: string;
    plan?: string;
    activation_status?: string;
    business_type?: string;
    created_at?: string;
    approved_at?: string;
    trial_ends_at?: string;
}

const PLANS = [
    { code: "plus_30", label: "Plus 30€", price: 30 },
    { code: "pro_50", label: "Pro 50€", price: 50 },
    { code: "vip", label: "VIP Lifetime", price: 0 },
    { code: "basic", label: "Basic (gratis)", price: 0 },
];

export function AdminPanelPage() {
    const navigate = useNavigate();
    const auth = useAuth();
    const isAdmin = isSuperAdminEmail(auth.user?.email);

    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [stats, setStats] = useState<any>(null);
    const [editing, setEditing] = useState<Tenant | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // ★ v4.5.12: solicitudes de registro pendientes
    const [regRequests, setRegRequests] = useState<TenantRequestRpc[]>([]);
    const [loadingRequests, setLoadingRequests] = useState(false);
    const [tab, setTab] = useState<"tenants" | "requests">("tenants");

    const loadRegRequests = useCallback(async () => {
        if (!isAdmin) return;
        setLoadingRequests(true);
        try {
            const r = await rpcListTenantRequests("pending", 50);
            if (r?.ok && Array.isArray((r.data as any)?.data)) {
                setRegRequests((r.data as any).data);
            } else {
                setRegRequests([]);
            }
        } catch (e) {
            console.warn("[AdminPanel] loadRegRequests fail:", e);
            setRegRequests([]);
        } finally {
            setLoadingRequests(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        if (isAdmin && tab === "requests") {
            loadRegRequests();
        }
    }, [isAdmin, tab, loadRegRequests]);

    const handleApproveRequest = async (req: TenantRequestRpc) => {
        if (!confirm(`¿Aprobar solicitud de ${req.email}?`)) return;
        setBusy(true);
        try {
            const r = await rpcApproveTenantRequest(req.id, auth.user?.email || "admin");
            if (r?.ok) {
                setSuccess(`✅ Solicitud aprobada: ${req.email}`);
                await loadRegRequests();
            } else {
                setError(`No se pudo aprobar: ${r?.error || "error"}`);
            }
        } catch (e: any) {
            setError(e?.message || "error");
        } finally {
            setBusy(false);
        }
    };

    const handleRejectRequest = async (req: TenantRequestRpc) => {
        if (!confirm(`¿Rechazar solicitud de ${req.email}?`)) return;
        setBusy(true);
        try {
            const r = await rpcRejectTenantRequest(req.id, auth.user?.email || "admin");
            if (r?.ok) {
                setSuccess(`❌ Solicitud rechazada: ${req.email}`);
                await loadRegRequests();
            } else {
                setError(`No se pudo rechazar: ${r?.error || "error"}`);
            }
        } catch (e: any) {
            setError(e?.message || "error");
        } finally {
            setBusy(false);
        }
    };

    // ★ Redirigir si no es admin
    useEffect(() => {
        if (auth.isReady && !isAdmin) {
            navigate("/", { replace: true });
        }
    }, [auth.isReady, isAdmin, navigate]);

    // ★ Cargar datos
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            if (statusFilter) params.set("status", statusFilter);
            params.set("action", "list");

            // ★ v4.5.17: usa Edge Function admin-ops con JWT (sin token en URL)
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops", { body: params }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setTenants(json.tenants || []);
            } else {
                setError(json.error);
            }

            // Stats — ★ v4.6.0: JWT en cabecera Authorization (nunca en la URL)
            const jwt = auth.session?.access_token || "";
            if (jwt) {
                const sr = await fetch(`/api/admin?action=stats`, {
                    headers: { Authorization: `Bearer ${jwt}` },
                });
                const sjson = await sr.json();
                if (sjson.ok) setStats(sjson.stats);
            }
        } catch (e) {
            setError(String(e));
        }
        setLoading(false);
    }, [search, statusFilter]);

    useEffect(() => {
        if (isAdmin) fetchData();
    }, [isAdmin, fetchData]);

    // ★ Aprobar tenant — v4.5.17: usa Edge Function admin-ops con JWT (sin token en URL)
    const approve = async (tenant: Tenant, days = 7) => {
        setBusy(true);
        setError(null);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                { body: { action: "approve_tenant", tenantId: tenant.id, trialDays: days } }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setSuccess(`Aprobado: ${tenant.name || tenant.contact_email} (${days}d trial)`);
                fetchData();
            } else {
                setError(json?.error || "No se pudo aprobar");
            }
        } catch (e: any) {
            setError(String(e?.message ?? e));
        }
        setBusy(false);
    };

    // ★ Cambiar plan — v4.5.17
    const changePlan = async (tenant: Tenant, plan: string) => {
        setBusy(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                { body: { action: "change_plan", tenantId: tenant.id, plan } }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setSuccess(`Plan cambiado a ${plan}`);
                fetchData();
            } else {
                setError(json?.error || "No se pudo cambiar plan");
            }
        } catch (e: any) {
            setError(String(e?.message ?? e));
        }
        setBusy(false);
    };

    // ★ Reset password — v4.5.17
    const resetPassword = async (tenant: Tenant) => {
        const newPass = prompt(`Nueva contraseña para ${tenant.contact_email} (mín 6 caracteres):`);
        if (!newPass || newPass.length < 6) {
            setError("Contraseña muy corta");
            return;
        }
        setBusy(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                { body: { action: "reset_password", email: tenant.contact_email, newPassword: newPass } }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setSuccess(`Password actualizado para ${tenant.contact_email}`);
            } else {
                setError(json?.error || "No se pudo resetear password");
            }
        } catch (e: any) {
            setError(String(e?.message ?? e));
        }
        setBusy(false);
    };

    // ★ Guardar edición — v4.5.17
    const saveEdit = async () => {
        if (!editing) return;
        setBusy(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                {
                    body: {
                        action: "edit_tenant",
                        tenantId: editing.id,
                        name: editing.name,
                        businessName: editing.business_name,
                        contactEmail: editing.contact_email,
                        businessType: editing.business_type,
                    },
                }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setSuccess("Datos actualizados");
                setEditing(null);
                fetchData();
            } else {
                setError(json?.error || "No se pudo guardar");
            }
        } catch (e: any) {
            setError(String(e?.message ?? e));
        }
        setBusy(false);
    };

    if (!isAdmin) {
        return (
            <div className="min-h-dvh flex items-center justify-center bg-slate-50">
                <div className="bg-white rounded-2xl shadow-xl p-6 text-center">
                    <IconShield size={48} className="mx-auto text-rose-500 mb-3" />
                    <h1 className="text-xl font-black mb-2">Acceso restringido</h1>
                    <p className="text-sm text-slate-600">Solo el superadmin puede acceder.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-dvh bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto space-y-4">
                {/* Cabecera */}
                <div className="bg-gradient-to-br from-blue-600 via-violet-600 to-blue-700 rounded-3xl shadow-2xl p-6 text-white">
                    <div className="flex items-center gap-3 mb-2">
                        <IconShield size={32} />
                        <h1 className="text-2xl font-black">Panel de Admin</h1>
                    </div>
                    <p className="text-[12.5px] text-blue-100">
                        Bienvenido {auth.user?.email}. Tienes control total sobre la plataforma.
                    </p>
                </div>

                {/* ★ v4.5.12: Tabs */}
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setTab("tenants")}
                        className={`h-10 px-4 rounded-xl text-[13px] font-black transition ${
                            tab === "tenants"
                                ? "bg-blue-600 text-white shadow-md"
                                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                        }`}
                    >
                        🏢 Tenants
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab("requests")}
                        className={`h-10 px-4 rounded-xl text-[13px] font-black transition relative ${
                            tab === "requests"
                                ? "bg-blue-600 text-white shadow-md"
                                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                        }`}
                    >
                        📥 Solicitudes de Registro
                        {regRequests.length > 0 && (
                            <span className="absolute -top-2 -right-2 bg-rose-600 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center">
                                {regRequests.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Stats */}
                {stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <StatBox label="Total" value={stats.total} color="bg-slate-700" />
                        <StatBox label="Pendientes" value={stats.pending} color="bg-amber-500" />
                        <StatBox label="Trial" value={stats.trial} color="bg-blue-500" />
                        <StatBox label="Activos" value={stats.active} color="bg-emerald-500" />
                        <StatBox label="VIP" value={stats.vip} color="bg-violet-500" />
                    </div>
                )}

                {/* Mensajes */}
                {success && (
                    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 flex items-center gap-2">
                        <IconCheck size={18} className="text-emerald-600" />
                        <span className="text-[12.5px] text-emerald-900 font-semibold">{success}</span>
                        <button onClick={() => setSuccess(null)} className="ml-auto text-emerald-700">✕</button>
                    </div>
                )}
                {error && (
                    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4">
                        <span className="text-[12.5px] text-rose-900 font-semibold">❌ {error}</span>
                        <button onClick={() => setError(null)} className="ml-auto text-rose-700">✕</button>
                    </div>
                )}

                {/* ★ v4.0.7-migration: Panel de sincronización desde localStorage */}
                <MigrationPanel />

                {/* Filtros */}
                <div className="bg-white rounded-2xl shadow-xl p-4 flex flex-wrap gap-2">
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre o email..."
                        className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-slate-300 text-[12.5px]"
                    />
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="h-10 px-3 rounded-lg border border-slate-300 text-[12.5px]"
                    >
                        <option value="">Todos los estados</option>
                        <option value="pending_activation">⏳ Pendientes</option>
                        <option value="active_trial">🎁 Trial</option>
                        <option value="active">✅ Activos</option>
                        <option value="vip">⭐ VIP</option>
                        <option value="expired">❌ Expirados</option>
                    </select>
                    <button
                        onClick={fetchData}
                        className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-black"
                    >
                        Buscar
                    </button>
                </div>

                {/* Tabla de tenants */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-4 border-b border-slate-200">
                        <h2 className="text-sm font-black">
                            Tenants ({tenants.length})
                        </h2>
                    </div>
                    {loading ? (
                        <div className="p-8 text-center text-slate-500 text-[12px]">Cargando...</div>
                    ) : tenants.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-[12px]">No hay tenants</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[12px]">
                                <thead className="bg-slate-50 text-slate-700">
                                    <tr>
                                        <th className="text-left p-2">Nombre</th>
                                        <th className="text-left p-2">Email</th>
                                        <th className="text-left p-2">Estado</th>
                                        <th className="text-left p-2">Plan</th>
                                        <th className="text-left p-2">Trial hasta</th>
                                        <th className="text-left p-2">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tenants.map(t => (
                                        <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                                            <td className="p-2 font-semibold">{t.name || t.business_name || "—"}</td>
                                            <td className="p-2 text-slate-600">{t.contact_email || "—"}</td>
                                            <td className="p-2">
                                                <StatusBadge status={t.activation_status} />
                                            </td>
                                            <td className="p-2">
                                                <select
                                                    value={t.plan_selected || t.plan || "basic"}
                                                    onChange={e => changePlan(t, e.target.value)}
                                                    disabled={busy}
                                                    className="h-7 px-2 rounded border border-slate-200 text-[11px]"
                                                >
                                                    {PLANS.map(p => (
                                                        <option key={p.code} value={p.code}>{p.label}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="p-2 text-slate-500 text-[10.5px]">
                                                {t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString("es-ES") : "—"}
                                            </td>
                                            <td className="p-2">
                                                <div className="flex gap-1 flex-wrap">
                                                    {t.activation_status === "pending_activation" && (
                                                        <button
                                                            onClick={() => approve(t, 7)}
                                                            disabled={busy}
                                                            className="h-7 px-2 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-[10.5px] font-black"
                                                        >
                                                            ✅ Aprobar 7d
                                                        </button>
                                                    )}
                                                    {t.activation_status === "pending_activation" && (
                                                        <button
                                                            onClick={() => approve(t, 30)}
                                                            disabled={busy}
                                                            className="h-7 px-2 rounded bg-blue-500 hover:bg-blue-600 text-white text-[10.5px] font-black"
                                                        >
                                                            30d
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setEditing(t)}
                                                        disabled={busy}
                                                        className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10.5px] font-black"
                                                    >
                                                        ✏️
                                                    </button>
                                                    <button
                                                        onClick={() => resetPassword(t)}
                                                        disabled={busy}
                                                        className="h-7 px-2 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10.5px] font-black"
                                                    >
                                                        🔑
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Modal de edición */}
                {editing && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                            <h2 className="text-lg font-black mb-4">Editar tenant</h2>
                            <div className="space-y-3">
                                <Field label="Nombre" value={editing.name || ""} onChange={v => setEditing({ ...editing, name: v })} />
                                <Field label="Email" value={editing.contact_email || ""} onChange={v => setEditing({ ...editing, contact_email: v })} />
                                <Field label="Tipo de negocio" value={editing.business_type || ""} onChange={v => setEditing({ ...editing, business_type: v })} />
                            </div>
                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={() => setEditing(null)}
                                    className="flex-1 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-black"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={saveEdit}
                                    disabled={busy}
                                    className="flex-1 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-black"
                                >
                                    Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ★ v4.5.12: Tab solicitudes de registro */}
                {tab === "requests" && (
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-4 sm:p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-black text-slate-900">📥 Solicitudes de Registro</h2>
                                <p className="text-[11.5px] text-slate-500">
                                    Clientes nuevos que esperan aprobación para activar su TPV.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={loadRegRequests}
                                disabled={loadingRequests}
                                className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg active:scale-95 transition disabled:opacity-50"
                            >
                                {loadingRequests ? "Cargando..." : "Refrescar"}
                            </button>
                        </div>

                        {regRequests.length === 0 ? (
                            <div className="py-12 text-center">
                                <div className="text-5xl mb-3">📭</div>
                                <p className="text-sm font-bold text-slate-700">
                                    {loadingRequests ? "Cargando solicitudes..." : "No hay solicitudes pendientes"}
                                </p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Las solicitudes aparecen aquí cuando un cliente se registra.
                                </p>
                            </div>
                        ) : (
                            <ul className="space-y-3">
                                {regRequests.map(req => (
                                    <li
                                        key={req.id}
                                        className="border border-slate-200 rounded-xl p-4 bg-slate-50"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-base font-black text-slate-900 truncate">
                                                        {req.business_name || req.name || req.email}
                                                    </span>
                                                    {req.status === "pending" && (
                                                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase">
                                                            Pendiente
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11.5px] text-slate-600 space-y-0.5">
                                                    <p>📧 {req.email}</p>
                                                    {req.name && <p>👤 {req.name}</p>}
                                                    <p>📦 Plan: {req.plan || "trial"}</p>
                                                    {req.business_type && <p>🏪 Tipo: {req.business_type}</p>}
                                                    <p className="text-slate-400">
                                                        {new Date(req.created_at).toLocaleString("es-ES")}
                                                    </p>
                                                </div>
                                            </div>
                                            {req.status === "pending" && (
                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApproveRequest(req)}
                                                        disabled={busy}
                                                        className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg active:scale-95 transition disabled:opacity-50"
                                                    >
                                                        ✅ Aprobar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRejectRequest(req)}
                                                        disabled={busy}
                                                        className="h-9 px-3 bg-rose-100 hover:bg-rose-200 text-rose-700 text-[12px] font-bold rounded-lg active:scale-95 transition disabled:opacity-50"
                                                    >
                                                        ❌ Rechazar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`${color} rounded-2xl p-4 text-white shadow-lg`}>
            <div className="text-[10.5px] uppercase tracking-widest opacity-80 font-bold">{label}</div>
            <div className="text-2xl font-black mt-1">{value}</div>
        </div>
    );
}

function StatusBadge({ status }: { status?: string }) {
    const config: Record<string, { label: string; color: string }> = {
        pending_activation: { label: "⏳ Pendiente", color: "bg-amber-100 text-amber-800" },
        active_trial: { label: "🎁 Trial", color: "bg-blue-100 text-blue-800" },
        active: { label: "✅ Activo", color: "bg-emerald-100 text-emerald-800" },
        vip: { label: "⭐ VIP", color: "bg-violet-100 text-violet-800" },
        expired: { label: "❌ Expirado", color: "bg-rose-100 text-rose-800" },
    };
    const c = config[status || ""] || { label: status || "?", color: "bg-slate-100 text-slate-800" };
    return <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-black ${c.color}`}>{c.label}</span>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="text-[10.5px] font-bold text-slate-600 uppercase tracking-widest">{label}</label>
            <input
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full h-10 mt-1 px-3 rounded-lg border border-slate-300 text-[12.5px]"
            />
        </div>
    );
}

export default AdminPanelPage;
