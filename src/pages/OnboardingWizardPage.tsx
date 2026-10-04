// =====================================================================
// MOZONA TPV — OnboardingWizardPage (/setup/onboarding) v4.0.7-onboarding-fix
// =====================================================================
// Wizard de primera configuración. Se muestra solo si
// tenant.onboarding_completed === false.
//
// Paso 1: Identidad (nombre comercial, CIF/NIF, teléfono)
// Paso 2: Dirección y facturación (dirección, CP, ciudad, IVA por defecto)
//
// Al terminar:
//   - Guarda en tenants via rpc_save_tenant_full (SECURITY DEFINER, bypasa RLS anon)
//   - Marca onboarding_completed = true
//   - Redirige a /app (sin bucles, sin redirecciones hacia atrás)
//
// Mantiene intacta la sesión del usuario y la lógica VIP.
// =====================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { rpcSaveTenantFull } from "../lib/secureRpc";
import { IconCheck, IconStore, IconArrowRight, IconArrowLeft } from "../components/icons";

interface FormData {
    name:         string;
    cif_nif:      string;
    phone:        string;
    address:      string;
    postal_code:  string;
    city:         string;
    default_iva:  number;
}

const DEFAULT_FORM: FormData = {
    name:         "",
    cif_nif:      "",
    phone:        "",
    address:      "",
    postal_code:  "",
    city:         "",
    default_iva:  10,
};

export function OnboardingWizardPage() {
    const auth    = useAuth();
    const nav     = useNavigate();
    const [step,  setStep]  = useState<1 | 2>(1);
    const [form,  setForm]  = useState<FormData>({
        ...DEFAULT_FORM,
        name: (auth.tenant?.name as string) ?? "",
        cif_nif: (auth.tenant as any)?.cif_nif ?? "",
        phone:   (auth.tenant as any)?.phone   ?? "",
        address: (auth.tenant as any)?.address ?? "",
    });
    const [saving,  setSaving]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    const update = <K extends keyof FormData>(k: K, v: FormData[K]) => {
        setForm(prev => ({ ...prev, [k]: v }));
    };

    const validateStep1 = (): string | null => {
        if (!form.name.trim())    return "El nombre comercial es obligatorio";
        if (form.name.length < 2) return "Nombre demasiado corto";
        return null;
    };

    const next = () => {
        const err = validateStep1();
        if (err) { setError(err); return; }
        setError(null);
        setStep(2);
    };

    const back = () => { setError(null); setStep(1); };

    const save = async () => {
        if (!auth.tenant) {
            setError("No hay tenant activo. Inicia sesión de nuevo.");
            return;
        }
        if (!isSupabaseConfigured) {
            setError("Supabase no configurado");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            // ★ v4.0.7-onboarding-fix: Usa RPC SECURITY DEFINER que bypasa RLS anon.
            //   Antes fallaba con "new row violates row-level security policy" porque
            //   el cliente anon_key no tiene sesion auth.uid(). Ahora la SQL function
            //   valida el tenant via auth.uid() del JWT o via vip_emails bypass.
            const fullAddress = [form.address.trim(), form.postal_code.trim(), form.city.trim()]
                .filter(Boolean).join(", ") || null;

            const patch: Record<string, any> = {
                name:                 form.name.trim(),
                cif_nif:              form.cif_nif.trim() || null,
                phone:                form.phone.trim()   || null,
                address:              fullAddress,
                postal_code:          form.postal_code.trim() || null,
                city:                 form.city.trim() || null,
                default_iva:          Number(form.default_iva) || 10,
                onboarding_completed: true,
            };

            const result = await rpcSaveTenantFull(patch);

            if (!result.ok) {
                console.warn("[Onboarding] save fallo:", result.error);
                setError("No pudimos guardar la información. Por favor, inténtalo de nuevo.");
                setSaving(false);
                return;
            }

            // ★ v4.0.7-onboarding-fix: Actualizar tenant LOCALMENTE ANTES de navegar.
            //   Sin esto, ProtectedRoute ve onboarding_completed=false (cache viejo)
            //   y redirige al wizard → BUCLE INFINITO.
            auth.patchTenant?.({
                ...patch,
                onboarding_completed: true,
            });

            // Refrescar en background (best-effort, sin bloquear la navegacion)
            auth.refresh?.()?.catch(() => {});

            // Redirigir a /app limpio
            nav("/app", { replace: true });
        } catch (e: any) {
            console.warn("[Onboarding] save error:", e);
            setError("No pudimos guardar la información. Por favor, inténtalo de nuevo.");
        }
        setSaving(false);
    };

    return (
        <div className="min-h-dvh w-full bg-gradient-to-br from-blue-50 to-slate-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg">
                {/* Cabecera */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full
                                    bg-blue-100 text-blue-700 text-[10.5px] font-black tracking-wider">
                        <IconStore size={11} strokeWidth={2.4} />
                        CONFIGURACIÓN INICIAL
                    </div>
                    <h1 className="mt-3 text-[22px] font-black text-slate-900 tracking-tight">
                        Bienvenido a MOZONA TPV
                    </h1>
                    <p className="text-[12.5px] text-slate-500 mt-1">
                        Solo te llevará un minuto configurar tu local.
                    </p>
                </div>

                {/* Stepper */}
                <div className="flex items-center justify-center gap-2 mb-5">
                    <StepDot n={1} active={step === 1} done={step === 2} label="Identidad" />
                    <div className="h-px w-8 bg-slate-300" />
                    <StepDot n={2} active={step === 2} done={false}      label="Dirección" />
                </div>

                {/* Card */}
                <div className="bg-white rounded-3xl shadow-xl border border-slate-200/80 p-6 sm:p-7">
                    {step === 1 && (
                        <div className="space-y-3">
                            <h2 className="text-[14px] font-black text-slate-800 mb-1">
                                Identidad del Restaurante
                            </h2>
                            <Field
                                label="Nombre comercial"
                                required
                                value={form.name}
                                onChange={v => update("name", v)}
                                placeholder="Ej: Rincón de Casablanca"
                            />
                            <Field
                                label="CIF / NIF"
                                value={form.cif_nif}
                                onChange={v => update("cif_nif", v)}
                                placeholder="B12345678"
                            />
                            <Field
                                label="Teléfono del local"
                                value={form.phone}
                                onChange={v => update("phone", v)}
                                placeholder="911 234 567"
                                type="tel"
                            />
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-3">
                            <h2 className="text-[14px] font-black text-slate-800 mb-1">
                                Dirección y Facturación
                            </h2>
                            <Field
                                label="Dirección completa"
                                value={form.address}
                                onChange={v => update("address", v)}
                                placeholder="Calle Mayor 12"
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <Field
                                    label="Código postal"
                                    value={form.postal_code}
                                    onChange={v => update("postal_code", v)}
                                    placeholder="28013"
                                />
                                <Field
                                    label="Ciudad"
                                    value={form.city}
                                    onChange={v => update("city", v)}
                                    placeholder="Madrid"
                                />
                            </div>
                            <div>
                                <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                                    IVA por defecto (%)
                                </label>
                                <select value={form.default_iva}
                                        onChange={e => update("default_iva", Number(e.target.value))}
                                        className="input mt-1">
                                    <option value={10}>10% (hostelería general)</option>
                                    <option value={21}>21% (bebidas alcohólicas, general)</option>
                                    <option value={4}>4% (pan, libros, básicos)</option>
                                    <option value={0}>0% (exento)</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200/80 text-[12px] text-rose-700">
                            {error}
                        </div>
                    )}

                    <div className="mt-5 flex items-center justify-between">
                        {step === 1 ? (
                            <div className="text-[10.5px] text-slate-400">
                                Paso 1 de 2
                            </div>
                        ) : (
                            <button onClick={back} disabled={saving}
                                    className="h-10 px-3 rounded-xl text-[12.5px] font-bold text-slate-600
                                               hover:bg-slate-100 active:scale-95 transition flex items-center gap-1.5">
                                <IconArrowLeft size={14} strokeWidth={2.2} />
                                Atrás
                            </button>
                        )}
                        {step === 1 ? (
                            <button onClick={next}
                                    className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[13px] font-black
                                               shadow-sm shadow-blue-600/30 active:scale-95 transition
                                               flex items-center gap-1.5">
                                Siguiente
                                <IconArrowRight size={14} strokeWidth={2.2} />
                            </button>
                        ) : (
                            <button onClick={save} disabled={saving}
                                    className="h-11 px-5 rounded-xl bg-emerald-600 text-white text-[13px] font-black
                                               shadow-sm shadow-emerald-600/30 active:scale-95 transition
                                               disabled:opacity-50 flex items-center gap-1.5">
                                {saving ? "Guardando…" : (
                                    <>
                                        <IconCheck size={14} strokeWidth={2.4} />
                                        Guardar y empezar a usar MOZONA TPV
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
    const circleCls = done
        ? "bg-emerald-500 text-white"
        : active
            ? "bg-blue-600 text-white"
            : "bg-slate-200 text-slate-500";
    return (
        <div className="flex items-center gap-1.5">
            <div className={"w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-black " + circleCls}>
                {done ? <IconCheck size={13} strokeWidth={2.4} /> : n}
            </div>
            <span className={"text-[11.5px] font-bold " + (active ? "text-slate-800" : "text-slate-500")}>
                {label}
            </span>
        </div>
    );
}

function Field({ label, value, onChange, placeholder, type = "text", required = false }:
               { label: string; value: string; onChange: (v: string) => void;
                 placeholder?: string; type?: string; required?: boolean }) {
    return (
        <div>
            <label className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                {label}{required && " *"}
            </label>
            <input type={type} value={value} onChange={e => onChange(e.target.value)}
                   placeholder={placeholder} required={required}
                   className="input mt-1" />
        </div>
    );
}
