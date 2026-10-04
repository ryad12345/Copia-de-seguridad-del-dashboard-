// =====================================================================
// MOZONA TPV — Onboarding Step 5: Resumen y lanzamiento
// =====================================================================

import { StepShell, HintBox } from "./BusinessStep";
import {
    IconStore, IconSparkles, IconUser, IconCheck,
    IconCamera,
} from "../icons";
import type { OnboardingData } from "../../pages/OnboardingWizard";

export interface SummaryStepProps {
    data: OnboardingData;
}

export function SummaryStep({ data }: SummaryStepProps) {
    const totalTables  = data.tables.zones.reduce((a, z) => a + z.tableCount, 0);
    const totalPlates  = data.menu.items.length;
    const totalWaiters = data.team.waiters.filter(w => w.name.trim()).length;
    const totalCat     = new Set(data.menu.items.map(i => i.category).filter(Boolean)).size;

    const sections = [
        {
            Icon: IconStore,
            title: "Tu restaurante",
            items: [
                data.business.business_name || "Sin nombre",
                data.business.cif_nif ? `CIF/NIF: ${data.business.cif_nif}` : "Sin CIF/NIF",
                data.business.address || "Sin dirección",
                `IVA por defecto: ${data.business.default_tax_rate}%`,
            ].filter(Boolean),
        },
        {
            Icon: IconSparkles,
            title: `${data.tables.zones.length} zonas · ${totalTables} mesas`,
            items: data.tables.zones.length === 0
                ? ["Sin zonas (puedes añadirlas desde Ajustes)"]
                : data.tables.zones.map(z =>
                    `• ${z.name}: ${z.tableCount} mesas (${z.tablePrefix || "?"}-1 … ${z.tablePrefix || "?"}-${z.tableCount})`
                ),
        },
        {
            Icon: IconCamera,
            title: `${totalPlates} productos en ${totalCat} categorías`,
            items: data.menu.items.length === 0
                ? ["Sin productos (puedes añadirlos desde Ajustes)"]
                : [`${data.menu.items.length} platos listos para cobrar`,
                   ...data.menu.items.slice(0, 5).map(it => `• ${it.name} — ${formatPrice(it.price)}`),
                   ...(data.menu.items.length > 5 ? [`… y ${data.menu.items.length - 5} más`] : [])],
        },
        {
            Icon: IconUser,
            title: `${totalWaiters} miembros en el equipo`,
            items: data.team.waiters.filter(w => w.name).length === 0
                ? ["Sin miembros (puedes añadirlos desde Ajustes)"]
                : data.team.waiters
                    .filter(w => w.name)
                    // ★ v4.6.0 (H-07): no mostramos el PIN en el resumen (se
                    //   almacena hasheado server-side y no debe exponerse).
                    .map(w => `• ${w.name} — ${roleLabel(w.role)} (PIN configurado)`),
        },
    ];

    return (
        <StepShell
            icon={<IconCheck size={22} strokeWidth={2.4} />}
            title="¡Todo listo!"
            subtitle="Revisa el resumen y pulsa el botón inferior para empezar a operar."
        >
            <div className="space-y-3">
                {sections.map((s, i) => (
                    <div key={i}
                         className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="
                                w-7 h-7 rounded-lg
                                bg-white border border-slate-200/80
                                text-slate-700
                                flex items-center justify-center
                            ">
                                <s.Icon size={14} strokeWidth={1.8} />
                            </div>
                            <div className="text-[13px] font-black text-slate-900">
                                {s.title}
                            </div>
                        </div>
                        <ul className="pl-9 space-y-0.5 text-[12px] text-slate-600">
                            {s.items.map((line, j) => (
                                <li key={j}>{line}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            <HintBox>
                <IconCheck size={12} strokeWidth={2.4} className="mt-0.5 shrink-0 text-emerald-500" />
                <span>
                    Al pulsar <strong>Comenzar el servicio</strong> entrarás directamente
                    en la app.  Podrás modificar cualquiera de estos datos desde el
                    panel de <strong>Ajustes</strong> en cualquier momento.
                </span>
            </HintBox>
        </StepShell>
    );
}

function formatPrice(n: number): string {
    return new Intl.NumberFormat("es-ES", {
        style: "currency", currency: "EUR",
    }).format(n);
}

function roleLabel(role: string): string {
    return role === "cashier" ? "Cajero"
         : role === "owner"   ? "Encargado"
         : "Camarero";
}
