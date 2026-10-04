// =====================================================================
// MOZONA TPV — useStressDetector (v3.5.0)
// =====================================================================
// Detecta el nivel de carga del TPV:
//   - normal: < 10 comandas pendientes
//   - medium: 10-20 comandas
//   - high:   > 20 comandas (modo Hora Punta Ciega)
// =====================================================================

import { useEffect, useState } from "react";

interface StressConfig {
    lowThreshold: number;
    highThreshold: number;
}

const DEFAULT_CONFIG: StressConfig = {
    lowThreshold: 0,     // siempre empieza en normal
    highThreshold: 15,   // > 15 comandas pendientes = HORA PUNTA
};

export type StressLevel = "normal" | "medium" | "high";

export function useStressDetector(pendingOrders: number, config = DEFAULT_CONFIG): StressLevel {
    const [level, setLevel] = useState<StressLevel>(() => computeLevel(pendingOrders, config));

    useEffect(() => {
        setLevel(computeLevel(pendingOrders, config));
    }, [pendingOrders, config]);

    // Aplicar clase CSS al <html>
    useEffect(() => {
        try {
            const html = document.documentElement;
            html.setAttribute("data-stress-level", level);
        } catch (_) {}
        return () => {
            try {
                const html = document.documentElement;
                html.setAttribute("data-stress-level", "normal");
            } catch (_) {}
        };
    }, [level]);

    return level;
}

function computeLevel(pendingOrders: number, config: StressConfig): StressLevel {
    if (pendingOrders >= config.highThreshold) return "high";
    if (pendingOrders >= config.lowThreshold) return "medium";
    return "normal";
}
