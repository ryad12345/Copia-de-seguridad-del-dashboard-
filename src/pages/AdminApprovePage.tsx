// =====================================================================
// MOZONA TPV — AdminApprovePage (v4.5.17-jwt-only)
// =====================================================================
// Panel de aprobación de tenants. Acceso: /admin/approve (requiere
// login como superadmin, JWT validado en el cliente Y en la Edge Function).
//
// v4.5.17: ELIMINADO token hardcoded mozona-approve-2025. H-05 auditoría.
//   La autorización se decide en el servidor (Edge Function admin-ops
//   con JWT validation + role check). El frontend solo pasa el JWT.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { IconCheck, IconArrowRight, IconUser, IconShield } from "../components/icons";
import { safeFetch } from "../lib/safeFetch";
import { supabase } from "../lib/supabase";
import { isSuperAdminEmail } from "../lib/vip";

// ★ v4.5.17: VALID_TOKENS eliminado (era vector crítico H-05).
//   Ahora la auth es JWT-only vía admin-ops edge function.

interface Tenant {
    id: string;
    name?: string;
    business_name?: string;
    contact_email?: string;
    plan_selected?: string;
    activation_status?: string;
    created_at?: string;
}

const FRIENDLY_ERROR = "No pudimos completar la operación. Por favor, inténtalo de nuevo.";

export function AdminApprovePage() {
    const [searchParams] = useSearchParams();
    const initialEmail = searchParams.get("email") || "";

    const [authorized, setAuthorized] = useState(false);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(false);
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [manualInstructions, setManualInstructions] = useState<any>(null);

    // ★ v4.5.17: autorización = JWT del superadmin. Sin tokens en URL.
    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user && isSuperAdminEmail(user.email)) {
                setAuthorized(true);
                fetchPending();
            } else {
                setError("Acceso restringido. Inicia sesion como superadmin.");
            }
        })();
    }, []);

    // ★ Si hay email en la URL, aprobar directamente
    useEffect(() => {
        if (authorized && initialEmail) {
            approveByEmail(initialEmail);
        }
    }, [authorized, initialEmail]);

    // ★ v4.5.17: usa Edge Function admin-ops con JWT (no /api/* con token)
    const fetchPending = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                { body: { action: "list_pending_tenants" } }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            setTenants(json?.tenants || []);
        } catch (e: any) {
            console.warn("[AdminApprove] fetchPending error:", e);
            setError("No pudimos cargar la lista de cuentas pendientes. Por favor, recarga la pagina.");
        }
        setLoading(false);
    }, []);

    // ★ v4.5.17: usa Edge Function admin-ops con JWT
    const approveByEmail = useCallback(async (email: string) => {
        setApprovingId(email);
        setError(null);
        setSuccess(null);
        setManualInstructions(null);

        try {
            const { data, error: fnErr } = await supabase.functions.invoke(
                "admin-ops",
                {
                    body: {
                        action: "approve_tenant",
                        email,
                        approvedBy: "admin-panel",
                    },
                }
            );
            if (fnErr) throw fnErr;
            const json = data as any;
            if (json?.ok) {
                setSuccess(`Tenant aprobado: ${email}. Trial: ${json.trialEndsAt || "(configurado)"}`);
            } else {
                setError(json?.error || FRIENDLY_ERROR);
                if (json?.manualInstructions) {
                    setManualInstructions(json.manualInstructions);
                }
            }
        } catch (e: any) {
            console.warn("[AdminApprove] approveByEmail error:", e);
            setError(e?.message || FRIENDLY_ERROR);
        }
        setApprovingId(null);
    }, []);

    // ★ v4.0.7-json-safe: blindado con safeFetch
    const approveById = useCallback(async (id: string) => {
        setApprovingId(id);
        setError(null);
        setSuccess(null);

        // ★ v4.6.0: sin tokens en la URL. safeFetch auto-inyecta el JWT
        //   del superadmin en Authorization: Bearer.
        const result = await safeFetch(`/api/approve-tenant`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId: id, approvedBy: "admin-panel" }),
        });

        if (!result.ok) {
            console.warn("[AdminApprove] approveById error:", result.error);
            setError(result.friendly_message || FRIENDLY_ERROR);
        } else {
            const json = result.data as any;
            if (json && json.ok) {
                setSuccess(`✅ Tenant aprobado: ${id}. Trial: ${json.trialEndsAt || "(configurado)"}`);
                setTenants(t => t.filter(x => x.id !== id));
            } else {
                setError((json && json.error && !String(json.error).includes("Error")) ? json.error : FRIENDLY_ERROR);
                if (json?.manualInstructions) setManualInstructions(json.manualInstructions);
            }
        }
        setApprovingId(null);
    }, []);

    if (!authorized) {
        return (
            <div className="min-h-dvh flex items-center justify-center p-5 bg-slate-50">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 text-center">
                    <IconShield size={48} className="mx-auto text-rose-500 mb-3" />
                    <h1 className="text-xl font-black mb-2">Acceso restringido</h1>
                    <p className="text-sm text-slate-600">
                        Esta página es solo para administradores. Inicia sesión con tu cuenta de superadmin.
                    </p>
                    <code className="block mt-3 p-2 bg-slate-100 rounded text-[11px] font-mono">
                        <a href="/auth" className="text-blue-600 underline">/auth</a> → entra con tu cuenta admin → /admin/approve
                    </code>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-dvh bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
            <div className="max-w-2xl mx-auto space-y-4">
                <div className="bg-white rounded-2xl shadow-xl p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <IconShield size={28} className="text-blue-600" />
                        <h1 className="text-xl font-black">Panel de aprobación</h1>
                    </div>
                    <p className="text-[12px] text-slate-500">
                        Aprueba altas de tenants. El usuario recibirá 14 días de trial.
                    </p>
                </div>

                {/* Resultado */}
                {success && (
                    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <IconCheck size={20} className="text-emerald-600" />
                            <span className="font-black text-emerald-900">Aprobado</span>
                        </div>
                        <p className="text-[12.5px] text-emerald-700">{success}</p>
                    </div>
                )}

                {error && (
                    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-5">
                        <p className="font-black text-rose-900 mb-2">Error</p>
                        <p className="text-[12.5px] text-rose-700 mb-3">{error}</p>
                        {manualInstructions && (
                            <div className="mt-3 p-3 bg-white rounded-lg border border-rose-200">
                                <p className="text-[11px] font-bold text-slate-700 mb-2">📋 Instrucciones manuales:</p>
                                <ol className="text-[11px] text-slate-600 space-y-1 list-decimal list-inside">
                                    {Object.values(manualInstructions).map((step: any, i) => (
                                        <li key={i}>{step}</li>
                                    ))}
                                </ol>
                            </div>
                        )}
                    </div>
                )}

                {/* Aprobación por email directa */}
                <div className="bg-white rounded-2xl shadow-xl p-6">
                    <h2 className="text-sm font-black mb-3">Aprobar por email</h2>
                    <EmailApprover
                        onSubmit={approveByEmail}
                        loading={!!approvingId}
                        initialEmail={initialEmail}
                    />
                </div>

                {/* Crear usuario nuevo (cuando el user no existe en Supabase Auth) */}
                <div className="bg-white rounded-2xl shadow-xl p-6">
                    <h2 className="text-sm font-black mb-1">Crear cuenta de acceso</h2>
                    <p className="text-[10.5px] text-slate-500 mb-3">
                        Crea el user en Supabase Auth con email confirmado. Útil cuando un cliente se registró pero el user no se creó.
                    </p>
                    <UserCreator />
                </div>

                {/* Lista de pendientes (si la query funcionó) */}
                <div className="bg-white rounded-2xl shadow-xl p-6">
                    <h2 className="text-sm font-black mb-3">Pendientes</h2>
                    {loading ? (
                        <p className="text-[12px] text-slate-500">Cargando...</p>
                    ) : tenants.length === 0 ? (
                        <p className="text-[12px] text-slate-500">
                            No se pudo listar automáticamente. Usa el formulario de arriba.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {tenants.map(t => (
                                <div key={t.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12.5px] font-bold truncate">
                                            {t.name || t.business_name || t.contact_email || t.id}
                                        </div>
                                        <div className="text-[10.5px] text-slate-500 truncate">
                                            {t.contact_email} • {t.plan_selected || "—"} • {t.activation_status || "?"}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => approveById(t.id)}
                                        disabled={approvingId === t.id}
                                        className="ml-2 px-3 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-[11px] font-black flex items-center gap-1"
                                    >
                                        {approvingId === t.id ? "..." : <><IconCheck size={12} /> Aprobar</>}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* URLs de ayuda */}
                <div className="bg-slate-100 rounded-2xl p-5 text-[11px] text-slate-600 space-y-2">
                    <p className="font-bold text-slate-700">URLs útiles:</p>
                    <code className="block bg-white p-2 rounded font-mono">
                        <a href="/auth" className="text-blue-600 underline">/auth</a> → login como superadmin
                    </code>
                    <code className="block bg-white p-2 rounded font-mono">
                        /welcome?email=user@example.com
                    </code>
                </div>
            </div>
        </div>
    );
}

function EmailApprover({ onSubmit, loading, initialEmail }: { onSubmit: (e: string) => void; loading: boolean; initialEmail: string }) {
    const [email, setEmail] = useState(initialEmail);
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email.trim()) onSubmit(email.trim().toLowerCase());
    };
    return (
        <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="flex-1 relative">
                <IconUser size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@ejemplo.com"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-[12.5px]"
                    required
                />
            </div>
            <button
                type="submit"
                disabled={loading}
                className="px-4 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[12.5px] font-black flex items-center gap-1"
            >
                {loading ? "Aprobando..." : <>Aprobar <IconArrowRight size={12} /></>}
            </button>
        </form>
    );
}

// ★ v4.0.7-json-safe: UserCreator con safeFetch
function UserCreator() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || password.length < 6) return;
        setLoading(true);
        setResult(null);

        // ★ v4.6.0: sin token en la URL. safeFetch auto-inyecta el JWT
        //   del superadmin en Authorization: Bearer.
        const r = await safeFetch(`/api/create-user`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim().toLowerCase(), password, name }),
        });

        if (!r.ok) {
            console.warn("[UserCreator] error:", r.error);
            setResult({
                ok: false,
                success: false,
                error: r.friendly_message || r.error || FRIENDLY_ERROR,
            });
        } else {
            setResult(r.data || { ok: false, success: false, error: "Respuesta vacía del servidor" });
        }
        setLoading(false);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative">
                <IconUser size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@ejemplo.com"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-[12.5px]"
                    required
                />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Contraseña (min 6)"
                    minLength={6}
                    className="h-10 px-3 rounded-lg border border-slate-300 text-[12.5px]"
                    required
                />
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Nombre del negocio"
                    className="h-10 px-3 rounded-lg border border-slate-300 text-[12.5px]"
                />
            </div>
            <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[12.5px] font-black flex items-center justify-center gap-1"
            >
                {loading ? "Creando..." : <><IconCheck size={12} /> Crear usuario y enviar credenciales</>}
            </button>
            {result && (
                <div className={`p-3 rounded-lg text-[12px] ${(result.ok || result.success) ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"}`}>
                    {(result.ok || result.success)
                        ? `✅ Usuario creado: ${result.email || email}`
                        : `❌ ${result.error || FRIENDLY_ERROR}`}
                </div>
            )}
        </form>
    );
}
