// =====================================================================
// MOZONA TPV — LandingPage (/)
// =====================================================================
// Página comercial estilo Apple/iOS.  Marketing puro: hero, features,
// pricing preview, FAQ, footer, CTA principal a /auth.
// =====================================================================

import { Link, useNavigate } from "react-router-dom";
import {
    IconStore, IconUser, IconReceipt, IconShield, IconSparkles,
    IconCheck, IconArrowRight, IconPrint, IconWifi,
} from "../components/icons";
// IconSparkles se mantiene en el import por si se reutiliza en el futuro.
// (TS no se queja por imports no usados a menos que esté habilitado noUnusedLocals)
import { Logo } from "../components/Logo";
import { HeroMockup } from "../components/HeroMockup";
import { useAuth } from "../lib/auth";
import { openAssistant } from "../lib/assistant";
import { cn } from "../lib/cn";
import { getHomeRouteForEmail } from "../lib/vip";

const FEATURES = [
    { icon: <IconUser     size={20} strokeWidth={1.8} />, title: "Comanderos móviles",      desc: "Tus camareros toman nota desde el móvil con la misma carta, modifican líneas y marchan comanda al instante. Sin instalar nada." },
    { icon: <IconStore    size={20} strokeWidth={1.8} />, title: "Gestión de mesas",        desc: "Mapa visual del salón con zonas, estados en tiempo real (libre, ocupada, pidiendo cuenta) y asignación rápida por drag." },
    { icon: <IconReceipt  size={20} strokeWidth={1.8} />, title: "Tickets e inventario",    desc: "Tickets fiscales VeriFactu, control de stock por producto, arqueo de caja al cierre y exportación a CSV." },
    { icon: <IconPrint    size={20} strokeWidth={1.8} />, title: "Impresoras térmicas",     desc: "Compatibilidad ESC/POS nativa: USB, red o WiFi.  Soporta cajón portamonedas, QR y logos personalizados." },
    { icon: <IconShield   size={20} strokeWidth={1.8} />, title: "Cumplimiento VeriFactu",  desc: "Cadena SHA-256, QR AEAT y firma digital listos para Hacienda. Compatible con la normativa española 2024-2025." },
    { icon: <IconWifi     size={20} strokeWidth={1.8} />, title: "Local-First PWA",         desc: "Funciona sin internet.  Cuando vuelves online, sincroniza comandas, facturas y catálogo automáticamente." },
];

const PLANS = [
    { id: "basic",        name: "Plus",  price: "30",  tag: "Recomendado",
      perks: ["TPV ilimitado en la nube", "Comanderos móviles en tiempo real", "Mesas, tickets e inventario",
              "VeriFactu + AES-256", "Soporte por email"] },
    { id: "professional", name: "Pro",   price: "50",  tag: "Para crecer",
      perks: ["Todo lo de Plus", "Soporte técnico prioritario", "Asistencia remota",
              "Copias de seguridad continuas", "Formación inicial"] },
];

const FAQS = [
    { q: "¿Necesito instalar algo?", a: "No.  Es 100% web.  Funciona en cualquier navegador moderno y como app en iOS/Android.  La caja central se conecta a tus impresoras USB vía un pequeño agente instalable en 1 comando." },
    { q: "¿Y si se cae Internet?",  a: "La app sigue funcionando offline.  Cuando vuelves online, las comandas y facturas se sincronizan solas." },
    { q: "¿Cuántos dispositivos puedo conectar?", a: "Ilimitados en cualquier plan.  Camareros, tablets de barra, cocina, TPV principal: todos conectados en tiempo real." },
    { q: "¿Hacéis factura?",       a: "Sí, somos empresa española.  Factura mensual con IVA incluido.  Cancela cuando quieras." },
];

export function LandingPage() {
    const auth = useAuth();
    const navigate = useNavigate();

    // ★ v4.5.11: handler único para todos los botones "Probar"
    //    - Si es ADMIN (rofixinsta) → /admin
    //    - Si es VIP (chalohiahmd) → /app directo
    //    - Si está autenticado normal → /welcome (sala espera)
    //    - Si NO está autenticado → /auth con modo signup activado
    const handleProbar = (ctxPlan?: string) => {
        try {
            if (auth.user) {
                navigate(getHomeRouteForEmail(auth.user.email, true));
            } else {
                // ctxPlan se guarda en sessionStorage para que /auth lo recoja
                if (ctxPlan) {
                    try { sessionStorage.setItem("mozona.signup.plan", ctxPlan); } catch {}
                }
                navigate("/auth?mode=signup");
            }
        } catch {
            const dest = auth.user
                ? getHomeRouteForEmail(auth.user.email, true)
                : "/auth?mode=signup";
            window.location.href = dest;
        }
    };

    return (
        <div className="min-h-dvh bg-white text-slate-900">
            {/* =================================================== NAV */}
            <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
                <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2">
                        <Logo variant="mark" size="sm" />
                    </Link>
                    <nav className="hidden sm:flex items-center gap-5 text-[13px] font-semibold text-slate-600">
                        <a href="#features"  className="hover:text-slate-900 transition">Características</a>
                        <a href="#pricing"   className="hover:text-slate-900 transition">Planes</a>
                        <a href="#faq"       className="hover:text-slate-900 transition">FAQ</a>
                    </nav>
                    <div className="flex items-center gap-2">
                        {auth.user ? (
                            <Link to="/app"
                                  className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl
                                             bg-slate-900 text-white text-[12.5px] font-bold
                                             active:scale-95 transition">
                                Ir a mi panel
                                <IconArrowRight size={14} strokeWidth={2.4} />
                            </Link>
                        ) : (
                            <>
                                {/* ★ v1.9.74: Botón "Iniciar sesión" SIEMPRE visible
                                    (móvil + desktop) con estilo claro y accesible */}
                                <Link to="/auth"
                                      title="Acceder a tu cuenta"
                                      aria-label="Iniciar sesión"
                                      className="h-9 px-2.5 sm:px-3 inline-flex items-center gap-1
                                                 rounded-lg sm:rounded-xl
                                                 border border-slate-200 bg-white
                                                 text-[12.5px] font-bold text-slate-700
                                                 hover:bg-slate-50 hover:border-slate-300
                                                 active:scale-95 transition
                                                 touch-manipulation select-none
                                                 shadow-sm">
                                    <IconUser size={15} strokeWidth={2} />
                                    <span className="hidden sm:inline">Iniciar sesión</span>
                                </Link>
                                <button type="button"
                                        onClick={() => handleProbar()}
                                        title={auth.user ? "Ir al panel" : "Empezar 7 días gratis"}
                                        aria-label={auth.user ? "Ir a mi panel" : "Probar 7 días gratis"}
                                        className="h-9 px-3 sm:px-4 inline-flex items-center gap-1.5 rounded-xl
                                                   bg-blue-600 text-white text-[12.5px] font-bold
                                                   shadow-sm shadow-blue-600/30
                                                   hover:bg-blue-700
                                                   active:scale-95 transition
                                                   touch-manipulation cursor-pointer">
                                    <span className="hidden sm:inline">Probar 7 días</span>
                                    <span className="sm:hidden">Probar</span>
                                    <IconArrowRight size={14} strokeWidth={2.4} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            {/* =============================================== HERO */}
            <section className="relative overflow-hidden">
                <div className="absolute inset-0 -z-10
                                bg-gradient-to-b from-blue-50 via-white to-white
                                [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
                <div className="max-w-6xl mx-auto px-5 pt-16 sm:pt-24 pb-16 sm:pb-20 text-center">
                    <h1 className="text-[40px] sm:text-[60px] leading-[1.05] font-black tracking-tight text-slate-900">
                        Tu TPV de hostelería,{" "}
                        <span className="bg-gradient-to-br from-blue-600 to-blue-800 bg-clip-text text-transparent">
                            en la nube
                        </span>
                        <br className="hidden sm:block" />
                        y en tu local.
                    </h1>
                    <p className="mt-5 text-[16px] sm:text-[18px] text-slate-600 max-w-2xl mx-auto leading-relaxed">
                        Comanderos móviles, gestión de mesas, VeriFactu, impresoras térmicas y
                        todo lo que tu local necesita — funciona online y offline, sin instalaciones.
                    </p>
                    <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
                        <button type="button"
                              onClick={() => handleProbar()}
                              title={auth.user ? "Ir al panel" : "Empezar 7 días gratis"}
                              aria-label={auth.user ? "Ir a mi panel" : "Probar 7 días gratis"}
                              className="h-12 px-6 inline-flex items-center gap-2 rounded-2xl
                                         bg-slate-900 text-white text-[15px] font-black
                                         shadow-lg shadow-slate-900/20
                                         hover:bg-slate-800 hover:scale-[1.02]
                                         active:scale-95 transition
                                         cursor-pointer">
                            Probar 7 días gratis
                            <IconArrowRight size={16} strokeWidth={2.4} />
                        </button>
                        <a href="#features"
                           className="h-12 px-5 inline-flex items-center
                                      text-[14px] font-semibold text-slate-700
                                      hover:text-slate-900 transition">
                            Ver características
                        </a>
                    </div>
                    <div className="mt-12 max-w-5xl mx-auto">
                        <HeroMockup />
                    </div>
                </div>
            </section>

            {/* =========================================== FEATURES */}
            <section id="features" className="py-20 bg-slate-50">
                <div className="max-w-6xl mx-auto px-5">
                    <div className="text-center mb-12">
                        <h2 className="text-[32px] sm:text-[40px] font-black tracking-tight">
                            Todo lo que necesitas.
                        </h2>
                        <p className="mt-3 text-[15px] text-slate-600 max-w-xl mx-auto">
                            Diseñado por y para hosteleros.  Sin curvas de aprendizaje.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {FEATURES.map((f, i) => (
                            <div key={i}
                                 className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm
                                            hover:shadow-md hover:-translate-y-0.5 transition">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600
                                                flex items-center justify-center mb-3">
                                    {f.icon}
                                </div>
                                <h3 className="text-[15px] font-black text-slate-900">{f.title}</h3>
                                <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* =========================================== PRICING */}
            <section id="pricing" className="py-20">
                <div className="max-w-5xl mx-auto px-5">
                    <div className="text-center mb-12">
                        <h2 className="text-[32px] sm:text-[40px] font-black tracking-tight">
                            Planes transparentes.
                        </h2>
                        <p className="mt-3 text-[15px] text-slate-600 max-w-xl mx-auto">
                            Sin permanencia.  Cancela cuando quieras.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {PLANS.map((p, i) => (
                            <div key={i}
                                 className={cn(
                                     "p-6 rounded-3xl border bg-white",
                                     p.name === "Pro"
                                         ? "border-blue-300 shadow-xl shadow-blue-600/10"
                                         : "border-slate-200/80 shadow-sm"
                                 )}>
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[18px] font-black">{p.name}</h3>
                                    <span className="text-[10.5px] font-bold uppercase tracking-wider
                                                     px-2 py-0.5 rounded-full
                                                     bg-blue-50 text-blue-700">
                                        {p.tag}
                                    </span>
                                </div>
                                <div className="mt-3 flex items-baseline gap-1">
                                    <span className="text-[44px] font-black tabular-nums leading-none">
                                        {p.price}€
                                    </span>
                                    <span className="text-[13px] text-slate-500">/mes</span>
                                </div>
                                <ul className="mt-5 space-y-2">
                                    {p.perks.map((perk, j) => (
                                        <li key={j} className="flex items-start gap-2 text-[13px] text-slate-700">
                                            <IconCheck size={16} strokeWidth={2.4}
                                                       className="text-emerald-500 mt-0.5 shrink-0" />
                                            {perk}
                                        </li>
                                    ))}
                                </ul>
                                <button type="button"
                                        onClick={() => handleProbar(p.id)}
                                        title={`Empezar con el plan ${p.name}`}
                                        aria-label={`Probar el plan ${p.name} 7 días gratis`}
                                        className="mt-6 w-full h-11 inline-flex items-center justify-center
                                                   rounded-xl bg-slate-900 text-white text-[13.5px] font-black
                                                   hover:bg-slate-800
                                                   active:scale-95 transition
                                                   cursor-pointer">
                                    Elegir {p.name} · Probar 7 días
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ================================================ FAQ */}
            <section id="faq" className="py-20 bg-slate-50">
                <div className="max-w-3xl mx-auto px-5">
                    <h2 className="text-[28px] font-black tracking-tight text-center mb-10">
                        Preguntas frecuentes
                    </h2>
                    <div className="space-y-3">
                        {FAQS.map((f, i) => (
                            <details key={i}
                                     className="group p-5 rounded-2xl bg-white border border-slate-200/80
                                                shadow-sm">
                                <summary className="cursor-pointer list-none flex items-center justify-between
                                                     text-[14.5px] font-bold text-slate-900">
                                    {f.q}
                                    <span className="ml-3 text-slate-400 group-open:rotate-45 transition">+</span>
                                </summary>
                                <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">{f.a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ============================================= FOOTER */}
            <footer className="py-10 border-t border-slate-200/80">
                <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Logo variant="mark" size="xs" />
                        <span className="text-[11px] text-slate-400">© 2025</span>
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-slate-500">
                        <Link to="/auth"  className="hover:text-slate-900">Acceder</Link>
                        <Link to="/setup-caja" className="hover:text-slate-900">Setup caja</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

// (cn importado de lib/cn)
