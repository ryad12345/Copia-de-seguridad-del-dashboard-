// =====================================================================
// MOZONA TPV — useInstallPrompt
// =====================================================================
// Captura el evento `beforeinstallprompt` de Chromium y expone:
//   • deferredPrompt: el evento guardado para llamar a prompt() cuando
//     el usuario pulse "Instalar".
//   • canInstall: si hay un prompt diferido pendiente.
//   • isIOS: si el usuario está en iOS Safari (que no soporta
//     beforeinstallprompt y requiere instrucciones manuales).
//   • isStandalone: si la app ya está instalada.
//   • promptInstall(): dispara el prompt nativo del navegador.
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { isIOS, isStandalone as isStandaloneNow, isInstallEvent, type BeforeInstallPromptEvent } from "../lib/pwa-types";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface UseInstallPromptReturn {
    /** Hay un prompt diferido pendiente de invocar */
    canInstall:        boolean;
    /** El dispositivo es iOS (instrucciones especiales) */
    isIOS:             boolean;
    /** La app ya está corriendo en modo standalone */
    isStandalone:      boolean;
    /** El usuario cerró el banner en esta sesión (no volver a mostrar) */
    dismissed:         boolean;
    /** Dispara el prompt nativo (sólo Chromium) */
    promptInstall:     () => Promise<"accepted" | "dismissed" | "unavailable">;
    /** Marca el banner como cerrado (no vuelve a aparecer en esta sesión) */
    dismiss:           () => void;
}

// ---------------------------------------------------------------------
// Persistencia de "dismissed" (mientras dure la sesión)
// ---------------------------------------------------------------------

const SESSION_KEY = "mozona.pwa.install.dismissed";

function loadDismissed(): boolean {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(SESSION_KEY) === "1";
}
function saveDismissed(v: boolean): void {
    if (typeof sessionStorage === "undefined") return;
    if (v) sessionStorage.setItem(SESSION_KEY, "1");
    else   sessionStorage.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------

export function useInstallPrompt(): UseInstallPromptReturn {
    const [deferred, setDeferred]   = useState<BeforeInstallPromptEvent | null>(null);
    const [dismissed, setDismissed] = useState<boolean>(loadDismissed);

    const isIOSDevice = isIOS();
    const isAppStandalone = isStandaloneNow();

    useEffect(() => {
        if (isAppStandalone) return;   // ya instalada
        const handler = (e: Event) => {
            if (!isInstallEvent(e)) return;
            e.preventDefault();         // NO mostrar el mini-banner del navegador
            setDeferred(e);
        };
        window.addEventListener("beforeinstallprompt", handler);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, [isAppStandalone]);

    // Si la app se acaba de instalar, limpiamos estado
    useEffect(() => {
        const onInstalled = () => setDeferred(null);
        window.addEventListener("appinstalled", onInstalled);
        return () => window.removeEventListener("appinstalled", onInstalled);
    }, []);

    const promptInstall = useCallback(async ():
        Promise<"accepted" | "dismissed" | "unavailable"> => {
        if (!deferred) return "unavailable";
        try {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            setDeferred(null);
            return choice.outcome;
        } catch {
            return "unavailable";
        }
    }, [deferred]);

    const dismiss = useCallback(() => {
        setDismissed(true);
        saveDismissed(true);
    }, []);

    return {
        canInstall:     deferred !== null && !isAppStandalone,
        isIOS:          isIOSDevice,
        isStandalone:   isAppStandalone,
        dismissed,
        promptInstall,
        dismiss,
    };
}
