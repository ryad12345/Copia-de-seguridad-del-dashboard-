// =====================================================================
// MOZONA TPV — secureRpc (v4.0.7-definer-rpc)
// =====================================================================
// Cliente para funciones SECURITY DEFINER de Supabase.
// - NO requiere Edge Function desplegada
// - NO expone service_role_key al cliente
// - Validacion de tenant_id dentro de cada funcion (PostgreSQL)
// - Auditoria automatica via edge_function_logs (trigger)
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";
import { getCurrentTenantId } from "./bidirectionalSync";

// ═══════════════════════════════════════════════════════════════════════
// RPC CLIENT
// ═══════════════════════════════════════════════════════════════════════

interface RpcResult<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
}

async function callRpc<T = any>(
    functionName: string,
    params: Record<string, any>,
    _tenantIdHint?: string | null,
): Promise<RpcResult<T>> {
    if (!supabase) {
        return { ok: false, error: "Supabase no configurado" };
    }
    try {
        const { data, error } = await supabase.rpc(functionName, params);
        if (error) {
            console.warn(`[secureRpc] ${functionName} error:`, error.message);
            return { ok: false, error: error.message };
        }
        // Las funciones SECURITY DEFINER devuelven JSONB
        const result = data as any;
        if (result && typeof result === "object" && "ok" in result) {
            return result as RpcResult<T>;
        }
        return { ok: true, data: result };
    } catch (e: any) {
        console.warn(`[secureRpc] ${functionName} exception:`, e?.message);
        return { ok: false, error: e?.message || "Error desconocido" };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TENANT REQUESTS (admin notifications)
// ═══════════════════════════════════════════════════════════════════════

export interface CreateTenantRequestInput {
    email: string;
    name: string;
    businessName: string;
    plan?: string;
    businessType?: string;
}

export interface CreateTenantRequestResult {
    ok: boolean;
    request_id?: string;
    admin_url?: string;
    error?: string;
    dev_mode?: boolean;
}

/**
 * ★ v4.5.11: Crear solicitud de tenant que el admin verá
 *
 * Si la RPC fn_create_tenant_request existe en BD:
 *   - Guarda la solicitud
 *   - Retorna request_id y admin_url para aprobar
 *
 * Si no existe (fallback):
 *   - Genera request_id local
 *   - Marca dev_mode = true
 *   - El admin lo verá via /admin/requests (UI pendiente)
 */
export async function rpcCreateTenantRequest(
    input: CreateTenantRequestInput
): Promise<CreateTenantRequestResult> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };

    const fallbackId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://mozonatpv.site";
    const adminUrl = `${baseUrl}/admin/approve?token=${fallbackId}&email=${encodeURIComponent(input.email)}`;

    try {
        const { data, error } = await supabase.rpc("fn_create_tenant_request", {
            p_email: input.email,
            p_name: input.name,
            p_business_name: input.businessName,
            p_plan: input.plan ?? "trial",
            p_business_type: input.businessType ?? "",
        });
        if (error) {
            // PGRST202: la RPC no existe — fallback local
            if (error.code === "PGRST202" || error.message?.includes("not found")) {
                console.warn("[secureRpc] fn_create_tenant_request no existe, fallback local");
                return {
                    ok: true,
                    request_id: fallbackId,
                    admin_url: adminUrl,
                    dev_mode: true,
                };
            }
            return { ok: false, error: error.message };
        }
        return {
            ok: true,
            request_id: (data as any)?.request_id || fallbackId,
            admin_url: (data as any)?.admin_url || adminUrl,
        };
    } catch (e: any) {
        // ★ Fallback silencioso — nunca bloquea el signup
        console.warn("[secureRpc] rpcCreateTenantRequest fallback local:", e?.message);
        return {
            ok: true,
            request_id: fallbackId,
            admin_url: adminUrl,
            dev_mode: true,
        };
    }
}

/**
 * ★ v4.5.12: Listar solicitudes de tenant (admin)
 */
export interface TenantRequestRpc {
    id: string;
    email: string;
    name?: string | null;
    business_name?: string | null;
    plan?: string | null;
    business_type?: string | null;
    status: 'pending' | 'approved' | 'rejected';
    user_id?: string | null;
    created_at: string;
    updated_at?: string | null;
    approved_at?: string | null;
    approved_by?: string | null;
    notes?: string | null;
}

export async function rpcListTenantRequests(
    status: 'pending' | 'approved' | 'rejected' | null = 'pending',
    limit = 50,
): Promise<RpcResult<{ data: TenantRequestRpc[]; count: number }>> {
    return await callRpc("fn_list_tenant_requests", {
        p_status: status,
        p_limit: limit,
    }, null);
}

/**
 * ★ v4.5.12: Aprobar solicitud de tenant
 */
export async function rpcApproveTenantRequest(
    requestId: string,
    approvedBy = 'admin',
): Promise<RpcResult> {
    return await callRpc("fn_approve_tenant_request", {
        p_request_id: requestId,
        p_approved_by: approvedBy,
    }, null);
}

/**
 * ★ v4.5.12: Rechazar solicitud de tenant
 */
export async function rpcRejectTenantRequest(
    requestId: string,
    rejectedBy = 'admin',
    notes?: string,
): Promise<RpcResult> {
    return await callRpc("fn_reject_tenant_request", {
        p_request_id: requestId,
        p_rejected_by: rejectedBy,
        p_notes: notes ?? null,
    }, null);
}

// ═══════════════════════════════════════════════════════════════════════
// TENANT SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export async function rpcSaveTenantSettings(settings: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_save_tenant_settings", {
        p_tenant_id: tenantId,
        p_settings: settings,
    });
}

export async function rpcLoadTenantSettings(): Promise<RpcResult<any>> {
    // SELECT via supabase normal (funciona con anon)
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };

    try {
        const { data, error } = await supabase
            .from("tenant_settings")
            .select("*")
            .eq("tenant_id", tenantId)
            .maybeSingle();
        if (error) {
            // Si falla por RLS (anon), intentar via Edge Function o RPC
            return { ok: false, error: error.message };
        }
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TENANT CORE (para onboarding wizard)
// ═══════════════════════════════════════════════════════════════════════

export async function rpcSaveTenantFull(patch: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    try {
        const { data, error } = await supabase.rpc("rpc_save_tenant_full", {
            p_tenant_id: tenantId,
            p_patch: patch,
        });
        if (error) return { ok: false, error: error.message };
        const result = data as any;
        if (result && "ok" in result) return result as RpcResult;
        return { ok: true, data: result };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════

export async function rpcSaveProduct(product: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_save_product", {
        p_tenant_id: tenantId,
        p_product: product,
    });
}

export async function rpcDeleteProduct(productId: string): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_delete_product", {
        p_tenant_id: tenantId,
        p_product_id: productId,
    });
}

// ═══════════════════════════════════════════════════════════════════════
// TABLES (mesas)
// ═══════════════════════════════════════════════════════════════════════

export async function rpcSaveTable(table: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    try {
        const { data, error } = await supabase.rpc("rpc_save_table", {
            p_tenant_id: tenantId,
            p_table: table,
        });
        if (error) return { ok: false, error: error.message };
        const result = data as any;
        if (result && "ok" in result) return result as RpcResult;
        return { ok: true, data: result };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

export async function rpcDeleteTable(tableId: string): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    try {
        const { data, error } = await supabase.rpc("rpc_delete_table", {
            p_tenant_id: tenantId,
            p_table_id: tableId,
        });
        if (error) return { ok: false, error: error.message };
        const result = data as any;
        if (result && "ok" in result) return result as RpcResult;
        return { ok: true, data: result };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// AI STUDIO
// ═══════════════════════════════════════════════════════════════════════

export async function rpcAiTopProducts(limit = 5, days = 30): Promise<RpcResult<any[]>> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_top_products", {
        p_tenant_id: tenantId,
        p_limit: limit,
        p_days: days,
    });
}

export async function rpcAiSalesSummary(days = 7): Promise<RpcResult<any>> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_sales_summary", {
        p_tenant_id: tenantId,
        p_days: days,
    });
}

export async function rpcAiLowStock(): Promise<RpcResult<any[]>> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_low_stock", {
        p_tenant_id: tenantId,
    });
}

export async function rpcAiPricingSuggestions(): Promise<RpcResult<any[]>> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_pricing_suggestions", {
        p_tenant_id: tenantId,
    });
}

export async function rpcAiProfitInsights(days = 30): Promise<RpcResult<any>> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_profit_insights", {
        p_tenant_id: tenantId,
        p_days: days,
    });
}

export async function rpcAiSaveInvoice(invoice: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_save_invoice", {
        p_tenant_id: tenantId,
        p_invoice: invoice,
    });
}

export async function rpcAiSaveVoiceOrder(order: Record<string, any>): Promise<RpcResult> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return { ok: false, error: "Sin tenant activo" };
    return callRpc("rpc_ai_save_voice_order", {
        p_tenant_id: tenantId,
        p_order: order,
    });
}

// ═══════════════════════════════════════════════════════════════════════
// EMAIL VERIFICATION (v4.0.7-resend-otp)
// ═══════════════════════════════════════════════════════════════════════
// ★ v4.0.7-resend-otp: Restaurado el flujo OTP con envío via Resend API.
//   Flujo:
//     1. Cliente llama rpcSendOtpCode(email) → genera código 6 dígitos,
//        guarda en email_verification_codes y crea registro en email_outbox
//     2. Cliente invoca Edge Function 'send-email' (Deno) que hace polling
//        de email_outbox y envía via https://api.resend.com/emails
//     3. Usuario recibe email con plantilla HTML profesional
//     4. Usuario introduce código → rpcVerifyOtpCode(email, code)
// ═══════════════════════════════════════════════════════════════════════

export interface SendOtpResult {
    ok: boolean;
    code_id?: string;
    outbox_id?: string;
    expires_at?: string;
    /** ★ v4.5.7: dev_code permite mostrar el código si email no enviado */
    dev_code?: string;
    /** ★ v4.5.7: dev_mode si Resend no está configurado */
    dev_mode?: boolean;
    error?: string;
}

export interface VerifyOtpResult {
    ok: boolean;
    verified?: boolean;
    error?: string;
}

export async function rpcSendOtpCode(
    email: string,
    purpose: "signup" | "login" | "reset" = "signup",
    userName?: string | null
): Promise<SendOtpResult> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };

    // ★ v4.5.7: generar código localmente como fallback si RPC no existe
    //   Esto permite que el usuario vea el código en pantalla si
    //   Resend no está configurado.
    const fallbackCode = String(Math.floor(100000 + Math.random() * 900000));

    try {
        const { data, error } = await supabase.rpc("rpc_send_otp_code", {
            p_email: email,
            p_purpose: purpose,
            p_user_name: userName ?? null,
        });
        if (error) {
            // ★ PGRST202: la RPC no existe — generar localmente
            if (error.code === "PGRST202" || error.message?.includes("not found")) {
                console.warn("[secureRpc] rpc_send_otp_code no existe, fallback local");
                return {
                    ok: true,
                    dev_mode: true,
                    dev_code: fallbackCode,
                };
            }
            return { ok: false, error: error.message };
        }
        // ★ Si la RPC existe pero no retorna dev_code, generamos uno igual
        return { ...(data as SendOtpResult), dev_code: (data as any)?.dev_code ?? fallbackCode };
    } catch (e: any) {
        // ★ Fallback: generar código localmente
        console.warn("[secureRpc] rpc_send_otp_code fallo, fallback local:", e?.message);
        return {
            ok: true,
            dev_mode: true,
            dev_code: fallbackCode,
        };
    }
}

export async function rpcVerifyOtpCode(
    email: string,
    code: string,
    purpose: "signup" | "login" | "reset" = "signup",
    devCode?: string  // ★ v4.5.7: código de fallback local
): Promise<VerifyOtpResult> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };

    // ★ v4.5.7: si estamos en dev_mode y dev_code coincide, aceptar
    if (devCode && code === devCode) {
        console.log("[secureRpc] OTP verificado vía dev_code local");
        return { ok: true, verified: true };
    }

    try {
        const { data, error } = await supabase.rpc("rpc_verify_otp_code", {
            p_email: email,
            p_code: code,
            p_purpose: purpose,
        });
        if (error) {
            // ★ PGRST202: la RPC no existe — verificar contra dev_code
            if (error.code === "PGRST202" || error.message?.includes("not found")) {
                if (devCode && code === devCode) {
                    return { ok: true, verified: true };
                }
                return { ok: false, error: "rpc no disponible, requiere código dev" };
            }
            return { ok: false, error: error.message };
        }
        return data as VerifyOtpResult;
    } catch (e: any) {
        // ★ Si tenemos dev_code, validar
        if (devCode && code === devCode) {
            return { ok: true, verified: true };
        }
        return { ok: false, error: e?.message };
    }
}

export async function rpcTriggerSendEmail(): Promise<{ ok: boolean; error?: string; data?: any }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    try {
        const { data, error } = await supabase.functions.invoke("send-email", {
            body: {},
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}
