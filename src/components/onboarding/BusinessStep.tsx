// =====================================================================
// MOZONA TPV — Onboarding Step 1: Datos del restaurante
// =====================================================================

import { isValidCifNif } from "../../lib/validators";
import { IconStore, IconShield } from "../icons";

export interface BusinessData {
    business_name:    string;
    cif_nif:          string;
    address:          string;
    phone:            string;
    default_tax_rate: 10 | 21;
}

export interface BusinessStepProps {
    value:    BusinessData;
    onChange: (next: BusinessData) => void;
}

export function BusinessStep({ value, onChange }: BusinessStepProps) {
    const cifOk = !value.cif_nif || isValidCifNif(value.cif_nif);

    return (
        <StepShell
            icon={<IconStore size={22} strokeWidth={1.8} />}
            title="Cuéntanos sobre tu local"
            subtitle="Estos datos aparecerán en los tickets y en la configuración fiscal."
        >
            <div className="space-y-4">
                <Field
                    label="Nombre comercial"
                    required
                    error={!value.business_name.trim() ? "El nombre es obligatorio" : undefined}
                >
                    <input
                        type="text"
                        value={value.business_name}
                        onChange={e => onChange({ ...value, business_name: e.target.value })}
                        placeholder="Casa Manolo"
                        className="input"
                        autoFocus
                    />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                        label="CIF / NIF"
                        hint="Para tickets fiscales (opcional)"
                        error={!cifOk ? "Formato no válido (ej: B12345678)" : undefined}
                    >
                        <input
                            type="text"
                            value={value.cif_nif}
                            onChange={e => onChange({ ...value, cif_nif: e.target.value.toUpperCase() })}
                            placeholder="B12345678"
                            className="input font-mono"
                        />
                    </Field>
                    <Field
                        label="Teléfono"
                        hint="Para contacto con el cliente"
                    >
                        <input
                            type="tel"
                            value={value.phone}
                            onChange={e => onChange({ ...value, phone: e.target.value })}
                            placeholder="+34 911 234 567"
                            className="input"
                        />
                    </Field>
                </div>

                <Field
                    label="Dirección fiscal"
                    hint="Aparecerá en la cabecera de los tickets"
                >
                    <input
                        type="text"
                        value={value.address}
                        onChange={e => onChange({ ...value, address: e.target.value })}
                        placeholder="Calle Mayor 12, 28013 Madrid"
                        className="input"
                    />
                </Field>

                <div>
                    <label className="text-[11px] font-bold text-slate-600 tracking-wider uppercase mb-2 block">
                        % de IVA por defecto
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {([10, 21] as const).map(rate => (
                            <button
                                key={rate}
                                onClick={() => onChange({ ...value, default_tax_rate: rate })}
                                className={
                                    "h-12 rounded-xl border text-[14px] font-black transition " +
                                    (value.default_tax_rate === rate
                                        ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                                        : "border-slate-200 hover:border-slate-300 text-slate-700")
                                }
                            >
                                {rate}%
                            </button>
                        ))}
                    </div>
                    <p className="text-[10.5px] text-slate-400 mt-1.5">
                        Podrás cambiar el IVA individualmente en cada producto más adelante.
                    </p>
                </div>
            </div>

            <HintBox>
                <IconShield size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                <span>
                    Estos datos se guardan cifrados en Supabase y cumplen con la
                    normativa de protección de datos (RGPD).
                </span>
            </HintBox>
        </StepShell>
    );
}

// ---------------------------------------------------------------------
// Helpers compartidos del wizard
// ---------------------------------------------------------------------

export function StepShell({
    icon, title, subtitle, children,
}: {
    icon:      React.ReactNode;
    title:     string;
    subtitle?: string;
    children:  React.ReactNode;
}) {
    return (
        <div>
            <div className="flex items-start gap-3 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600
                                flex items-center justify-center shrink-0">
                    {icon}
                </div>
                <div>
                    <h2 className="text-[19px] font-black text-slate-900 tracking-tight">
                        {title}
                    </h2>
                    {subtitle && (
                        <p className="text-[12.5px] text-slate-500 mt-0.5">
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>
            {children}
        </div>
    );
}

export function Field({
    label, required, hint, error, children,
}: {
    label:     string;
    required?: boolean;
    hint?:     string;
    error?:    string;
    children:  React.ReactNode;
}) {
    return (
        <label className="block">
            <div className="text-[11px] font-bold text-slate-600 tracking-wider uppercase mb-1">
                {label}
                {required && <span className="text-rose-500 ml-0.5">*</span>}
            </div>
            {children}
            {hint && !error && (
                <div className="text-[10.5px] text-slate-400 mt-1">{hint}</div>
            )}
            {error && (
                <div className="text-[10.5px] text-rose-600 mt-1 font-semibold">{error}</div>
            )}
        </label>
    );
}

export function HintBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200/80
                        text-[11.5px] text-slate-600 flex items-start gap-2">
            {children}
        </div>
    );
}

// (re-exports eliminados)
