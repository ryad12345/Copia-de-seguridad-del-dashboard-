// OfflineBanner v4.0.9-stable: solo lee estado local, sin suscripciones reactivas complejas
import React, { useEffect, useState } from "react";

type Status = "online" | "degraded" | "offline" | "unknown";

function readState(): Status {
    try {
        if (typeof localStorage === "undefined") return "unknown";
        const raw = localStorage.getItem("mozona.health.state");
        if (!raw) return "unknown";
        const parsed = JSON.parse(raw);
        return parsed?.status ?? "unknown";
    } catch {
        return "unknown";
    }
}

export function OfflineBanner() {
    const [status, setStatus] = useState<Status>(() => readState());

    useEffect(() => {
        function onChange() {
            try { setStatus(readState()); } catch {}
        }
        // Solo escucha evento, NO se auto-monta en onError
        window.addEventListener("mozona:health-changed", onChange as EventListener);
        window.addEventListener("storage", onChange as EventListener);
        // Tick suave
        const id = setInterval(onChange, 5000);
        return () => {
            window.removeEventListener("mozona:health-changed", onChange as EventListener);
            window.removeEventListener("storage", onChange as EventListener);
            clearInterval(id);
        };
    }, []);

    if (status !== "offline" && status !== "degraded") return null;

    const message = status === "offline"
        ? "Modo offline: tus cambios se guardan localmente"
        : "Conexión lenta con Supabase";
    const color = status === "offline" ? "bg-amber-500" : "bg-yellow-500";
    const icon = status === "offline" ? "⚡" : "⚠️";

    return (
        <div role="status" aria-live="polite"
            className={`${color} text-white text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg shadow-md flex items-center gap-2 mx-2 mt-2`}>
            <span aria-hidden>{icon}</span>
            <span className="flex-1">{message}</span>
        </div>
    );
}

export default OfflineBanner;
