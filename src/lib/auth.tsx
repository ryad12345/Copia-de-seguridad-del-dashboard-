// =====================================================================
// MOZONA TPV — Re-export del AuthContext unificado
// =====================================================================
// Este archivo existía antes con la lógica completa de Supabase + RLS.
// Para simplificar el build y unificar el comportamiento, ahora solo
// reexporta desde src/context/AuthContext.tsx, que persiste en
// localStorage bajo "pos_current_user" y nunca devuelve "no provider".
// =====================================================================

export {
    AuthProvider,
    useAuth,
    useAuthOptional,
    default as default,
    type AuthUser as UserProfile,
    type AuthSession,
    type AuthContextValue,
} from "../context/AuthContext";
