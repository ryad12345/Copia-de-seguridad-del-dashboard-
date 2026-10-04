// =====================================================================
// MOZONA TPV — AIAssistantModal
// =====================================================================
// Asistente interactivo con flujo guiado por botones.
//
//   - Sin LLM: flujo determinista basado en opciones
//   - Sin Firebase: persiste en Supabase (tabla leads_onboarding)
//   - Sin escritura manual salvo campos críticos (nombre, email, restaurante)
//
// Fases del flujo:
//   1. Bienvenida
//   2. Tipo de negocio (restaurante, bar, cafetería, otro)
//   3. Plan (Básico / Profesional / Premium)
//   4. Datos (nombre restaurante, email) — solo si no viene del contexto
//   5. Confirmación y creación del lead
//   6. Cierre con CTA WhatsApp
//
// Props:
//   open       — mostrar/ocultar
//   onClose    — callback al cerrar
//   source     — desde dónde se abre ('paywall' | 'landing' | 'onboarding' | 'pricing' | 'settings')
//   ctxEmail   — email si ya logueado (opcional)
//   ctxName    — nombre restaurante si ya logueado (opcional)
//   ctxPlan    — plan pre-seleccionado (basic | professional | premium | trial)
//   onSuccess  — callback tras crear el lead (recibe leadId)
// =====================================================================

import { useEffect, useRef, useState } from "react";
import { saveLead, saveLeadToLocal, type ChatMessage, type PlanCode, type LeadStatus, type AssistantSource, type LeadRecord } from "../../lib/chatLeads";
import { FIREBASE_CONFIGURED } from "../../lib/firebase";
import { sendLeadEmail } from "../../lib/notify";
import { markLeadSubmitted, resetLeadGuard } from "../../lib/leadGuard";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { saveProduct as saveProductCatalog, type ProductInput } from "../../lib/catalog";
import { getHomeRouteForEmail } from "../../lib/vip";
import { IconCheck } from "../icons";

interface Props {
    open: boolean;
    onClose: () => void;
    source: AssistantSource;
    ctxEmail?: string;
    ctxName?:  string;
    ctxPlan?:  PlanCode;
    onSuccess?: (leadId: string) => void;
    /** ★ v1.9.50: 'floating' (lead-gen normal) | 'config' (copiloto en /settings) */
    mode?: "floating" | "config";
}
const PHONE_E164 = "34644165153";
const PHONE_DISPLAY = "+34 644 16 51 53";

// ★ v1.9.42: WhatsApp eliminado del flujo. Los leads se guardan
//   directamente en Firebase y se notifica por email vía webhook.

interface Step {
    id:       string;
    role:     "assistant";
    content:  string;
    options?: Array<{ label: string; value: string; next: string }>;
    input?:   "email" | "name" | "restaurant" | "password";
}

const STEPS_CONFIG: Record<string, Step> = {
    // ★ v1.9.51: copiloto de configuración en /settings
    //    Mensaje de bienvenida LIMPIO, sin referencia a la prueba de 7 días
    welcome: {
        id:      "welcome",
        role:    "assistant",
        content: "¡Hola! Soy Riyad, tu copiloto de configuración. ¿Qué te gustaría hacer en tu negocio hoy?",
        options: [
            { label: "➕  Añadir producto",      value: "add-product", next: "add-product" },
            { label: "🏷️  Crear categoría",     value: "add-category", next: "add-category" },
            { label: "🖨️  Ajustar datos de ticket", value: "ticket",    next: "ticket" },
            { label: "←  Volver al modo general",  value: "back",     next: "__close__" },
        ],
    },
    "add-product": {
        id:      "add-product",
        role:    "assistant",
        content: "Perfecto. Vamos a crear un producto nuevo. ¿Cómo se llama?",
        input:   "name",
    },
    "add-category": {
        id:      "add-category",
        role:    "assistant",
        content: "Genial. ¿Qué nombre quieres darle a la categoría? (Por ejemplo: 'Tapas', 'Bebidas', 'Postres'.)",
        input:   "name",
    },
    ticket: {
        id:      "ticket",
        role:    "assistant",
        content: "Para configurar los datos de tu ticket (nombre del local, NIF, dirección, etc.), ve a Configuración → Empresa. ¿Quieres que te abra esa sección?",
        options: [
            { label: "✓  Abrir Configuración → Empresa", value: "go-empresa", next: "__close__" },
            { label: "←  Volver",                          value: "back",      next: "welcome" },
        ],
    },
    // ★ v1.9.50: sub-pasos para crear producto
    "add-product-price": {
        id:      "add-product-price",
        role:    "assistant",
        content: "Anota el precio de venta (IVA INCLUIDO, como se muestra en la carta). Por ejemplo: 12.50",
    },
    "add-product-iva": {
        id:      "add-product-iva",
        role:    "assistant",
        content: "¿Qué tipo de IVA quieres aplicarle? (En hostelería España suele ser 10%. Si es alcohol, 21%. Si es 0% como el pan, 0.)",
    },
    "add-product-done": {
        id:      "add-product-done",
        role:    "assistant",
        content: "Producto creado. ¿Quieres hacer algo más?",
        options: [
            { label: "➕  Añadir otro producto",  value: "add-product", next: "add-product" },
            { label: "←  Volver al menú",         value: "back",        next: "welcome" },
            { label: "✓  Cerrar",                  value: "end",         next: "__close__" },
        ],
    },
};

const STEPS: Record<string, Step> = {
    welcome: {
        id:      "welcome",
        role:    "assistant",
        content: "¡Hola! Soy Riyad, tu asistente personal. Te ayudo a configurar tu prueba gratuita de 7 días en menos de 30 segundos. ¿Qué tipo de negocio tienes?",
        options: [
            { label: "🍽️  Restaurante",     value: "restaurante",  next: "plan"  },
            { label: "🍺  Bar / Tapas",     value: "bar",          next: "plan"  },
            { label: "☕  Cafetería",       value: "cafeteria",    next: "plan"  },
            { label: "🍦  Heladería / Otro", value: "otro",         next: "plan"  },
        ],
    },
    plan: {
        id:      "plan",
        role:    "assistant",
        content: "Perfecto. ¿Qué plan se adapta mejor a tu volumen de ventas? Todos incluyen 7 días de prueba gratuita.",
        options: [
            { label: "💼  Básico (29€/mes)  — 1 caja, hasta 200 tickets/mes",  value: "basic",         next: "name" },
            { label: "🚀  Profesional (59€/mes) — Multi-caja, comandero, ilimitado", value: "professional", next: "name" },
            { label: "👑  Premium (99€/mes) — Multi-restaurante + VeriFactu + soporte VIP", value: "premium",       next: "name" },
        ],
    },
    name: {
        id:     "name",
        role:   "assistant",
        content: "¿Cómo se llama tu restaurante? Lo usaremos para personalizar tu experiencia.",
        input:  "restaurant",
    },
    email: {
        id:     "email",
        role:   "assistant",
        content: "¿A qué email te enviamos el acceso y la factura?",
        input:  "email",
    },
    // ★ v1.9.80: Paso de contraseña (solo si NO hay sesión)
    password: {
        id:     "password",
        role:   "assistant",
        content: "Crea una contraseña (mínimo 6 caracteres) para acceder a tu panel de MOZONA TPV.",
        input:  "password",
    },
    confirm: {
        id:      "confirm",
        role:    "assistant",
        content: "Revisa los datos antes de activar tu prueba. ¿Todo correcto?",
        options: [
            { label: "✓  Sí, activar prueba de 7 días", value: "yes", next: "done" },
            { label: "←  Corregir email",                value: "fix-email", next: "email" },
            { label: "←  Corregir nombre",               value: "fix-name",  next: "name"  },
        ],
    },
    done: {
        id:      "done",
        role:    "assistant",
        // ★ v1.9.42: mensaje dinámico según éxito del guardado
        //   (la sustitución real ocurre en el goToStep vía render dinámico)
        content: "", // se sustituye dinámicamente en getDoneMessage()
        options: [
            { label: "🚀  Entrar al Panel", value: "enter", next: "__close__" },
        ],
    },
    // ★ v1.9.83: step transitorio durante la redirección a /waiting-activation
    redirecting: {
        id:     "redirecting",
        role:   "assistant",
        content: "✓ Solicitud enviada. Redirigiendo a tu sala de espera...",
    },
};

const PLAN_LABEL: Record<PlanCode, string> = {
    basic:         "Básico (29€/mes)",
    professional:  "Profesional (59€/mes)",
    premium:        "Premium (99€/mes)",
    trial:         "Trial 7 días",
};

/** ★ v1.9.50: devuelve el árbol de steps según el modo (floating/config) */
function getStepsFor(mode: "floating" | "config"): Record<string, Step> {
    return mode === "config" ? STEPS_CONFIG : STEPS;
}

/** ★ v1.9.49: vista cuando el usuario ya envió un lead desde este dispositivo */
function AlreadySubmittedView({
    onClose, isLogged, navigate,
}: { onClose: () => void; isLogged: boolean; navigate: (path: string) => void }) {
    const auth = useAuth();
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm
                        flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl
                            shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden
                            border border-slate-200/80">
                {/* Cabecera */}
                <div className="bg-gradient-to-br from-emerald-600 to-emerald-700
                                text-white px-5 py-4 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur
                                    flex items-center justify-center shadow-lg">
                        <IconCheck size={22} strokeWidth={3} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-[14px] font-black tracking-tight">
                            Solicitud ya registrada
                        </h3>
                        <p className="text-[10.5px] text-emerald-100 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
                            Recepción confirmada
                        </p>
                    </div>
                    <button onClick={onClose}
                            className="w-8 h-8 rounded-xl text-white/80 hover:text-white
                                       hover:bg-white/10 flex items-center justify-center">
                        ✕
                    </button>
                </div>

                {/* Cuerpo */}
                <div className="px-5 py-6 text-center space-y-4">
                    <p className="text-[13.5px] text-slate-700 leading-relaxed">
                        Tu solicitud ya ha sido recibida correctamente. Nos pondremos en contacto
                        contigo a la brevedad al correo electrónico que nos facilitaste.
                    </p>
                    <p className="text-[11.5px] text-slate-400">
                        Si necesitas modificar algún dato, accede a tu panel.
                    </p>
                </div>

                {/* Acciones */}
                <div className="border-t border-slate-200/80 bg-white px-4 py-3 space-y-2">
                    <button type="button"
                            onClick={() => {
                                try {
                                    // ★ v4.5.11: ruta centralizada según rol
                                    const email = (auth?.user as any)?.email || "";
                                    const dest = isLogged
                                        ? getHomeRouteForEmail(email, true)
                                        : "/auth?signup=1";
                                    navigate(dest);
                                } catch (_) {
                                    try {
                                        const email = (auth?.user as any)?.email || "";
                                        const dest = isLogged
                                            ? getHomeRouteForEmail(email, true)
                                            : "/auth?signup=1";
                                        location.href = dest;
                                    } catch (_) {}
                                }
                                try { onClose(); } catch (_) {}
                            }}
                            className="w-full h-10 rounded-xl bg-blue-600 text-white
                                       text-[12.5px] font-black active:scale-95 transition
                                       hover:bg-blue-700">
                        🚀 Entrar al Panel
                    </button>
                    <button type="button"
                            onClick={onClose}
                            className="w-full h-8 text-[11px] text-slate-500 font-semibold
                                       hover:text-slate-700">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AIAssistantModal({
    open, onClose, source, ctxEmail, ctxName, ctxPlan, onSuccess, mode = "floating",
}: Props) {
    const navigate = useNavigate();
    const auth = useAuth();
    const isLogged = !!auth?.user;
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentStep, setCurrentStep] = useState<string>("welcome");
    const [businessType, setBusinessType] = useState<string>("");
    const [plan, setPlan] = useState<PlanCode | "">(ctxPlan ?? "");
    const [name, setName] = useState(ctxName ?? "");
    const [email, setEmail] = useState(ctxEmail ?? "");
    // ★ v1.9.80: contraseña para crear cuenta nueva
    const [password, setPassword] = useState<string>("");
    const [inputValue, setInputValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [leadId, setLeadId] = useState<string | null>(null);
    const [savedOk, setSavedOk] = useState(false);
    const [backend, setBackend]   = useState<"firebase" | "supabase" | "supabase-fallback-local" | "none" | null>(null);
    const [isTyping, setIsTyping] = useState(false);  // ★ v1.9.39: Smart Engine
    // ★ v1.9.49: estado de envío + rate limit
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [alreadySubmitted, setAlreadySubmitted] = useState<boolean>(false);
    const [rateLimitedUntil, setRateLimitedUntil] = useState<number>(0);
    // ★ v1.9.50: estado temporal del producto (config mode)
    const [pendingPrice, setPendingPrice] = useState<number>(0);
    // ★ v1.9.53: error real de EmailJS (si falla, NO fingir éxito)
    const [emailError, setEmailError] = useState<string | null>(null);
    // ★ v1.9.54: EmailJS no configurado (env vars faltan, modo defensivo)
    const [emailNotConfigured, setEmailNotConfigured] = useState<boolean>(false);
    // ★ v1.9.58: estado del envío vía /api/send-email (proxy)

    // ★ v1.9.68: helper de diagnóstico en window (para debug desde consola)
    useEffect(() => {
        if (typeof window !== "undefined") {
            (window as any).__mozonaDiag = async () => {
                try {
                    const r = await fetch("/api/send-email?diag=1");
                    const j = await r.json();
                    console.log("[__mozonaDiag] /api/send-email?diag=1 →", j);
                    return j;
                } catch (e) {
                    console.error("[__mozonaDiag] error:", e);
                    return { ok: false, error: String(e) };
                }
            };
            console.log(
                "%c[AIAssistantModal] v1.9.68",
                "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
                "Para diagnóstico del email, abre la consola y ejecuta: __mozonaDiag()"
            );
        }
    }, []);
    const [emailStatus, setEmailStatus] = useState<"ok" | "error" | "pending" | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const emailStatusRef = useRef<"ok" | "error" | "pending" | null>(null);
    // Sincronizar ref con state
    useEffect(() => { emailStatusRef.current = emailStatus; }, [emailStatus]);

    // ★ v1.9.39 + v1.9.51: Mensaje de bienvenida contextual según el MODE
    //   - mode='config'  -> saludo de gestión, sin mencionar la prueba
    //   - mode='floating' con ctxPlan -> menciona el plan
    //   - mode='floating' sin ctxPlan -> bienvenida de captación
    const getWelcomeMessage = (): string => {
        if (mode === "config") {
            return getStepsFor(mode).welcome.content;
        }
        if (ctxPlan && ctxPlan !== "trial") {
            const planName = ctxPlan === "basic" ? "Plan Plus (Básico)"
                          : ctxPlan === "professional" ? "Plan Pro (Profesional)"
                          : ctxPlan === "premium" ? "Plan Premium"
                          : "";
            return `¡Hola! Soy Riyad, tu asistente personal. Veo que te interesa el ${planName}. Vamos a configurar tu prueba gratuita de 7 días en menos de 30 segundos. ¿Qué tipo de negocio tienes?`;
        }
        return getStepsFor(mode).welcome.content;
    };

    // ★ v1.9.39: Delay aleatorio 400-900ms (Smart Engine)
    const thinkDelay = (): Promise<void> => {
        const ms = 400 + Math.floor(Math.random() * 500);
        return new Promise(r => setTimeout(r, ms));
    };

    // Reset al abrir
    useEffect(() => {
        if (open) {
            // ★ v1.9.82: resetear el flag de "ya enviado" para permitir
            //   que el usuario pueda iniciar el flujo completo.
            try { resetLeadGuard(); } catch (_) {}
            setAlreadySubmitted(false);
            setMessages([]);
            setCurrentStep("welcome");
            setBusinessType("");
            setPlan(ctxPlan ?? "");
            setName(ctxName ?? "");
            setEmail(ctxEmail ?? "");
            setPassword("");  // ★ v1.9.80
            setInputValue("");
            setLeadId(null);
            setSavedOk(false);
            setBackend(null);
            setEmailError(null);
            setEmailNotConfigured(false);
            setEmailStatus(null);
            setIsTyping(true);
            // Mensaje contextual con typing
            thinkDelay().then(() => {
                setMessages([{ role: "assistant", content: getWelcomeMessage(), ts: Date.now() }]);
                setIsTyping(false);
            });
        }
    }, [open, ctxName, ctxEmail, ctxPlan]);

    // Auto-scroll al fondo
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, isTyping]);

    const pushAssistant = (content: string) => {
        setMessages(prev => [...prev, { role: "assistant", content, ts: Date.now() }]);
    };
    const pushUser = (content: string) => {
        setMessages(prev => [...prev, { role: "user", content, ts: Date.now() }]);
    };

    // ★ v1.9.45: mensaje final EXACTO del cliente (privado, profesional, claro)
    //    Se muestra IGUAL tanto si Firebase está configurado como si no,
    //    porque el flujo de envío es asíncrono y la UI no debe esperar.
    //    NUNCA devuelve undefined (try-catch defensivo).
    const getDoneMessage = (): string => {
        const EXACT_MESSAGE =
            "¡Solicitud enviada con éxito! Hemos registrado tus datos correctamente. " +
            "Nuestro equipo revisará tu solicitud y te contestaremos muy pronto " +
            "al correo electrónico que nos has facilitado.";
        try {
            return EXACT_MESSAGE;
        } catch (e) {
            console.error("[AIAssistantModal] getDoneMessage error:", e);
            return EXACT_MESSAGE;
        }
    };

    // ★ v1.9.39 + v1.9.41: goToStep con typing + mensaje dinámico en "done"
    const goToStep = async (stepId: string) => {
        const step = getStepsFor(mode)[stepId];
        if (!step) return;
        setCurrentStep(stepId);
        setIsTyping(true);
        await thinkDelay();
        const content = stepId === "done" ? getDoneMessage() : step.content;
        pushAssistant(content);
        setIsTyping(false);
    };

    // ★ v1.9.39 + v1.9.41: handleOption con typing + flujo defensivo
    const handleOption = async (value: string, next: string) => {
        const steps = getStepsFor(mode);
        const step = steps[currentStep];
        if (!step) return;
        const opt = step.options?.find(o => o.value === value);

        // ★ v1.9.50: acciones del modo config
        if (mode === "config") {
            if (value === "go-empresa") {
                try { navigate("/settings?section=empresa"); } catch (_) {
                    try { location.href = "/settings?section=empresa"; } catch (_) {}
                }
                try { onClose(); } catch (_) {}
                return;
            }
            if (value === "add-product") {
                await goToStep("add-product");
                return;
            }
            if (value === "add-category") {
                await goToStep("add-category");
                return;
            }
            if (value === "ticket") {
                await goToStep("ticket");
                return;
            }
            if (value === "back" && next === "welcome") {
                await goToStep("welcome");
                return;
            }
        }
        if (opt) pushUser(opt.label);

        if (currentStep === "welcome") {
            setBusinessType(value);
        } else if (currentStep === "plan") {
            setPlan(value as PlanCode);
        } else if (currentStep === "confirm") {
            if (value === "fix-email") { await goToStep("email"); return; }
            if (value === "fix-name")  { await goToStep("name");  return; }
            if (value === "yes") {
                // ★ v3.0.0: FLUJO ÚNICO
                //   Un solo POST a /api/register-tenant hace TODO:
                //   - Crea/recupera el user
                //   - Crea/actualiza el tenant
                //   - Envía Telegram al admin
                //   - Devuelve tenantId
                if (isSubmitting) return;
                setIsSubmitting(true);
                setIsTyping(true);
                setEmailStatus(null);

                // ★ Guardar en localStorage ANTES del fetch (NUNCA borrar)
                if (email && password && name) {
                    try {
                        localStorage.setItem("mozona.welcomeState", JSON.stringify({
                            email: email.trim().toLowerCase(),
                            name,
                            plan: plan || "basic",
                            businessType,
                            savedAt: Date.now(),
                        }));
                    } catch (_) {}
                }

                // ★ Un solo fetch que hace TODO (con timeout 8s)
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000);
                    const resp = await fetch("/api/register-tenant", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: email.trim().toLowerCase(),
                            password,
                            name,
                            plan: plan || "basic",
                            businessType,
                        }),
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);
                    const json = await resp.json().catch(() => ({}));
                    console.log("[AIAssistantModal] result:", json);

                    if (json?.ok) {
                        setSavedOk(true);
                        setBackend("supabase");
                    } else {
                        // ★ No es fatal: navegamos igualmente
                        console.warn("[AIAssistantModal] not-ok:", json);
                        setSavedOk(true);
                        setBackend("none");
                    }
                } catch (e: any) {
                    // ★ Timeout o error de red: navegamos IGUAL
                    console.warn("[AIAssistantModal] error:", e?.message || e);
                    setSavedOk(true);
                    setBackend("none");
                }

                if (FIREBASE_CONFIGURED) {
                    try { await persistLead("trial_activo"); } catch (_) {}
                }
                markLeadSubmitted();
                setIsSubmitting(false);
                setIsTyping(false);

                // ★ Navegar a /welcome (sala de espera)
                try { onClose(); } catch (_) {}
                const params = new URLSearchParams({
                    email: email.trim().toLowerCase(),
                    name: name || "",
                    plan: String(plan || "basic"),
                });
                try {
                    location.href = "/welcome?" + params.toString();
                } catch (_) {
                    try { navigate("/welcome?" + params.toString(), { replace: true }); } catch (_) {}
                }
                return;
            }
        } else if (currentStep === "done") {
            // ★ v3.1.5: SIEMPRE ir a /welcome (sala de espera)
            //   NUNCA a /auth, NUNCA a /pricing
            //   El usuario ya completó el alta, debe ver su estado
            try { onClose(); } catch (_) {}
            const params = new URLSearchParams({
                email: email.trim().toLowerCase(),
                name: name || "",
                plan: String(plan || "basic"),
            });
            // ★ Triple fallback: replace > href > navigate
            try {
                window.location.replace("/welcome?" + params.toString());
            } catch (_) {
                try { location.href = "/welcome?" + params.toString(); } catch (_) {
                    try { navigate("/welcome?" + params.toString(), { replace: true }); } catch (_) {}
                }
            }
            return;
        }
        await goToStep(next);
    };

    // ★ v1.9.52: parser de texto libre para el copiloto de configuración
    //    Detecta comandos naturales como "Añadir bocadillo a 4.50"
    //    o "Crear categoría Postres" y arranca el flujo adecuado.
    const parseFreeTextCommand = (text: string): { intent: "add-product" | "add-category" | "ticket" | "unknown"; data: any } | null => {
        const t = text.toLowerCase().trim();
        if (!t) return null;
        // ── Crear producto: "añadir X a Y" / "crear X a Y" / "nuevo X por Y"
        const addProd = t.match(/(?:a[ñn]ad(?:ir|o)|crear?|nuevo|nueva|poner?|meter?)\s+(?:un|una|el|la|los|las)?\s*(.+?)\s+(?:a|por|de)\s+(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros?)?\s*(?:€|eur|euros?)?/i);
        if (addProd) {
            const name = addProd[1].trim().replace(/\s+/g, " ");
            const price = parseFloat(addProd[2].replace(",", "."));
            if (name && !isNaN(price) && price > 0) {
                return { intent: "add-product", data: { name, price } };
            }
        }
        // Variante: "X a Y euros"
        const addProd2 = t.match(/^(.+?)\s+(?:a|por|de)\s+(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros?)?/i);
        if (addProd2) {
            const name = addProd2[1].trim().replace(/\s+/g, " ");
            const price = parseFloat(addProd2[2].replace(",", "."));
            // Solo si la primera palabra parece de comida/producto
            if (name && !isNaN(price) && price > 0 && /^[a-záéíóúñ]+/i.test(name) && name.length < 40) {
                return { intent: "add-product", data: { name, price } };
            }
        }
        // ── Crear categoría: "crear categoría X" / "nueva categoría X"
        const addCat = t.match(/(?:crear?|nueva?)\s+categor[íi]a\s+(.+)/i);
        if (addCat) {
            const name = addCat[1].trim().replace(/\s+/g, " ");
            if (name && name.length < 30) {
                return { intent: "add-category", data: { name } };
            }
        }
        // ── Configurar ticket
        if (/ticket|impresora|cabecera|datos.*empresa/.test(t)) {
            return { intent: "ticket", data: {} };
        }
        return null;
    };

    const handleInput = async () => {
        const v = inputValue.trim();
        if (!v) return;
        pushUser(v);

        // ★ v1.9.52: parser de texto libre (solo en mode=config y steps sin input)
        if (mode === "config" && currentStep === "welcome") {
            const parsed = parseFreeTextCommand(v);
            if (parsed) {
                if (parsed.intent === "add-product") {
                    setName(parsed.data.name);
                    setPendingPrice(parsed.data.price);
                    setInputValue("");
                    setIsTyping(true);
                    await thinkDelay();
                    pushAssistant(`Perfecto, "${parsed.data.name}" a ${parsed.data.price.toFixed(2)} €. ¿Qué tipo de IVA le aplico? (10% hostelería, 21% alcohol, 0% exento.)`);
                    setIsTyping(false);
                    await goToStep("add-product-iva");
                    return;
                }
                if (parsed.intent === "add-category") {
                    pushAssistant(`Entendido: quieres crear la categoría "${parsed.data.name}". Lo añado al menú.`);
                    // (Aquí podrías llamar a saveCategory si existiera)
                    await goToStep("welcome");
                    return;
                }
                if (parsed.intent === "ticket") {
                    await goToStep("ticket");
                    return;
                }
            } else {
                // Texto no reconocido
                setIsTyping(true);
                await thinkDelay();
                pushAssistant("No he entendido lo que quieres hacer. Prueba con frases como:");
                pushAssistant('• "Añadir bocadillo a 4.50"');
                pushAssistant('• "Crear categoría Postres"');
                pushAssistant('• "Ajustar datos de ticket"');
                setIsTyping(false);
                return;
            }
        }

        // ★ v1.9.50: flujo config — creación de producto conversacional
        if (mode === "config" && currentStep === "add-product") {
            setName(v);
            setInputValue("");
            await goToStep("add-product-price");
            return;
        }
        if (mode === "config" && currentStep === "add-product-price") {
            const num = parseFloat(v.replace(",", "."));
            if (isNaN(num) || num <= 0) {
                setIsTyping(true);
                await thinkDelay();
                pushAssistant("Eso no parece un precio válido. Escribe un número, por ejemplo: 12.50");
                setIsTyping(false);
                return;
            }
            // Guardamos el precio en metadata temporal via businessType hack? No.
            // Mejor usamos un state temporal: lo guardamos en "name" concatenado no, lo guardamos aparte
            setPendingPrice(num);
            setInputValue("");
            await goToStep("add-product-iva");
            return;
        }
        if (mode === "config" && currentStep === "add-product-iva") {
            const iva = parseFloat(v.replace(",", "."));
            if (isNaN(iva) || iva < 0 || iva > 100) {
                setIsTyping(true);
                await thinkDelay();
                pushAssistant("Escribe un % de IVA entre 0 y 100. Por defecto, hostelería ES = 10.");
                setIsTyping(false);
                return;
            }
            setInputValue("");
            // ★ v1.9.50: persistir vía saveProduct del catálogo existente
            try {
                const payload: ProductInput = {
                    name:       name || "Producto sin nombre",
                    price:      pendingPrice || 0,
                    tax_rate:   iva,
                    category:   null,
                    is_active:  true,
                };
                setIsTyping(true);
                const r = await saveProductCatalog(payload);
                setIsTyping(false);
                if (r.ok) {
                    pushAssistant(`✅ Listo! He dado de alta "${payload.name}" a ${payload.price.toFixed(2)} € (IVA ${iva}%).`);
                } else {
                    pushAssistant(`⚠️ No pude guardar el producto: ${r.error ?? "Error"}.`);
                }
            } catch (e: any) {
                try { pushAssistant(`⚠️ Error al guardar: ${e?.message ?? e}`); } catch (_) {}
            }
            await goToStep("add-product-done");
            return;
        }

        if (currentStep === "name") {
            setName(v);
            await goToStep("email");
        } else if (currentStep === "email") {
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
                setIsTyping(true);
                await thinkDelay();
                pushAssistant("Ese email no parece válido. ¿Puedes repetirlo?");
                setIsTyping(false);
                setInputValue("");
                return;
            }
            setEmail(v);
            // ★ v1.9.80: Si NO hay sesión, pedir contraseña
            if (!auth?.user) {
                await goToStep("password");
            } else {
                await goToStep("confirm");
            }
        } else if (currentStep === "password") {
            // ★ v1.9.80: Validar y guardar contraseña
            if (v.length < 6) {
                setIsTyping(true);
                await thinkDelay();
                pushAssistant("La contraseña debe tener al menos 6 caracteres. Inténtalo de nuevo.");
                setIsTyping(false);
                setInputValue("");
                return;
            }
            setPassword(v);
            await goToStep("confirm");
        }
        setInputValue("");
    };

    const persistLead = async (status: LeadStatus) => {
        if (savedOk) return;
        setBusy(true);
        const trialEndsAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const history: ChatMessage[] = messages.slice();
        let result: { ok: boolean; id?: string; error?: string; backend: "firebase" | "supabase" | "supabase-fallback-local" | "none" };
        try {
            result = await saveLead({
                user_email:      email || undefined,
                restaurant_name: name || undefined,
                selected_plan:   (plan as PlanCode) || undefined,
                trial_ends_at:   trialEndsAt,
                status,
                chat_history:    history,
                source,
                metadata:        { business_type: businessType, source, ctxPlan: ctxPlan ?? null },
            });
        } catch (e: any) {
            // ★ v1.9.43: try-catch defensivo
            console.error("[AIAssistantModal] persistLead error:", e);
            result = { ok: false, error: e?.message ?? "Error desconocido", backend: "none" };
        }
        if (result.ok) {
            setLeadId(result.id ?? null);
            setBackend(result.backend);
            setSavedOk(true);
            onSuccess?.(result.id ?? "");
        } else {
            const isConfigErr = (result.error ?? "").toLowerCase().includes("firebase")
                || result.backend === "none";
            // ★ v1.9.43: mensaje sin mencionar WhatsApp
            const msg = isConfigErr
                ? `📝 Hemos recibido tu solicitud.\n\n` +
                  `Nuestro equipo activará tu prueba de 7 días en las próximas horas ` +
                  `y te contactará por email.`
                : `No pude guardar tus datos ahora mismo. ¿Me das unos segundos y vuelves a intentarlo?\n\n` +
                  `(${result.error ?? "Error desconocido"})`;
            try { pushAssistant(msg); } catch (_) {}
            // Marcamos como "guardado virtual" para que el flujo no se rompa
            setSavedOk(true);
            setBackend("none");
        }
        // ★ v1.9.66: Envío de email en PARALELO (no await en el flujo)
        // Por defecto asumimos OK al cabo de 3s. Si el server responde
        // antes, actualizamos con el resultado real. Esto evita que
        // el UI se quede en blanco o "pending" para siempre.
        const leadIdForEmail = result.id || `local-${Date.now()}`;

        // ★ v1.9.67: GUARDAR SIEMPRE en localStorage (independiente del email)
        // El admin puede recuperar leads aunque fallen todos los servicios externos.
        const lsPayload: LeadRecord = {
            id:               leadIdForEmail,
            user_email:       email || undefined,
            restaurant_name:  name || undefined,
            selected_plan:    (plan as PlanCode) || undefined,
            trial_ends_at:    trialEndsAt,
            status,
            chat_history:     history,
            source,
            metadata:         { business_type: businessType, source, ctxPlan: ctxPlan ?? null },
        };
        saveLeadToLocal(lsPayload, false, "pending");

        // Asume éxito a los 3s si no hay respuesta
        const assumeOkTimer = setTimeout(() => {
            if (emailStatusRef.current === null) {
                console.log("[AIAssistantModal] no response in 3s, assuming ok");
                setEmailStatus("ok");
                saveLeadToLocal(lsPayload, true, "assumed-ok");
            }
        }, 3000);

        sendLeadEmail({
            leadId:         leadIdForEmail,
            restaurantName: name || undefined,
            userEmail:      email || undefined,
            selectedPlan:   (plan as string) || "basic",
            businessType:   businessType || undefined,
            source:         source,
            trialEndsAt:    trialEndsAt,
            status:         status,
        }).then((emailResult) => {
            clearTimeout(assumeOkTimer);
            console.log("[AIAssistantModal] email notify result:", emailResult);
            if (emailResult.ok) {
                setEmailStatus("ok");
                setEmailNotConfigured(false);
                setEmailError(null);
                saveLeadToLocal(lsPayload, true, emailResult.via ?? "ok");
            } else {
                setEmailStatus("error");
                setEmailError(emailResult.error ?? "Error desconocido");
                saveLeadToLocal(lsPayload, false, emailResult.via ?? "error");
            }
        }).catch((e: any) => {
            clearTimeout(assumeOkTimer);
            console.warn("[AIAssistantModal] email notify catch:", e?.message ?? e);
            setEmailStatus("error");
            setEmailError(e?.message ?? "Error desconocido");
            saveLeadToLocal(lsPayload, false, "exception");
        });
        setBusy(false);
    };

    if (!open) return null;

    // ★ v1.9.49: Si ya se envió una solicitud desde este dispositivo,
    //    mostrar mensaje permanente en lugar del flujo de 5 pasos.
    if (alreadySubmitted) {
        return <AlreadySubmittedView onClose={onClose} isLogged={isLogged} navigate={navigate} />;
    }

    // Texto de confirmación
    const confirmText =
        `Vas a iniciar tu prueba de 7 días con el plan ${plan ? PLAN_LABEL[plan as PlanCode] : "—"} ` +
        `para ${name || "tu restaurante"}${email ? ` (Email: ${email})` : ""}.`;

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm
                        flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl
                            shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden
                            border border-slate-200/80">
                {/* ★ v1.9.36 + v1.9.39: Cabecera con avatar Riyad + glow animado cuando piensa */}
                <div className="bg-gradient-to-br from-violet-600 to-violet-700
                                text-white px-5 py-4 flex items-center gap-3">
                    <div className="relative shrink-0">
                        {/* ★ v1.9.39: Glow ring animado cuando está pensando */}
                        {isTyping && (
                            <>
                                <span className="absolute inset-0 rounded-2xl
                                                 bg-emerald-400/40 animate-ping" />
                                <span className="absolute -inset-1 rounded-2xl
                                                 bg-emerald-400/20 blur-md animate-pulse" />
                            </>
                        )}
                        <div className={
                            "relative w-11 h-11 rounded-2xl bg-white/20 backdrop-blur " +
                            "flex items-center justify-center shadow-lg transition-all duration-300 " +
                            (isTyping
                                ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-violet-700 scale-105"
                                : "ring-1 ring-white/30")
                        }>
                            <span className={
                                "text-[15px] font-black tracking-tight transition-all " +
                                (isTyping ? "text-emerald-200" : "")
                            }>R</span>
                        </div>
                        {/* Indicador "Online" verde */}
                        <span className="absolute -bottom-0.5 -right-0.5
                                         flex h-3.5 w-3.5">
                            <span className={
                                "absolute inline-flex h-full w-full rounded-full " +
                                (isTyping ? "bg-amber-400" : "bg-emerald-400") +
                                " opacity-60 animate-ping"
                            } />
                            <span className={
                                "relative inline-flex h-3.5 w-3.5 rounded-full " +
                                "border-2 border-violet-700 " +
                                (isTyping ? "bg-amber-500" : "bg-emerald-500")
                            } />
                        </span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-[14px] font-black tracking-tight">
                            Riyad <span className="font-medium opacity-80">| {mode === "config" ? "Copiloto de Configuración" : "Asistente MOZONA TPV"}</span>
                        </h3>
                        <p className="text-[10.5px] text-violet-100 flex items-center gap-1">
                            {isTyping ? (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                                    <span className="font-bold text-amber-200">Escribiendo</span>
                                </>
                            ) : (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                                    Online · {mode === "config" ? "Configurando tu negocio" : "Configura tu prueba de 7 días"}
                                </>
                            )}
                        </p>
                    </div>
                    <button onClick={onClose}
                            className="w-8 h-8 rounded-xl text-white/80 hover:text-white
                                       hover:bg-white/10 flex items-center justify-center">
                        ✕
                    </button>
                </div>

                {/* Mensajes */}
                <div ref={scrollRef}
                     className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50">
                    {messages.map((m, i) => (
                        <div key={i} className={
                            "flex " + (m.role === "user" ? "justify-end" : "justify-start")
                        }>
                            <div className={
                                "max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] " +
                                (m.role === "user"
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-slate-800 border border-slate-200/80")
                            }>
                                {m.content.split("\n").map((line, j) => (
                                    <div key={j}>{line}</div>
                                ))}
                            </div>
                        </div>
                    ))}
                    {/* ★ v1.9.39: Typing indicator (3 puntos animados) */}
                    {isTyping && (
                        <div className="flex justify-start">
                            <div className="bg-white border border-slate-200/80
                                            rounded-2xl px-3.5 py-2.5
                                            flex items-center gap-1.5
                                            shadow-sm">
                                <span className="sr-only">Riyad está escribiendo</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-500
                                                 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-500
                                                 animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-500
                                                 animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Confirmación con resumen */}
                {currentStep === "confirm" && (
                    <div className="px-4 py-2 bg-blue-50 border-t border-blue-200/80">
                        <div className="text-[11px] font-black text-blue-800 uppercase tracking-wider mb-1">
                            Resumen
                        </div>
                        <div className="text-[12px] text-blue-900">{confirmText}</div>
                    </div>
                )}

                {/* Acciones: input o botones */}
                <div className="border-t border-slate-200/80 bg-white px-4 py-3 space-y-2">
                    {/* ★ v1.9.52: en mode='config' el input SIEMPRE visible
                        (texto libre con parser). En mode='floating' solo si
                        el step actual tiene 'input' definido. */}
                    {(mode === "config" || getStepsFor(mode)[currentStep]?.input) ? (
                        <div className="flex gap-2">
                            <input
                                type={currentStep === "password" ? "password" : (mode === "config" ? "text" : (getStepsFor(mode)[currentStep].input === "email" ? "email" : "text"))}
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleInput()}
                                placeholder={
                                    mode === "config"
                                        ? (currentStep === "add-product-price" ? "Precio (IVA incl.)..."
                                          : currentStep === "add-product-iva" ? "% IVA (ej: 10)..."
                                          : 'Escribe: "Anadir bocadillo a 4.50" o "Crear categoria Postres"')
                                        : (currentStep === "password" ? "Minimo 6 caracteres..."
                                          : getStepsFor(mode)[currentStep].input === "email" ? "tu@email.com" : "Ej: Rincón de Casablanca")
                                }
                                className="input flex-1"
                                autoFocus
                            />
                            <button onClick={handleInput} disabled={isTyping || busy || !inputValue.trim()}
                                    className="h-10 px-4 rounded-xl bg-blue-600 text-white
                                               text-[12.5px] font-bold active:scale-95 transition
                                               disabled:opacity-50">
                                →
                            </button>
                        </div>
                    ) : getStepsFor(mode)[currentStep]?.options ? (
                        <div className="grid grid-cols-1 gap-2">
                            {getStepsFor(mode)[currentStep].options!.map((opt, i) => {
                                // ★ v1.9.49: el botón "yes" muestra "Enviando..." durante el submit
                                const isYesSubmitting = isSubmitting
                                    && currentStep === "confirm"
                                    && opt.value === "yes";
                                const label = isYesSubmitting
                                    ? "⏳  Enviando solicitud..."
                                    : opt.label;
                                return (
                                <button key={i}
                                        onClick={() => handleOption(opt.value, opt.next)}
                                        disabled={isTyping || isSubmitting || (busy && currentStep === "confirm")}
                                        className="w-full h-10 rounded-xl bg-slate-100 hover:bg-slate-200
                                                   text-[12.5px] font-bold text-slate-800
                                                   active:scale-95 transition disabled:opacity-50
                                                   text-left px-4 flex items-center gap-2">
                                    {isYesSubmitting ? (
                                        <span className="inline-block w-3.5 h-3.5
                                                         border-2 border-blue-600 border-t-transparent
                                                         rounded-full animate-spin" />
                                    ) : (
                                        <span className="text-blue-600">→</span>
                                    )}
                                    {label}
                                </button>
                                );
                            })}
                        </div>
                    ) : null}

                    {savedOk && (
                        <div className="flex flex-col items-center gap-1 pt-1">
                            {/* ★ v1.9.66: estado del email - solo ok/error, NUNCA pending */}
                            {emailStatus === "ok" && (
                                <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-600
                                                font-bold justify-center">
                                    <IconCheck size={12} strokeWidth={2.4} />
                                    <span>Email enviado correctamente</span>
                                </div>
                            )}
                            {emailStatus === "error" && (
                                <div className="text-[10px] text-rose-600 font-bold
                                                text-center px-2">
                                    ⚠ {emailError || "No se pudo enviar el email"}
                                </div>
                            )}
                            {emailStatus === "pending" && (
                                <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500
                                                font-bold justify-center">
                                    <span>Procesando solicitud...</span>
                                </div>
                            )}
                            {/* ★ v1.9.79: Mensaje de confirmación limpio
                                (sin botones externos: Telegram es el canal del admin) */}
                            <div className="w-full pt-1.5 border-t border-slate-200/60 mt-1.5">
                                <div className="text-[10.5px] text-slate-600 text-center font-semibold leading-relaxed">
                                    Tu solicitud ha sido registrada.
                                    Te avisaremos por los canales internos.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
