// =====================================================================
// MOZONA TPV — RouteAwareChatPro (v4.0.7-no-chat-outside-tpv)
// =====================================================================
// Wrapper que SOLO renderiza el ChatPro cuando el usuario está
// dentro del panel de caja principal (TPV activo).
//
// OCULTO en:
//   - Landing page (/)
//   - Login/registro (/auth)
//   - Onboarding wizard (/onboarding)
//   - Setup caja (/setup-caja)
//   - Waiting activation (/waiting-activation)
//   - Welcome page (/welcome)
//
// VISIBLE solo en:
//   - /app (PosTerminalPro)
// =====================================================================

import { useLocation } from "react-router-dom";
import { ChatPro } from "./ChatPro";

const TPV_ONLY_PATHS = new Set([
    "/app",
]);

export function RouteAwareChatPro() {
    const location = useLocation();
    const isTpvActive = TPV_ONLY_PATHS.has(location.pathname);

    if (!isTpvActive) {
        return null;
    }

    return <ChatPro />;
}
