// =====================================================================
// MOZONA TPV — SetupCajaPage (/setup-caja)
// =====================================================================
// Pantalla que explica cómo conectar la caja central (PC con
// impresora USB) al servicio.  Proporciona scripts de instalación
// rápida en 1 comando (PowerShell / bash) y explica la alternativa
// 100% web vía WebSerial / WebHID.
// =====================================================================

import { useState } from "react";
import { Link } from "react-router-dom";
import { IconTerminal, IconCopy, IconCheck, IconUsb, IconShield, IconArrowRight } from "../components/icons";
import { Logo } from "../components/Logo";

const PS1_CMD = `irm https://mozona-tpv.com/install.ps1 | iex`;
const SH_CMD  = `curl -fsSL https://mozona-tpv.com/install.sh | bash`;

const STEPS = [
    {
        n: 1,
        title: "Prepara la caja",
        desc: "Asegúrate de tener un PC con Windows, macOS o Linux conectado por USB a la impresora térmica y al cajón portamonedas.",
    },
    {
        n: 2,
        title: "Copia y pega el instalador",
        desc: "Abre PowerShell (Windows) o Terminal (macOS/Linux) y ejecuta el comando de tu sistema.  El instalador descarga el agente MOZONA Bridge, lo registra como servicio y te dará un código de emparejamiento.",
    },
    {
        n: 3,
        title: "Empareja con tu cuenta",
        desc: "Pega el código de emparejamiento en la app web o en la sección de Ajustes.  A partir de ahí, los comanderos móviles y el panel de caja imprimirán directamente por tu USB.",
    },
];

export function SetupCajaPage() {
    return (
        <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-white">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
                <div className="max-w-4xl mx-auto px-5 h-14 flex items-center gap-3">
                    <Link to="/" className="flex items-center gap-2">
                        <Logo variant="mark" size="sm" />
                    </Link>
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                                     rounded-full bg-blue-50 text-blue-700">
                        Setup
                    </span>
                </div>
            </header>

            <div className="max-w-4xl mx-auto px-5 py-10">
                <h1 className="text-[32px] sm:text-[40px] font-black tracking-tight text-center">
                    Conecta tu caja central
                </h1>
                <p className="mt-3 text-[15px] text-slate-600 text-center max-w-2xl mx-auto">
                    Instala el agente MOZONA Bridge en el PC que tiene la impresora USB.
                    Un comando, sin configurar nada.
                </p>

                {/* Steps */}
                <ol className="mt-10 space-y-4">
                    {STEPS.map(s => (
                        <li key={s.n}
                            className="flex gap-4 p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                            <div className="
                                shrink-0 w-10 h-10 rounded-2xl
                                bg-gradient-to-br from-blue-600 to-blue-700
                                text-white font-black text-lg
                                flex items-center justify-center
                                shadow-sm shadow-blue-600/30
                            ">
                                {s.n}
                            </div>
                            <div>
                                <h3 className="text-[15px] font-black text-slate-900">{s.title}</h3>
                                <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">{s.desc}</p>
                            </div>
                        </li>
                    ))}
                </ol>

                {/* Instaladores */}
                <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CommandBlock os="Windows (PowerShell)" cmd={PS1_CMD} />
                    <CommandBlock os="macOS / Linux (Terminal)" cmd={SH_CMD} />
                </div>

                {/* WebSerial alternative */}
                <div className="mt-8 p-6 rounded-3xl bg-gradient-to-br from-violet-50 to-blue-50
                                border border-violet-200/80">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-2xl bg-violet-600 text-white
                                        flex items-center justify-center shrink-0
                                        shadow-sm shadow-violet-600/30">
                            <IconUsb size={20} strokeWidth={1.8} />
                        </div>
                        <div>
                            <h3 className="text-[16px] font-black text-slate-900">
                                ¿Sin servidor local?  Usa WebSerial directo desde el navegador
                            </h3>
                            <p className="mt-1.5 text-[12.5px] text-slate-700 leading-relaxed">
                                Si operas todo desde un único PC con Chrome/Edge, puedes
                                imprimir directamente por USB sin instalar nada gracias a
                                la API <strong>WebSerial</strong>.  La app detecta tu
                                impresora, te pide permiso la primera vez y guarda el
                                dispositivo.
                            </p>
                            <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                                <IconShield size={11} strokeWidth={2.2} />
                                Sólo disponible en navegadores Chromium.  Safari/Firefox
                                no soportan WebSerial todavía.
                            </p>
                        </div>
                    </div>
                </div>

                {/* FAQ */}
                <div className="mt-10 space-y-3">
                    <h2 className="text-[20px] font-black tracking-tight">Preguntas frecuentes</h2>
                    <Faq q="¿Qué impresoras son compatibles?" a="Cualquier impresora ESC/POS USB estándar: Xprinter, Epson TM-T20, Star TSP, Brother RJ, etc.  También cajones portamonedas conectados al puerto RJ11 de la impresora." />
                    <Faq q="¿Es seguro?" a="Sí.  El agente sólo abre un túnel WebSocket TLS hacia tu panel de MOZONA TPV autenticado con tu API key personal.  La impresora está aislada del internet público." />
                    <Faq q="¿Cuántas impresoras puedo tener?" a="Ilimitadas.  Una por caja.  Cada una con su nombre (barra, cocina, mostrador) y sus productos asociados." />
                </div>

                {/* CTA */}
                <div className="mt-10 text-center">
                    <Link to="/auth?signup=1"
                          className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl
                                     bg-slate-900 text-white text-[14px] font-black
                                     shadow-lg shadow-slate-900/20
                                     active:scale-95 transition">
                        Crear cuenta y empezar
                        <IconArrowRight size={16} strokeWidth={2.4} />
                    </Link>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function CommandBlock({ os, cmd }: { os: string; cmd: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* noop */ }
    };
    return (
        <div className="p-5 rounded-2xl bg-slate-900 text-slate-100 shadow-lg">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <IconTerminal size={12} strokeWidth={2.2} />
                    {os}
                </div>
                <button onClick={copy}
                        className="w-7 h-7 rounded-md text-slate-400 hover:text-white hover:bg-slate-800
                                   flex items-center justify-center active:scale-90 transition"
                        title="Copiar">
                    {copied ? <IconCheck size={14} strokeWidth={2.4} className="text-emerald-400" />
                             : <IconCopy  size={14} strokeWidth={2} />}
                </button>
            </div>
            <code className="block text-[12.5px] font-mono break-all leading-relaxed text-slate-200">
                {cmd}
            </code>
        </div>
    );
}

function Faq({ q, a }: { q: string; a: string }) {
    return (
        <details className="group p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <summary className="cursor-pointer list-none flex items-center justify-between
                                 text-[13.5px] font-bold text-slate-900">
                {q}
                <span className="ml-3 text-slate-400 group-open:rotate-45 transition">+</span>
            </summary>
            <p className="mt-2 text-[12.5px] text-slate-600 leading-relaxed">{a}</p>
        </details>
    );
}
