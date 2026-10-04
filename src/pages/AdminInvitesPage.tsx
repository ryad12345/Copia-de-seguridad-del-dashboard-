// =====================================================================
// MOZONA TPV — AdminInvitesPage (/admin/invites)
// =====================================================================
// Panel EXCLUSIVO del SuperAdmin.  Genera tokens/enlaces de invitación
// únicos con selección de plan.  Lista invitaciones activas y canjeadas.
//
// Acceso: sólo si auth.isSuperAdmin === true (gated por AdminRoute).
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase, PUBLIC_URL } from "../lib/supabase";
import { IconSparkles, IconShield, IconCheck, IconX, IconCopy, IconRefresh, IconUser } from "../components/icons";
import { ClientSubscriptionsPanel } from "../components/admin/ClientSubscriptionsPanel";

interface Invite {
    id:          string;
    token:       string;
    plan_granted: string;
    is_redeemed: boolean;
    target_email: string | null;
    created_at:  string;
    redeemed_by: string | null;
    expires_at:  string | null;
}

const PLAN_OPTIONS = [
    { value: "plus_30",     label: "Plus (30€/mes)" },
    { value: "pro_50",      label: "Pro (50€/mes)" },
    { value: "lifetime_vip", label: "Vitalicio VIP" },
] as const;

export function AdminInvitesPage() {
    const auth = useAuth();
    const nav  = useNavigate();
    const [tab,       setTab]       = useState<"invites" | "clients">("invites");
    const [invites,   setInvites]   = useState<Invite[]>([]);
    const [loading,   setLoading]   = useState(true);
    const [generating, setGenerating] = useState(false);
    const [plan,      setPlan]      = useState<typeof PLAN_OPTIONS[number]["value"]>("lifetime_vip");
    const [target,    setTarget]    = useState("");
    const [copiedId,  setCopiedId]  = useState<string | null>(null);
    const [msg,       setMsg]       = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    useEffect(() => {
        if (auth.isReady && !auth.isSuperAdmin) nav("/app", { replace: true });
    }, [auth.isReady, auth.isSuperAdmin, nav]);

    const load = async () => {
        if (!isSupabaseConfigured) { setLoading(false); return; }
        setLoading(true);
        const { data, error } = await supabase
            .from("free_invitations")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);
        if (error) {
            setMsg({ kind: "err", text: error.message });
        } else {
            setInvites((data as Invite[]) ?? []);
        }
        setLoading(false);
    };

    useEffect(() => { void load(); }, []);

    const generate = async () => {
        if (!isSupabaseConfigured) return;
        setGenerating(true);
        setMsg(null);
        const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
        const { data, error } = await supabase
            .from("free_invitations")
            .insert({
                token,
                plan_granted: plan,
                target_email: target.trim() || null,
                is_redeemed:  false,
            })
            .select()
            .single();
        setGenerating(false);
        if (error) {
            setMsg({ kind: "err", text: error.message });
            return;
        }
        setInvites(prev => [data as Invite, ...prev]);
        setMsg({ kind: "ok", text: `Invitación ${plan} creada.  Comparte el enlace.` });
        setTarget("");
    };

    const revoke = async (id: string) => {
        if (!confirm("¿Revocar esta invitación?")) return;
        const { error } = await supabase.from("free_invitations").delete().eq("id", id);
        if (error) setMsg({ kind: "err", text: error.message });
        else {
            setInvites(prev => prev.filter(i => i.id !== id));
            setMsg({ kind: "ok", text: "Invitación revocada" });
        }
    };

    const copyLink = (inv: Invite) => {
        const link = `${PUBLIC_URL}/auth?invite=${inv.token}`;
        navigator.clipboard.writeText(link);
        setCopiedId(inv.id);
        setTimeout(() => setCopiedId(null), 1800);
    };

    const stats = {
        total:   invites.length,
        active:  invites.filter(i => !i.is_redeemed).length,
        used:    invites.filter(i =>  i.is_redeemed).length,
        vip:     invites.filter(i => i.plan_granted === "lifetime_vip").length,
    };

    return (
        <div className="min-h-dvh bg-slate-50">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200/80">
                <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-3">
                    <Link to="/app" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-violet-700
                                        text-white flex items-center justify-center font-black text-sm
                                        shadow-sm shadow-violet-600/30">
                            A
                        </div>
                        <span className="text-[15px] font-black tracking-tight">Admin · Invitaciones</span>
                    </Link>
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                                     bg-violet-100 text-violet-800
                                     text-[10px] font-bold tracking-wider">
                        <IconShield size={10} strokeWidth={2.4} />
                        SUPERADMIN
                    </span>
                    <div className="flex-1" />
                    <Link to="/app" className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-700">
                        Volver al panel
                    </Link>
                </div>
            </header>

            <div className="max-w-6xl mx-auto px-5 py-6 space-y-6">
                {/* Tab switcher */}
                <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-100 border border-slate-200/80 w-fit">
                    <button onClick={() => setTab("invites")}
                            className={
                                "h-9 px-4 rounded-xl text-[12.5px] font-bold transition " +
                                (tab === "invites"
                                    ? "bg-white text-violet-700 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700")
                            }>
                        Invitaciones
                    </button>
                    <button onClick={() => setTab("clients")}
                            className={
                                "h-9 px-4 rounded-xl text-[12.5px] font-bold transition flex items-center gap-1.5 " +
                                (tab === "clients"
                                    ? "bg-white text-violet-700 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700")
                            }>
                        <IconUser size={13} strokeWidth={2.2} />
                        Clientes
                    </button>
                </div>

                {tab === "clients" ? (
                    <ClientSubscriptionsPanel />
                ) : (
                    <>
                        {/* Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Total"        value={stats.total} />
                    <StatCard label="Activas"      value={stats.active} tone="emerald" />
                    <StatCard label="Canjeadas"    value={stats.used}   tone="blue" />
                    <StatCard label="Lifetime VIP" value={stats.vip}    tone="violet" />
                </div>

                {/* Generador */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <IconSparkles size={16} strokeWidth={1.8} className="text-violet-600" />
                        <h2 className="text-[15px] font-black">Generar nueva invitación</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
                        <div>
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Plan</label>
                            <select value={plan} onChange={e => setPlan(e.target.value as typeof plan)}
                                    className="input mt-1">
                                {PLAN_OPTIONS.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                Email objetivo (opcional)
                            </label>
                            <input type="email" value={target} onChange={e => setTarget(e.target.value)}
                                   placeholder="cliente@ejemplo.com" className="input mt-1" />
                        </div>
                        <button onClick={generate} disabled={generating}
                                className="self-end h-11 px-5 rounded-xl
                                           bg-violet-600 text-white text-[13px] font-bold
                                           shadow-sm shadow-violet-600/30
                                           active:scale-95 transition disabled:opacity-50">
                            {generating ? "Creando…" : "Crear invitación"}
                        </button>
                    </div>
                    {msg && (
                        <div className={
                            "mt-3 p-2.5 rounded-xl text-[12px] " +
                            (msg.kind === "ok"
                                ? "bg-emerald-50 border border-emerald-200/80 text-emerald-800"
                                : "bg-rose-50 border border-rose-200/80 text-rose-700")
                        }>
                            {msg.text}
                        </div>
                    )}
                </div>

                {/* Listado */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-[15px] font-black">Listado de invitaciones</h2>
                        <button onClick={load}
                                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100
                                           flex items-center justify-center active:scale-90 transition">
                            <IconRefresh size={16} strokeWidth={2} />
                        </button>
                    </div>
                    {loading ? (
                        <div className="py-8 text-center text-[12.5px] text-slate-400">Cargando…</div>
                    ) : invites.length === 0 ? (
                        <div className="py-8 text-center text-[12.5px] text-slate-400">
                            No hay invitaciones todavía.
                        </div>
                    ) : (
                        <div className="overflow-x-auto -mx-2">
                            <table className="w-full text-[12.5px]">
                                <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200">
                                        <th className="px-2 py-2 font-bold">Token</th>
                                        <th className="px-2 py-2 font-bold">Plan</th>
                                        <th className="px-2 py-2 font-bold">Email</th>
                                        <th className="px-2 py-2 font-bold">Estado</th>
                                        <th className="px-2 py-2 font-bold">Creada</th>
                                        <th className="px-2 py-2 font-bold text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invites.map(inv => (
                                        <tr key={inv.id} className="border-b border-slate-100">
                                            <td className="px-2 py-2.5 font-mono text-[11.5px] text-slate-700">
                                                {inv.token.slice(0, 12)}…
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <PlanBadge plan={inv.plan_granted} />
                                            </td>
                                            <td className="px-2 py-2.5 text-slate-600">
                                                {inv.target_email ?? "—"}
                                            </td>
                                            <td className="px-2 py-2.5">
                                                {inv.is_redeemed
                                                    ? <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-bold">
                                                          <IconCheck size={12} strokeWidth={2.4} /> Canjeada
                                                      </span>
                                                    : <span className="inline-flex items-center gap-1 text-blue-700 text-[11px] font-bold">
                                                          <IconSparkles size={12} strokeWidth={2.2} /> Activa
                                                      </span>
                                                }
                                            </td>
                                            <td className="px-2 py-2.5 text-slate-500">
                                                {new Date(inv.created_at).toLocaleDateString("es-ES")}
                                            </td>
                                            <td className="px-2 py-2.5 text-right">
                                                <div className="inline-flex gap-1">
                                                    <button onClick={() => copyLink(inv)}
                                                            className="h-7 px-2.5 rounded-md text-[10.5px] font-bold
                                                                       bg-blue-50 text-blue-700 hover:bg-blue-100
                                                                       flex items-center gap-1.5 active:scale-95 transition"
                                                            title={`Copiar enlace: ${PUBLIC_URL}/auth?invite=${inv.token}`}>
                                                        {copiedId === inv.id
                                                            ? <><IconCheck size={13} strokeWidth={2.4} className="text-emerald-500" /> ¡Copiado!</>
                                                            : <><IconCopy  size={13} strokeWidth={2}   /> Copiar enlace</>
                                                        }
                                                    </button>
                                                    {!inv.is_redeemed && (
                                                        <button onClick={() => revoke(inv.id)}
                                                                className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50
                                                                           flex items-center justify-center active:scale-90 transition"
                                                                title="Revocar">
                                                            <IconX size={14} strokeWidth={2.2} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function StatCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "blue" | "violet" }) {
    const tones = {
        slate:   "bg-slate-100 text-slate-700",
        emerald: "bg-emerald-100 text-emerald-700",
        blue:    "bg-blue-100 text-blue-700",
        violet:  "bg-violet-100 text-violet-700",
    };
    return (
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
            <div className={"mt-1 text-[28px] font-black tabular-nums " + tones[tone].split(" ")[1]}>
                {value}
            </div>
        </div>
    );
}

function PlanBadge({ plan }: { plan: string }) {
    const styles: Record<string, string> = {
        plus_30:      "bg-blue-50 text-blue-700",
        pro_50:       "bg-violet-50 text-violet-700",
        lifetime_vip: "bg-amber-50 text-amber-800",
    };
    const labels: Record<string, string> = {
        plus_30:      "Plus",
        pro_50:       "Pro",
        lifetime_vip: "VIP",
    };
    return (
        <span className={"px-2 py-0.5 rounded-full text-[10.5px] font-bold " + (styles[plan] ?? "bg-slate-100 text-slate-600")}>
            {labels[plan] ?? plan}
        </span>
    );
}
