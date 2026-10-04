// =====================================================================
// MOZONA TPV — Controles de formulario iOS-style
// =====================================================================

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------
// Field: etiqueta + input + texto de ayuda
// ---------------------------------------------------------------------

export interface FieldProps {
    label:       string;
    description?: string;
    error?:      string;
    required?:   boolean;
    children:    React.ReactNode;
}

export function Field({ label, description, error, required, children }: FieldProps) {
    return (
        <label className="block">
            <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[12px] font-semibold text-slate-700">
                    {label}
                </span>
                {required && (
                    <span className="text-rose-500 text-[12px] font-bold">*</span>
                )}
            </div>
            {children}
            {description && !error && (
                <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                    {description}
                </div>
            )}
            {error && (
                <div className="mt-1 text-[11px] text-rose-600 font-medium">
                    {error}
                </div>
            )}
        </label>
    );
}

// ---------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
    error?: boolean;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    ({ className, error, ...rest }, ref) => (
        <input
            ref={ref}
            className={cn(
                "w-full h-11 px-3.5",
                "rounded-xl border bg-white",
                "text-[14px] text-slate-900",
                "placeholder:text-slate-400",
                "outline-none transition",
                error
                    ? "border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    : "border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
                className
            )}
            {...rest}
        />
    )
);
TextInput.displayName = "TextInput";

// ---------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
    error?: boolean;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
    ({ className, error, rows = 3, ...rest }, ref) => (
        <textarea
            ref={ref}
            rows={rows}
            className={cn(
                "w-full px-3.5 py-2.5",
                "rounded-xl border bg-white resize-none",
                "text-[14px] text-slate-900",
                "placeholder:text-slate-400",
                "outline-none transition",
                error
                    ? "border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                    : "border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
                className
            )}
            {...rest}
        />
    )
);
TextArea.displayName = "TextArea";

// ---------------------------------------------------------------------
// Toggle: switch estilo iOS
// ---------------------------------------------------------------------

export interface ToggleProps {
    checked:    boolean;
    onChange:   (v: boolean) => void;
    label?:     string;
    description?: string;
    disabled?:  boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
    const switchEl = (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative w-12 h-7 rounded-full transition shrink-0",
                "focus:outline-none focus:ring-2 focus:ring-offset-2",
                checked
                    ? "bg-emerald-500 focus:ring-emerald-200"
                    : "bg-slate-300 focus:ring-slate-200",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <span
                className={cn(
                    "absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition",
                    "flex items-center justify-center",
                    checked ? "left-[22px]" : "left-0.5"
                )}
            >
                <svg
                    width="10" height="10" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    className={cn(
                        "transition",
                        checked ? "text-emerald-500 opacity-100" : "text-slate-400 opacity-0"
                    )}
                >
                    <path d="M5 12l5 5 9-11" />
                </svg>
            </span>
        </button>
    );

    if (!label && !description) return switchEl;

    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
                {label && (
                    <div className="text-[13px] font-semibold text-slate-900">{label}</div>
                )}
                {description && (
                    <div className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">
                        {description}
                    </div>
                )}
            </div>
            {switchEl}
        </div>
    );
}

// ---------------------------------------------------------------------
// Card: contenedor iOS-style
// ---------------------------------------------------------------------

export function Card({
    title, subtitle, icon, children, className,
}: {
    title:     string;
    subtitle?: string;
    icon?:     React.ReactNode;
    children:  React.ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "bg-white rounded-2xl border border-slate-200/80 shadow-sm",
                "overflow-hidden",
                className
            )}
        >
            <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                {icon && (
                    <div
                        className="
                            w-9 h-9 rounded-xl
                            bg-slate-50 border border-slate-200/80
                            flex items-center justify-center
                            text-slate-700
                        "
                    >
                        {icon}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <h2 className="text-[15px] font-bold text-slate-900 leading-tight">
                        {title}
                    </h2>
                    {subtitle && (
                        <p className="text-[12px] text-slate-500 leading-snug mt-0.5">
                            {subtitle}
                        </p>
                    )}
                </div>
            </header>
            <div className="p-5 space-y-4">
                {children}
            </div>
        </section>
    );
}
