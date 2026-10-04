// =====================================================================
// MOZONA TPV — useIsMobile
// =====================================================================
// Hook que devuelve `true` si el viewport es estrecho (mobile).
// Usa `matchMedia("(max-width: 767px)")` para ser reactivo al resize
// y al cambio de orientación, y SSR-safe (devuelve `false` en server).
// =====================================================================

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia(MOBILE_QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mql = window.matchMedia(MOBILE_QUERY);
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        // `addEventListener` está disponible en todos los navegadores
        // modernos.  `addListener` está deprecated pero se mantiene
        // como fallback para Safari < 14.
        if (mql.addEventListener) {
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        }
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
    }, []);

    return isMobile;
}
