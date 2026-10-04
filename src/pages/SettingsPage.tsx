// =====================================================================
// MOZONA TPV — SettingsPage (versión completa, todas las pestañas)
// =====================================================================

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSuperAdminEmail } from '../lib/vip';
import { useAuth as useSaaSAuth } from '../lib/auth';
import { ItemsPanel } from '../components/settings/ItemsPanel';
import { TablesPanel } from '../components/settings/TablesPanel';
import { CategoriesPanel } from '../components/settings/CategoriesPanel';
import { TeamPanel } from '../components/settings/TeamPanel';
import { LiveTicketPreview, type RestaurantForm } from '../components/settings/LiveTicketPreview';
import { loadTicketSettings, saveTicketSettings, loadCompany, saveCompany } from '../lib/ticketSettings';
import { BillingPanel } from '../components/settings/BillingPanel';
import { StoragePanel } from '../components/settings/StoragePanel';
import { SalesPanel } from '../components/settings/SalesPanel';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { supabaseFetch } from '../lib/supabase-fetch';
import { useAuth } from '../lib/auth';
import { resolveRealTenantId } from '../lib/waiters';
import { onTenantChange, onTenantSettingsChange } from '../lib/tenant-realtime-sync';
import { useBusinessMode, type BusinessType } from '../lib/business-mode';
import { useTheme, type ThemeMode, type ThemeAccent } from '../lib/theme';

type Tab =
    | 'empresa'
    | 'productos'
    | 'categorias'
    | 'mesas'
    | 'camareros'
    | 'ticket'
    | 'personalizacion'
    | 'ventas'
    | 'plan'
    | 'almacen';

const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'empresa',          label: 'Empresa',         icon: '🏢' },
    { id: 'productos',        label: 'Productos',       icon: '🍽️' },
    { id: 'categorias',       label: 'Categorías',      icon: '🗂️' },
    { id: 'mesas',            label: 'Mesas',           icon: '🪑' },
    { id: 'camareros',        label: 'Camareros',       icon: '👥' },
    { id: 'ticket',           label: 'Ticket',          icon: '🧾' },
    { id: 'personalizacion',  label: 'Personalización', icon: '🎨' },
    { id: 'ventas',           label: 'Ventas',          icon: '📊' },
    { id: 'plan',             label: 'Plan',            icon: '💳' },
    { id: 'almacen',          label: 'Almacén',         icon: '💾' },
];

export function SettingsPage() {
    const navigate = useNavigate();
    const auth = useAuth();
    const saasAuth = useSaaSAuth();
    const [activeTab, setActiveTab] = useState<Tab>('empresa');

    // ★ v4.5.13: GUARD — admin NUNCA debe estar en /settings
    //   Si el admin entra aquí, redirigir a /admin
    useEffect(() => {
        const email = saasAuth?.user?.email;
        if (isSuperAdminEmail(email)) {
            console.warn("[SettingsPage] ⚠️ ADMIN detectado, redirigiendo a /admin");
            navigate("/admin", { replace: true });
        }
    }, [saasAuth?.user?.email, navigate]);

    // Empresa (persistido en `tenants`)
    // ★ v4.1.5: usa nombres REALES de columnas BD (business_name, NO 'name')
    const [empresa, setEmpresa] = useState({
        business_name: '',
        nif:           '',
        address:       '',
        phone:         '',
    });
    const [loading,  setLoading] = useState(false);
    const [saving,   setSaving]  = useState(false);
    const [msg,      setMsg]     = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Ticket (parte de `tenants`)
    const [ticketForm, setTicketForm] = useState<RestaurantForm>({
        name:    '',
        nif:     '',
        address: '',
        phone:   '',
        header_msg: '',
        footer_msg: '¡Gracias por su visita!',
        showTax:    true,
    });

    // Cargar datos del tenant (empresa + ticket) — v4.5.5: usa loadCompany unificado
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!isSupabaseConfigured || !auth.user) return;
            setLoading(true);
            try {
                // ★ v4.5.5: usar loadCompany() que tiene fallback a tenant_settings
                //   sin importar si tu tabla tenants tiene columnas ticket_*
                const tenantId =
                    (auth.tenant && auth.tenant.id && auth.tenant.id !== "vip-bypass")
                        ? auth.tenant.id
                        : (await resolveRealTenantId(null)) || "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";

                const data = await loadCompany(tenantId);

                if (cancelled) return;

                console.log("[SettingsPage] datos cargados via loadCompany:", data);

                setEmpresa({
                    business_name: data.business_name ?? '',
                    nif:           data.cif_nif      ?? '',
                    address:       data.address      ?? '',
                    phone:         data.phone        ?? '',
                });
                setTicketForm(prev => ({
                    ...prev,
                    name:        data.business_name ?? '',
                    nif:         data.cif_nif  ?? '',
                    address:     data.address  ?? '',
                    phone:       data.phone    ?? '',
                    header_msg:  data.ticket_header_msg ?? prev.header_msg ?? '',
                    footer_msg:  data.ticket_footer_msg ?? prev.footer_msg ?? '¡Gracias por su visita!',
                    showTax:     data.ticket_show_tax ?? prev.showTax ?? true,
                }));

                if (!data.business_name) {
                    console.warn("[SettingsPage] tenant sin business_name, intentando LS fallback");
                    try {
                        const lsData = localStorage.getItem("mozona.empresa");
                        if (lsData) {
                            const parsed = JSON.parse(lsData);
                            if (parsed.business_name) {
                                setEmpresa({
                                    business_name: parsed.business_name ?? '',
                                    nif:           parsed.nif     ?? parsed.cif_nif ?? '',
                                    address:       parsed.address ?? '',
                                    phone:         parsed.phone   ?? '',
                                });
                                console.log("[SettingsPage] cargado desde localStorage fallback");
                            }
                        }
                    } catch {}
                }
            } catch (e) {
                console.warn("[SettingsPage] load exception:", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.user, auth.tenant?.id, auth.session?.access_token]);

    // ★ v4.2.7: realtime — si otra pestaña/dispositivo cambia la config,
    //   refleja los cambios en ESTA pantalla sin recargar.
    useEffect(() => {
        const offT = onTenantChange((newRow) => {
            if (!newRow) return;
            console.log("[SettingsPage] realtime: tenants updated");
            setEmpresa({
                business_name: newRow.business_name ?? '',
                nif:           newRow.cif_nif       ?? '',
                address:       newRow.address       ?? '',
                phone:         newRow.phone         ?? '',
            });
            setTicketForm(prev => ({
                ...prev,
                header_msg: newRow.ticket_header_msg ?? prev.header_msg,
                footer_msg: newRow.ticket_footer_msg ?? prev.footer_msg,
                showTax:    newRow.ticket_show_tax   ?? prev.showTax,
            }));
        });
        const offS = onTenantSettingsChange((newRow) => {
            if (!newRow) return;
            console.log("[SettingsPage] realtime: tenant_settings updated");
            setTicketForm(prev => ({
                ...prev,
                header_msg: newRow.header_text ?? prev.header_msg,
                footer_msg: newRow.footer_text ?? prev.footer_msg,
                showTax:    newRow.show_vat_breakdown ?? prev.showTax,
                width:      newRow.ticket_paper_width ?? prev.width,
            }));
        });
        return () => { offT(); offS(); };
    }, []);

    const saveEmpresa = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth.user) {
            setMsg({ kind: 'err', text: 'No hay sesión activa' });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            // ★ v1.9.4: owner_id no existe, usar localStorage + intentar BD
            const tenantId = (await resolveRealTenantId(null)) || "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";
            // Guardar SIEMPRE en localStorage como respaldo
            localStorage.setItem("mozona.empresa", JSON.stringify(empresa));

            // ★ v1.9.16: upsert directo en ticket_settings
            //   El ticket se imprime desde about:blank y NO puede leer
            //   localStorage, así que la Empresa vive también en BD.
            const tsResult = await saveTicketSettings({
                company_name: empresa.business_name?.trim()    || "",
                nif:          empresa.nif?.trim()      || "",
                address:      empresa.address?.trim() || "",
                phone:        empresa.phone?.trim()   || "",
            });
            const empresaSource = tsResult.source;

            // ★ v4.1.4-FIX: guardar en `tenants` con campos REALES (business_name, NO 'name')
            //   y con JWT del usuario para que pase RLS.
            try {
                const sessionJwt = auth.session?.access_token || null;
                const updatePayload = {
                    business_name: empresa.business_name.trim()    || null,
                    cif_nif:       empresa.nif.trim()      || null,
                    address:       empresa.address.trim() || null,
                    phone:         empresa.phone.trim()   || null,
                };

                if (sessionJwt) {
                    await supabaseFetch(`/rest/v1/tenants?id=eq.${tenantId}`, {
                        method: "PATCH",
                        jwt: sessionJwt,
                        body: JSON.stringify(updatePayload),
                    });
                } else if (supabase) {
                    await supabase.from("tenants").update(updatePayload).eq("id", tenantId);
                }
            } catch (e) { /* silenciado: la fuente de verdad es ticket_settings */ }

            setMsg({
                kind: 'ok',
                text: empresaSource === "db"
                    ? 'Datos de empresa guardados (BD).'
                    : 'Guardado en local (BD no disponible).'
            });
        } catch (e) {
            setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Error al guardar' });
        }
        setSaving(false);
    };

    const saveTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth.user) {
            setMsg({ kind: 'err', text: 'No hay sesión activa' });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            // ★ v1.9.13: usar tabla dedicada ticket_settings
            localStorage.setItem("mozona.ticket_config", JSON.stringify(ticketForm));

            const result = await saveTicketSettings({
                header_text:        ticketForm.header_msg ?? "",
                footer_text:        ticketForm.footer_msg ?? "¡Gracias por su visita!",
                show_vat_breakdown: ticketForm.showTax ?? true,
                paper_width_mm:     80,
            });
            if (result.source === "db") {
                setMsg({ kind: 'ok', text: 'Configuración del ticket guardada.' });
            } else {
                setMsg({ kind: 'ok', text: 'Guardado en local (BD no disponible)' });
            }
        } catch (e) {
            setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Error al guardar' });
        }
        setSaving(false);
    };

    return (
        <div className="min-h-dvh w-full bg-slate-100 flex flex-col p-3 sm:p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-4">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/app')}
                        className="h-9 px-3 bg-white text-slate-800 font-bold text-xs rounded-xl shadow-sm border border-slate-200 flex items-center gap-1.5 active:scale-95 transition"
                    >
                        ⬅ Volver al TPV
                    </button>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black text-slate-900">Configuración</h1>
                        <p className="text-[11px] text-slate-500">Empresa, menú, mesas, camareros, ticket</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {/* ★ v3.5.0: AI Studio */}
                    <button
                        type="button"
                        onClick={() => navigate('/ai-studio')}
                        className="h-9 px-3.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 active:scale-95 transition"
                        title="IA local: facturas, voz, precios"
                    >
                        🤖 AI Studio
                    </button>
                    {/* ★ v3.4.5: Acceso a Personalización (editor visual de tickets + temas) */}
                    <button
                        type="button"
                        onClick={() => navigate('/tenant-settings')}
                        className="h-9 px-3.5 bg-gradient-to-r from-violet-600 to-blue-600 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 active:scale-95 transition"
                        title="Editor visual de tickets, temas y estilos"
                    >
                        🎨 Personalizar
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => { setActiveTab(t.id); setMsg(null); }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
                            activeTab === t.id
                                ? 'bg-blue-600 text-white shadow'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        <span className="mr-1">{t.icon}</span>{t.label}
                    </button>
                ))}
            </div>

            {msg && (
                <div className={`mb-3 p-3 rounded-xl text-[12.5px] ${
                    msg.kind === 'ok'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}>
                    {msg.text}
                </div>
            )}

            {/* ============ EMPRESA ============ */}
            {activeTab === 'empresa' && (
                <form onSubmit={saveEmpresa} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 max-w-2xl space-y-3">
                    <h3 className="text-base font-bold text-slate-900">Datos de la empresa</h3>
                    <p className="text-[11px] text-slate-500 -mt-2">Aparecen en la cabecera del ticket / pre-cuenta.</p>
                    <Field label="Nombre del restaurante">
                        <input type="text" value={empresa.business_name}
                               onChange={e => setEmpresa({ ...empresa, business_name: e.target.value })}
                               placeholder="Ej. Restaurante El Rincón de Casablanca"
                               className="input" />
                    </Field>
                    <Field label="NIF / CIF">
                        <input type="text" value={empresa.nif}
                               onChange={e => setEmpresa({ ...empresa, nif: e.target.value })}
                               placeholder="Ej. B12345678"
                               className="input" />
                    </Field>
                    <Field label="Dirección">
                        <input type="text" value={empresa.address}
                               onChange={e => setEmpresa({ ...empresa, address: e.target.value })}
                               placeholder="Ej. Calle Mayor 12, Madrid"
                               className="input" />
                    </Field>
                    <Field label="Teléfono">
                        <input type="tel" value={empresa.phone}
                               onChange={e => setEmpresa({ ...empresa, phone: e.target.value })}
                               placeholder="Ej. 600 000 000"
                               className="input" />
                    </Field>
                    <SubmitBtn saving={saving} loading={loading}>Guardar datos de empresa</SubmitBtn>
                </form>
            )}

            {/* ============ PRODUCTOS ============ */}
            {activeTab === 'productos' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <ItemsPanel />
                </div>
            )}

            {/* ============ CATEGORÍAS ============ */}
            {activeTab === 'categorias' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <CategoriesPanel />
                </div>
            )}

            {/* ============ MESAS ============ */}
            {activeTab === 'mesas' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <TablesPanel />
                </div>
            )}

            {/* ============ CAMAREROS ============ */}
            {activeTab === 'camareros' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <TeamPanel />
                </div>
            )}

            {/* ============ TICKET ============ */}
            {activeTab === 'ticket' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <form onSubmit={saveTicket} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                        <h3 className="text-base font-bold text-slate-900">Diseño del Ticket</h3>
                        <p className="text-[11px] text-slate-500 -mt-2">Personaliza cabecera y pie del ticket impreso.</p>
                        <Field label="Ancho del rollo de impresión">
                            <div className="flex gap-2">
                                {([48, 58, 80] as const).map((mm) => (
                                    <button
                                        key={mm}
                                        type="button"
                                        onClick={() => setTicketForm({ ...ticketForm, ticket_paper_width: mm })}
                                        className={`flex-1 h-10 rounded-lg border-2 text-[13px] font-bold transition ${
                                            (ticketForm.ticket_paper_width ?? 48) === mm
                                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                        }`}
                                    >
                                        {mm}mm
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10.5px] text-slate-400 mt-1.5">
                                Selecciona el ancho físico del rollo de tu impresora térmica.
                            </p>
                        </Field>
                        <Field label="Cabecera (texto libre, encima del nombre)">
                            <textarea
                                rows={2}
                                value={ticketForm.header_msg ?? ''}
                                onChange={e => setTicketForm({ ...ticketForm, header_msg: e.target.value })}
                                placeholder="Ej. ¡Bienvenido a nuestro restaurante!"
                                className="input font-mono text-xs" />
                        </Field>
                        <Field label="Pie de página (mensaje de despedida)">
                            <textarea
                                rows={2}
                                value={ticketForm.footer_msg ?? ''}
                                onChange={e => setTicketForm({ ...ticketForm, footer_msg: e.target.value })}
                                placeholder="Ej. ¡Gracias por su visita! Conserve este ticket."
                                className="input font-mono text-xs" />
                        </Field>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={ticketForm.showTax ?? true}
                                onChange={e => setTicketForm({ ...ticketForm, showTax: e.target.checked })}
                                className="rounded"
                            />
                            <span className="text-sm text-slate-700">Imprimir desglose de IVA (Base 10% / I.V.A. 10%)</span>
                        </label>
                        <SubmitBtn saving={saving} loading={loading}>Guardar diseño del ticket</SubmitBtn>
                    </form>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                        <h3 className="text-base font-bold text-slate-900 mb-2">Vista previa</h3>
                        <LiveTicketPreview form={ticketForm} bare />
                    </div>
                </div>
            )}

            {/* ============ VENTAS ============ */}
            {activeTab === 'ventas' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <SalesPanel />
                </div>
            )}

            {/* ============ PLAN ============ */}
            {activeTab === 'plan' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <BillingPanel />
                </div>
            )}

            {/* ============ ALMACÉN ============ */}
            {activeTab === 'almacen' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <StoragePanel />
                </div>
            )}

            {/* ============ PERSONALIZACIÓN (v4.3.0) ============ */}
            {activeTab === 'personalizacion' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <PersonalizationPanel
                        tenantId={auth.tenant?.id}
                    />
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------

// =====================================================================
// PersonalizationPanel — selector de tipo de negocio + tema visual
// =====================================================================
function PersonalizationPanel({ tenantId }: { tenantId?: string | null }) {
    const bm = useBusinessMode(tenantId);
    const th = useTheme(tenantId);

    return (
        <>
            {/* =========== TIPO DE NEGOCIO =========== */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-base font-bold text-slate-900">Tipo de negocio</h3>
                <p className="text-[11px] text-slate-500 -mt-2">
                    Adapta toda la interfaz: si eliges Tienda, se oculta el módulo de mesas.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                    {([
                        {
                            id: "hospitality",
                            title: "Hostelería",
                            subtitle: "Restaurante, bar, cafetería",
                            icon: "🍽️",
                            desc: "Mesas, salones, comandas abiertas, camareros con PIN",
                        },
                        {
                            id: "retail",
                            title: "Tienda / Retail",
                            subtitle: "Tienda de ropa, general, comercio",
                            icon: "🛍️",
                            desc: "Caja rápida, catálogo por código, sin mesas",
                        },
                    ] as const).map(opt => {
                        const active = bm.type === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={async () => {
                                    await bm.saveBusinessType(opt.id);
                                }}
                                className={`text-left p-4 rounded-xl border-2 transition ${
                                    active
                                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                                        : "border-slate-200 bg-white hover:bg-slate-50"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl">{opt.icon}</span>
                                    <div>
                                        <div className="font-bold text-slate-900 text-sm">{opt.title}</div>
                                        <div className="text-[10px] text-slate-500">{opt.subtitle}</div>
                                    </div>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-600">{opt.desc}</p>
                                {active && (
                                    <div className="mt-2 text-[10px] text-blue-700 font-bold">✓ Activo ahora</div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* =========== TEMA VISUAL =========== */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <h3 className="text-base font-bold text-slate-900">Tema visual</h3>
                <p className="text-[11px] text-slate-500 -mt-2">
                    Los cambios se aplican al instante y se sincronizan con tus otros dispositivos.
                </p>

                {/* Modo */}
                <Field label="Modo de tema">
                    <div className="grid grid-cols-3 gap-2">
                        {(["light","dark","system"] as const).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => th.setTheme({ theme_mode: m })}
                                className={`px-3 py-2 rounded-lg border-2 text-[11px] font-bold ${
                                    th.theme.theme_mode === m
                                        ? "border-blue-500 bg-blue-50 text-blue-700"
                                        : "border-slate-200 bg-white text-slate-700"
                                }`}
                            >
                                {m === "light" ? "☀️ Claro" : m === "dark" ? "🌙 Oscuro" : "🖥️ Sistema"}
                            </button>
                        ))}
                    </div>
                </Field>

                {/* Acento */}
                <Field label="Color de acento">
                    <div className="grid grid-cols-7 gap-2">
                        {([
                            { id: "blue",    c: "#2563eb" },
                            { id: "emerald", c: "#059669" },
                            { id: "violet",  c: "#7c3aed" },
                            { id: "amber",   c: "#d97706" },
                            { id: "rose",    c: "#e11d48" },
                            { id: "teal",    c: "#0d9488" },
                            { id: "slate",   c: "#475569" },
                        ] as const).map(a => {
                            const active = th.theme.theme_accent === a.id;
                            return (
                                <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => th.setTheme({ theme_accent: a.id })}
                                    className={`h-10 rounded-lg border-2 flex items-center justify-center ${
                                        active ? "border-slate-900 ring-2 ring-offset-1" : "border-slate-200"
                                    }`}
                                    style={{ backgroundColor: a.c }}
                                    title={a.id}
                                >
                                    {active && <span className="text-white text-[14px]">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </Field>

                {/* Tamaño botones */}
                <Field label="Tamaño de botones">
                    <div className="grid grid-cols-3 gap-2">
                        {(["sm","md","lg"] as const).map(s => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => th.setTheme({ button_size: s })}
                                className={`px-3 py-2 rounded-lg border-2 text-[11px] ${
                                    th.theme.button_size === s
                                        ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                                        : "border-slate-200 bg-white text-slate-700"
                                }`}
                            >
                                {s === "sm" ? "Pequeño" : s === "md" ? "Mediano" : "Grande"}
                            </button>
                        ))}
                    </div>
                </Field>

                {/* Densidad grid */}
                <Field label="Densidad del catálogo">
                    <div className="grid grid-cols-3 gap-2">
                        {(["compact","normal","comfortable"] as const).map(d => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => th.setTheme({ grid_density: d })}
                                className={`px-3 py-2 rounded-lg border-2 text-[11px] ${
                                    th.theme.grid_density === d
                                        ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                                        : "border-slate-200 bg-white text-slate-700"
                                }`}
                            >
                                {d === "compact" ? "Compacto" : d === "normal" ? "Normal" : "Espacioso"}
                            </button>
                        ))}
                    </div>
                </Field>

                {/* Disposición panel */}
                <Field label="Disposición del panel">
                    <div className="grid grid-cols-2 gap-2">
                        {(["horizontal","vertical"] as const).map(l => (
                            <button
                                key={l}
                                type="button"
                                onClick={() => th.setTheme({ panel_layout: l })}
                                className={`px-3 py-2 rounded-lg border-2 text-[11px] ${
                                    th.theme.panel_layout === l
                                        ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                                        : "border-slate-200 bg-white text-slate-700"
                                }`}
                            >
                                {l === "horizontal" ? "↔️ Horizontal" : "↕️ Vertical"}
                            </button>
                        ))}
                    </div>
                </Field>

                <button
                    type="button"
                    onClick={() => th.setTheme({
                        theme_mode: "system",
                        theme_accent: "blue",
                        theme_contrast: "normal",
                        button_size: "md",
                        grid_density: "normal",
                        panel_layout: "horizontal",
                        show_product_images: true,
                    })}
                    className="text-[11px] text-slate-500 underline"
                >
                    ↻ Restaurar valores por defecto
                </button>
            </div>
        </>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-[11px] font-bold text-slate-600 mb-1">{label}</span>
            {children}
        </label>
    );
}

function SubmitBtn({ children, saving, loading, disabled }: {
    children: React.ReactNode; saving: boolean; loading?: boolean; disabled?: boolean;
}) {
    return (
        <button
            type="submit"
            disabled={saving || loading || disabled}
            className="h-11 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow active:scale-95 transition disabled:opacity-50"
        >
            {saving ? 'Guardando…' : children}
        </button>
    );
}

export default SettingsPage;
