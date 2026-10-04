// =====================================================================
// MOZONA TPV — OnboardingWizard (/setup/onboarding)
// =====================================================================
// Wizard de bienvenida post-pago.  5 pasos con barra de progreso.
// Sólo se muestra una vez (cuando `tenant.onboarding_completed = false`).
// Al terminar marca el flag y redirige al TPV o al comandero.
//
// Paso 1: Datos del restaurante
// Paso 2: Zonas y mesas
// Paso 3: Carta y menú (manual / plantilla / OCR con IA)
// Paso 4: Equipo y seguridad
// Paso 5: Resumen y lanzamiento
// =====================================================================

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
    IconStore, IconArrowRight, IconArrowLeft, IconCheck,
    IconSparkles, IconLogout, IconUser,
} from "../components/icons";
import { Logo } from "../components/Logo";
import { BusinessStep, type BusinessData }   from "../components/onboarding/BusinessStep";
import { TablesStep, type TablesData }       from "../components/onboarding/TablesStep";
import { MenuStep, type MenuData }           from "../components/onboarding/MenuStep";
import { TeamStep, type TeamData }           from "../components/onboarding/TeamStep";
import { SummaryStep }                       from "../components/onboarding/SummaryStep";
import { createWaiter }                      from "../lib/waiters";

const STEPS = [
    { id: 1, key: "business", title: "Tu restaurante",   Icon: IconStore   },
    { id: 2, key: "tables",   title: "Mesas y zonas",    Icon: IconSparkles },
    { id: 3, key: "menu",     title: "La carta",         Icon: IconUser    },
    { id: 4, key: "team",     title: "Tu equipo",        Icon: IconUser    },
    { id: 5, key: "summary",  title: "¡Listo!",          Icon: IconCheck   },
] as const;

export interface OnboardingData {
    business: BusinessData;
    tables:   TablesData;
    menu:     MenuData;
    team:     TeamData;
}

const INITIAL: OnboardingData = {
    business: {
        business_name: "",
        cif_nif:       "",
        address:       "",
        phone:         "",
        default_tax_rate: 10,
    },
    tables: { zones: [] },
    menu:   { items: [] },
    team:   { waiters: [] },
};

export function OnboardingWizard() {
    const auth = useAuth();
    const nav  = useNavigate();

    const [step,  setStep]  = useState(1);
    const [data,  setData]  = useState<OnboardingData>(INITIAL);
    const [busy,  setBusy]  = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Pre-rellenar business_name con el del tenant
    useEffect(() => {
        if (auth.tenant && !data.business.business_name) {
            setData(prev => ({
                ...prev,
                business: { ...prev.business, business_name: auth.tenant!.name },
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.tenant?.id]);

    // Si ya completó onboarding → redirigir a /app
    useEffect(() => {
        if (auth.isReady && auth.tenant?.onboarding_completed) {
            nav("/app", { replace: true });
        }
    }, [auth.isReady, auth.tenant?.onboarding_completed, nav]);

    const currentStep = STEPS.find(s => s.id === step) ?? STEPS[0];
    const progress    = ((step - 1) / (STEPS.length - 1)) * 100;

    const goNext = () => setStep(s => Math.min(STEPS.length, s + 1));
    const goPrev = () => setStep(s => Math.max(1, s - 1));

    // -----------------------------------------------------------------
    // Persistencia por paso (optimistic + validación)
    // -----------------------------------------------------------------

    const persistStep = async (): Promise<boolean> => {
        if (!isSupabaseConfigured || !auth.tenant) return true; // demo: skip
        setError(null);
        try {
            if (step === 1) {
                const { error } = await supabase.from("tenants").update({
                    name:            data.business.business_name,
                    cif_nif:         data.business.cif_nif || null,
                    address:         data.business.address || null,
                    phone:           data.business.phone   || null,
                    default_tax_rate: data.business.default_tax_rate,
                }).eq("id", auth.tenant.id);
                if (error) throw error;
            } else if (step === 2) {
                // ★ v4.0.7-military: Borrar mesas existentes del tenant y re-insertar.
                //   OPERACIÓN DESTRUCTIVA pero IDEMPOTENTE.
                //   - Filtrado por tenant_id (no masivo)
                //   - Rollback natural: si falla el insert, el cliente no pierde datos críticos
                //   - El set de mesas se reemplaza atómicamente
                try {
                    const { error: delErr, count: delCount } = await supabase
                        .from("dining_tables")
                        .delete({ count: "exact" })
                        .eq("tenant_id", auth.tenant.id);
                    if (delErr) {
                        console.error("[OnboardingWizard] delete tables warn:", delErr);
                        // No abortamos: continuamos con el insert (puede que no haya nada que borrar)
                    } else {
                        console.info(`[OnboardingWizard] ${delCount ?? 0} mesas anteriores eliminadas`);
                    }
                } catch (e) {
                    console.error("[OnboardingWizard] delete tables EXCEPTION:", e);
                    // Continuamos: si el delete falla, el insert creará nuevas mesas
                }
                const rows = data.tables.zones.flatMap(z =>
                    Array.from({ length: z.tableCount }, (_, i) => ({
                        tenant_id: auth.tenant!.id,
                        name:      z.tablePrefix
                            ? `${z.tablePrefix}-${i + 1}`
                            : `${z.name}-${i + 1}`,
                        zone:      z.name,
                        status:    "available",
                    })),
                );
                if (rows.length > 0) {
                    const { error } = await supabase.from("dining_tables").insert(rows);
                    if (error) throw error;
                }
            } else if (step === 3) {
                // Categorías + productos
                if (data.menu.items.length > 0) {
                    // 1) Recopilar categorías únicas
                    const categoryNames = Array.from(new Set(
                        data.menu.items.map(i => i.category).filter(Boolean)
                    )) as string[];
                    const categoryIdByName = new Map<string, string>();
                    for (let i = 0; i < categoryNames.length; i++) {
                        const name = categoryNames[i];
                        const { data: cat, error: catErr } = await supabase.from("categories")
                            .insert({ tenant_id: auth.tenant!.id, name, sort_order: i })
                            .select("id").single();
                        if (catErr) throw catErr;
                        categoryIdByName.set(name, cat.id);
                    }
                    // 2) Insertar productos
                    const productRows = data.menu.items
                        .filter(it => it.name)
                        .map((it, idx) => ({
                            tenant_id:   auth.tenant!.id,
                            category_id: it.category ? categoryIdByName.get(it.category) ?? null : null,
                            name:        it.name,
                            price:       it.price,
                            tax_rate:    it.tax_rate,
                            description: it.description || null,
                            sort_order:  idx,
                        }));
                    if (productRows.length > 0) {
                        const { error } = await supabase.from("products").insert(productRows);
                        if (error) throw error;
                    }
                }
            } else if (step === 4) {
                // Camareros
                // ★ v4.6.0 (H-07): NUNCA se guarda el PIN en claro. Se usa la
                //   tabla canónica `waiters` y la RPC set_waiter_pin, que
                //   hashea el PIN (bcrypt) server-side. NO se escribe pin_code
                //   en tenant_users.
                const team = data.team.waiters.filter(w => w.name.trim());
                for (const w of team) {
                    const res = await createWaiter({
                        tenant_id: auth.tenant!.id,
                        name:      w.name.trim(),
                        full_name: w.name.trim(),
                        role:      w.role,
                        pin:       w.pin,
                    });
                    if (!res.ok) {
                        throw new Error(res.error || `No se pudo crear el camarero ${w.name}`);
                    }
                }
            }
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    };

    const handleNext = async () => {
        // Validación mínima: nombre del restaurante obligatorio
        if (step === 1 && !data.business.business_name.trim()) {
            setError("El nombre del restaurante es obligatorio");
            return;
        }
        if (step < STEPS.length) {
            setBusy(true);
            setError(null);
            const ok = await persistStep();
            setBusy(false);
            if (ok) goNext();
        } else {
            // Final step: marcar onboarding_completed y redirigir
            await launch();
        }
    };

    const launch = async () => {
        if (!auth.tenant) return;
        setBusy(true);
        setError(null);
        try {
            if (isSupabaseConfigured) {
                const { error } = await supabase.from("tenants").update({
                    onboarding_completed: true,
                }).eq("id", auth.tenant.id);
                if (error) throw error;
            }
            // Refrescar el auth state para que el guard no nos redirija
            await (auth.refresh ?? (async () => {}))();
            nav("/app", { replace: true });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------

    if (!auth.tenant) {
        return (
            <Centered>
                <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200/80 text-[12.5px] text-rose-800">
                    No hay tenant activo.  Ve a <strong>/welcome</strong> para configurar tu cuenta.
                </div>
            </Centered>
        );
    }

    return (
        <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-white flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200/80">
                <div className="max-w-5xl mx-auto px-4 sm:px-5 h-14 flex items-center gap-3">
                    <div className="w-8 h-8">
                        <Logo variant="square" size="xs" className="w-8 h-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-black tracking-tight">Asistente de configuración</div>
                        <div className="text-[10.5px] text-slate-500 truncate">
                            {auth.tenant.name}
                        </div>
                    </div>
                    <button onClick={() => auth.signOut()}
                            className="w-9 h-9 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100
                                       flex items-center justify-center active:scale-95 transition"
                            title="Cerrar sesión">
                        <IconLogout size={16} strokeWidth={1.8} />
                    </button>
                </div>
                {/* Progress bar */}
                <div className="h-1 bg-slate-100">
                    <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </header>

            {/* Stepper (sm+) */}
            <nav className="hidden sm:block max-w-5xl mx-auto px-5 pt-6">
                <ol className="flex items-center justify-between">
                    {STEPS.map(s => {
                        const isDone   = s.id <  step;
                        const isActive = s.id === step;
                        return (
                            <li key={s.id} className="flex-1 flex items-center">
                                <div className="flex flex-col items-center text-center px-1">
                                    <div
                                        className={
                                            "w-9 h-9 rounded-full flex items-center justify-center " +
                                            (isDone
                                                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                                                : isActive
                                                    ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                                                    : "bg-slate-100 text-slate-400")
                                        }
                                    >
                                        {isDone
                                            ? <IconCheck size={16} strokeWidth={2.6} />
                                            : <span className="text-[13px] font-black">{s.id}</span>
                                        }
                                    </div>
                                    <div className={
                                        "mt-1.5 text-[10.5px] font-bold tracking-wider uppercase " +
                                        (isActive ? "text-blue-700" : isDone ? "text-emerald-700" : "text-slate-400")
                                    }>
                                        {s.title}
                                    </div>
                                </div>
                                {s.id < STEPS.length && (
                                    <div className={
                                        "flex-1 h-0.5 mx-1 -mt-5 " +
                                        (isDone ? "bg-emerald-500" : "bg-slate-200")
                                    } />
                                )}
                            </li>
                        );
                    })}
                </ol>
            </nav>

            {/* Mobile step badge */}
            <div className="sm:hidden max-w-5xl mx-auto px-4 pt-3 flex items-center gap-2">
                <div className="
                    w-7 h-7 rounded-full bg-blue-600 text-white
                    text-[12px] font-black flex items-center justify-center
                ">
                    {step}
                </div>
                <div className="text-[13px] font-black text-slate-700">
                    {currentStep.title}
                </div>
                <div className="text-[10.5px] text-slate-400 ml-auto">
                    {step}/{STEPS.length}
                </div>
            </div>

            {/* Step content */}
            <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-5 py-6 sm:py-8">
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-5 sm:p-7">
                    {step === 1 && (
                        <BusinessStep
                            value={data.business}
                            onChange={d => setData(prev => ({ ...prev, business: d }))}
                        />
                    )}
                    {step === 2 && (
                        <TablesStep
                            value={data.tables}
                            onChange={d => setData(prev => ({ ...prev, tables: d }))}
                        />
                    )}
                    {step === 3 && (
                        <MenuStep
                            value={data.menu}
                            onChange={d => setData(prev => ({ ...prev, menu: d }))}
                        />
                    )}
                    {step === 4 && (
                        <TeamStep
                            value={data.team}
                            onChange={d => setData(prev => ({ ...prev, team: d }))}
                        />
                    )}
                    {step === 5 && (
                        <SummaryStep data={data} />
                    )}

                    {error && (
                        <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200/80
                                        text-[12.5px] text-rose-700">
                            {error}
                        </div>
                    )}
                </div>
            </main>

            {/* Footer con navegación */}
            <footer className="
                sticky bottom-0 z-30
                bg-white/95 backdrop-blur-xl
                border-t border-slate-200/80
                shadow-[0_-4px_20px_-4px_rgb(0_0_0_/_0.08)]
                px-4 sm:px-5 py-3
                pb-[max(0.75rem,env(safe-area-inset-bottom))]
            ">
                <div className="max-w-5xl mx-auto flex items-center gap-2">
                    <button onClick={goPrev} disabled={step === 1 || busy}
                            className="
                                h-11 px-4 rounded-xl
                                bg-slate-100 hover:bg-slate-200
                                text-[12.5px] font-semibold text-slate-700
                                flex items-center gap-1.5
                                disabled:opacity-30 disabled:cursor-not-allowed
                                active:scale-95 transition
                            ">
                        <IconArrowLeft size={14} strokeWidth={2.4} />
                        <span className="hidden sm:inline">Atrás</span>
                    </button>
                    <div className="flex-1" />
                    {step < STEPS.length ? (
                        <button onClick={handleNext} disabled={busy}
                                className="
                                    h-11 px-5 rounded-xl
                                    bg-blue-600 text-white
                                    text-[13px] font-black
                                    shadow-sm shadow-blue-600/30
                                    flex items-center gap-1.5
                                    disabled:opacity-50
                                    active:scale-95 transition
                                ">
                            {busy ? "Guardando…" : "Continuar"}
                            <IconArrowRight size={14} strokeWidth={2.4} />
                        </button>
                    ) : (
                        <button onClick={launch} disabled={busy}
                                className="
                                    h-11 px-5 rounded-xl
                                    bg-emerald-600 text-white
                                    text-[13px] font-black
                                    shadow-sm shadow-emerald-600/30
                                    flex items-center gap-1.5
                                    disabled:opacity-50
                                    active:scale-95 transition
                                ">
                            <IconCheck size={16} strokeWidth={2.6} />
                            {busy ? "Iniciando…" : "Comenzar el servicio"}
                        </button>
                    )}
                </div>
            </footer>
        </div>
    );
}

// ---------------------------------------------------------------------
// Centered: loader inicial
// ---------------------------------------------------------------------

function Centered({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
            {children}
        </div>
    );
}
