// =====================================================================
// MOZONA TPV — Tipos específicos de la PWA
// =====================================================================

// ---------------------------------------------------------------------
// beforeinstallprompt (Chromium-based, no está en lib.dom.d.ts)
// ---------------------------------------------------------------------

export interface BeforeInstallPromptEvent extends Event {
    readonly platforms: ReadonlyArray<string>;
    readonly userChoice: Promise<{
        outcome: "accepted" | "dismissed";
        platform: string;
    }>;
    prompt(): Promise<void>;
}

export function isInstallEvent(e: Event): e is BeforeInstallPromptEvent {
    return "prompt" in e && "userChoice" in e && "platforms" in e;
}

// ---------------------------------------------------------------------
// Display mode (PWA instalada o en navegador)
// ---------------------------------------------------------------------

export type DisplayMode = "browser" | "standalone" | "minimal-ui" | "fullscreen";

export function getDisplayMode(): DisplayMode {
    if (typeof window === "undefined") return "browser";
    const modes = ["fullscreen", "standalone", "minimal-ui", "browser"] as const;
    for (const m of modes) {
        if (window.matchMedia(`(display-mode: ${m})`).matches) return m;
    }
    return "browser";
}

// ---------------------------------------------------------------------
// iOS detection
// ---------------------------------------------------------------------

export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua) && !("MSStream" in window)) return true;
    // iPad con iOS 13+ que se identifica como Mac
    return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

export function isStandalone(): boolean {
    return getDisplayMode() === "standalone";
}
