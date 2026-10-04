// =====================================================================
// MOZONA TPV — tenantResolver: resolución universal de tenant_id
// =====================================================================
// Estrategia unificada para que Admin, Caja, Camarero y Comandero
// resuelvan EL MISMO tenant_id. Sin islas de datos.
// =====================================================================

import { supabase } from "./supabase";

/** UUID zero como fallback final (BD vacía) */
export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Identifica el tenant activo. NUNCA devuelve null. */
export async function getActiveTenantId(): Promise<string> {
    if (!supabase) return ZERO_UUID;

    // 1) Sesión activa: tenant del usuario autenticado
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: tu } = await supabase
                .from("tenant_users")
                .select("tenant_id")
                .eq("user_id", user.id)
                .maybeSingle();
            if (tu?.tenant_id) return tu.tenant_id;
        }
    } catch (e) {
        console.warn("[getActiveTenantId] tenant_users error:", e);
    }

    // 2) RPC seguro (SECURITY DEFINER, bypasa RLS)
    try {
        const { data } = await supabase.rpc("get_first_active_tenant");
        if (data) return data as string;
    } catch (e) {
        console.warn("[getActiveTenantId] RPC error:", e);
    }

    // 3) Primer tenant activo
    try {
        const { data } = await supabase
            .from("tenants")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
        if (data?.id) return data.id;
    } catch (e) {
        console.warn("[getActiveTenantId] tenants error:", e);
    }

    // 4) Tenant que tenga productos
    try {
        const { data } = await supabase
            .from("products")
            .select("tenant_id")
            .not("tenant_id", "is", null)
            .limit(1)
            .maybeSingle();
        if (data?.tenant_id) return data.tenant_id;
    } catch (e) {
        console.warn("[getActiveTenantId] products error:", e);
    }

    // 5) Último recurso
    console.warn("[getActiveTenantId] ⚠️ no se encontró tenant, usando zero UUID");
    return ZERO_UUID;
}

/** Convierte un table_id cualquiera (UUID, 'local-table-N') a número limpio */
export function cleanTableNumber(raw: string | number | null | undefined): string {
    if (raw == null) return "0";
    const s = String(raw);
    const m = s.match(/(\d+)/);
    return m ? m[1] : "0";
}
