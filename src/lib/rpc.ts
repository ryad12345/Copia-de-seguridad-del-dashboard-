// =====================================================================
// MOZONA TPV — rpc.ts v4.4.0 (PATRÓN ZERO-BLOCK)
// =====================================================================
// Wrappers tipados para invocar las funciones SECURITY DEFINER.
// Todas pasan por supabase.rpc() — no más supabase.from(...).insert()
// para transacciones críticas.
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import { getUserJwt } from "./auth-helpers";

export interface RpcResult<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
    code?: string;
    [key: string]: any;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: any): s is string {
    return typeof s === "string" && UUID_REGEX.test(s);
}

/**
 * Helper genérico para llamar RPC con manejo de errores unificado.
 * v4.5.1: auto-fallback a implementación directa si RPC no existe.
 *         Valida UUID antes de enviar (evita 22P02).
 */
async function callRpc<T = any>(
    functionName: string,
    params: Record<string, any>,
    tenantIdHint?: string | null,
): Promise<RpcResult<T>> {
    try {
        // Resolver tenant_id si no viene
        if (!params.p_tenant_id && tenantIdHint) {
            params.p_tenant_id = tenantIdHint;
        }
        if (!params.p_tenant_id) {
            params.p_tenant_id = await resolveRealTenantId(null);
        }

        // ★ v4.5.1: VALIDAR UUID — evita 22P02 invalid input syntax
        // Si p_tenant_id no es UUID válido, retornar error claro
        if (params.p_tenant_id != null && !isValidUuid(params.p_tenant_id)) {
            console.warn(`[rpc:${functionName}] p_tenant_id NO es UUID valido:`, params.p_tenant_id);
            return {
                ok: false,
                error: `tenant_id invalido (no es UUID): ${typeof params.p_tenant_id === 'object' ? JSON.stringify(params.p_tenant_id).slice(0, 80) : String(params.p_tenant_id).slice(0, 80)}`,
                code: "INVALID_UUID",
            };
        }

        // ★ v4.4.3: safety-net global — eliminar created_at UUID-ify
        const { sanitizePayload } = await import("./payload-sanitizer");
        params = sanitizePayload(params);

        // Llamar RPC
        const { data, error } = await supabase.rpc(functionName, params);

        if (error) {
            // ★ v4.5.1: PGRST202 (function not found) — fallback silencioso
            // a la implementación directa via supabase.from()
            if (error.code === "PGRST202" || error.code === "404") {
                console.warn(`[rpc:${functionName}] RPC no existe (PGRST202), se requiere fallback legacy`);
                return {
                    ok: false,
                    error: `RPC ${functionName} no existe en BD`,
                    code: "RPC_NOT_FOUND",
                    _fallback: true,
                } as any;
            }
            // ★ v4.5.1: 22P02 (invalid UUID) — caller error, no retry
            if (error.code === "22P02") {
                console.warn(`[rpc:${functionName}] UUID invalido:`, error.message);
                return {
                    ok: false,
                    error: error.message,
                    code: "INVALID_UUID",
                };
            }
            console.error(`[rpc:${functionName}] supabase error:`, error);
            return {
                ok: false,
                error: error.message,
                code: error.code,
            };
        }

        // La función retorna JSONB — data es el objeto parseado
        let parsed: any = data;
        if (typeof parsed === "string") {
            try { parsed = JSON.parse(parsed); } catch {}
        }

        if (parsed && typeof parsed === "object" && "ok" in parsed) {
            return parsed as RpcResult<T>;
        }

        // Fallback: si retorna algo no estándar
        return { ok: true, data: parsed as T };
    } catch (e: any) {
        console.error(`[rpc:${functionName}] exception:`, e?.message);
        return { ok: false, error: e?.message ?? "RPC failed" };
    }
}

// =====================================================================
// 1. CHECKOUT ATÓMICO
// =====================================================================
export interface CheckoutItemRpc {
    product_id?: string | null;
    name: string;
    quantity: number;
    unit_price: number;
    tax_rate?: number;
    notes?: string | null;
}

export async function rpcAtomicCheckout(input: {
    tenantId?:       string | null;
    tableId?:        string | null;
    tableNumber?:    string | number | null;
    items:           CheckoutItemRpc[];
    subtotal:        number;
    taxTotal:        number;
    total:           number;
    paymentMethod?:  string;
    waiterName?:     string | null;
    series?:         string;
    invoiceNumber?:  number;
}): Promise<RpcResult<{ order_id: string; items_count: number }>> {
    const items = (input.items || []).map(it => ({
        product_id: it.product_id ?? null,
        name: String(it.name || "Item").slice(0, 200),
        quantity: Number(it.quantity ?? 1),
        unit_price: Number(it.unit_price ?? 0),
        tax_rate: Number(it.tax_rate ?? 10),
        notes: it.notes ?? null,
    }));

    const res = await callRpc("fn_atomic_checkout", {
        p_tenant_id:      input.tenantId,
        p_table_id:       input.tableId ?? null,
        p_table_number:   input.tableNumber != null ? String(input.tableNumber) : null,
        p_items:          items,
        p_subtotal:       input.subtotal,
        p_tax_total:      input.taxTotal,
        p_total:          input.total,
        p_payment_method: input.paymentMethod ?? "cash",
        p_waiter_name:    input.waiterName ?? "Caja",
        p_series:         input.series ?? "T-F",
        p_invoice_number: input.invoiceNumber ?? null,
    }, input.tenantId);

    // ★ v4.5.1: Si RPC falla por NOT_FOUND o por error de esquema
    // (cliente no ha aplicado SQL #65 v4.4.9), ejecutar fallback
    // directo via supabase.from() con sintaxis simple.
    if (!res.ok && (res as any)._fallback) {
        return await checkoutLegacy(input, items);
    }
    return res;
}

/**
 * Fallback legacy para checkout cuando RPC no existe.
 * Inserta order + items + libera mesa con supabase.from directo.
 */
async function checkoutLegacy(
    input: any,
    items: any[],
): Promise<RpcResult<{ order_id: string; items_count: number }>> {
    try {
        const { sanitizePayload } = await import("./payload-sanitizer");
        const tenantId = input.tenantId;
        if (!tenantId || !UUID_REGEX.test(tenantId)) {
            return { ok: false, error: "tenant_id invalido para fallback" };
        }

        // 1) INSERT order — sin created_at, sin updated_at (BD usa DEFAULT)
        const { data: order, error: orderErr } = await supabase
            .from("orders")
            .insert(sanitizePayload({
                tenant_id:     tenantId,
                waiter_name:   input.waiterName ?? "Caja",
                status:        "closed",
                subtotal:      input.subtotal,
                tax_total:     input.taxTotal,
                total:         input.total,
                payment_method: input.paymentMethod ?? "cash",
            }))
            .select()
            .single();

        if (orderErr || !order) {
            return { ok: false, error: orderErr?.message || "order insert fail", code: orderErr?.code };
        }

        // 2) INSERT order_items — sin created_at
        if (items.length > 0) {
            const rows = items.map(it => sanitizePayload({
                tenant_id:  tenantId,
                order_id:   order.id,
                product_id: it.product_id || null,
                name:       it.name,
                quantity:   it.quantity,
                unit_price: it.unit_price,
                subtotal:   (it.quantity * it.unit_price),
                tax_rate:   it.tax_rate ?? 10,
                notes:      it.notes || null,
            }));
            const { error: itemsErr } = await supabase
                .from("order_items")
                .insert(rows);
            if (itemsErr) {
                console.warn("[checkoutLegacy] items insert warn:", itemsErr.message);
            }
        }

        // 3) DELETE open_orders (si había)
        const tableNumber = input.tableNumber != null ? String(input.tableNumber) : null;
        const tableId = input.tableId;
        if (tableNumber || tableId) {
            await supabase.from("open_orders").delete().eq("tenant_id", tenantId)
                .or(`table_number.eq.${tableNumber ?? '_'},table_id.eq.${tableId ?? '_'}`);
            // free dining_tables
            await supabase.from("dining_tables")
                .update({ status: "free", current_order_id: null })
                .eq("tenant_id", tenantId);
        }

        return {
            ok: true,
            data: { order_id: order.id, items_count: items.length },
        };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? "checkout legacy fail" };
    }
}

// =====================================================================
// 2. UPSERT DRAFT (open_orders)
// =====================================================================
export async function rpcUpsertDraft(input: {
    tenantId:    string | null;
    tableId:     string;
    tableNumber: string | number;
    items:       any[];
    notes?:      string | null;
    waiterName?: string | null;
}): Promise<RpcResult> {
    const res = await callRpc("fn_upsert_draft", {
        p_tenant_id:    input.tenantId,
        p_table_id:     input.tableId,
        p_table_number: String(input.tableNumber),
        p_items:        input.items || [],
        p_notes:        input.notes ?? null,
        p_waiter_name:  input.waiterName ?? null,
    }, input.tenantId);

    if (!res.ok && (res as any)._fallback) {
        return await upsertDraftLegacy(input);
    }
    return res;
}

async function upsertDraftLegacy(input: any): Promise<RpcResult> {
    try {
        const { sanitizePayload } = await import("./payload-sanitizer");
        const tenantId = input.tenantId;
        if (!tenantId || !UUID_REGEX.test(tenantId)) {
            return { ok: false, error: "tenant_id invalido" };
        }
        const payload = sanitizePayload({
            tenant_id:    tenantId,
            table_id:     input.tableId,
            table_number: String(input.tableNumber ?? ""),
            items:        input.items || [],
            notes:        input.notes ?? null,
            waiter_name:  input.waiterName ?? null,
            status:       "draft",
        });
        // upsert by (tenant_id, table_number)
        const { data, error } = await supabase
            .from("open_orders")
            .upsert(payload, { onConflict: "tenant_id,table_number" })
            .select();
        if (error) {
            return { ok: false, error: error.message, code: error.code };
        }
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// 3. CLEAR DRAFT
// =====================================================================
export async function rpcClearDraft(
    tenantId: string | null,
    tableIdOrNumber: string,
): Promise<RpcResult<{ deleted: number }>> {
    return await callRpc("fn_clear_draft", {
        p_tenant_id: tenantId,
        p_table_id_or_number: tableIdOrNumber,
    }, tenantId);
}

// =====================================================================
// 4. UPDATE TABLE STATUS
// =====================================================================
export async function rpcUpdateTableStatus(input: {
    tenantId:        string | null;
    tableId:         string;
    tableNumber?:    string | number;
    status:          string;
    currentOrderId?: string | null;
}): Promise<RpcResult> {
    const res = await callRpc("fn_update_table_status", {
        p_tenant_id:        input.tenantId,
        p_table_id:         input.tableId,
        p_table_number:     input.tableNumber != null ? String(input.tableNumber) : null,
        p_status:           input.status,
        p_current_order_id: input.currentOrderId ?? null,
    }, input.tenantId);

    if (!res.ok && ((res as any)._fallback || (res.code === "42804") || (res.code === "42P10"))) {
        return await updateTableStatusLegacy(input);
    }
    return res;
}

/**
 * Fallback legacy para update_table_status.
 * Funciona con CUALQUIER esquema de dining_tables:
 * - con o sin current_order_id
 * - con o sin updated_at
 * - table_number INTEGER o TEXT
 */
async function updateTableStatusLegacy(input: any): Promise<RpcResult> {
    try {
        const tenantId = input.tenantId;
        if (!tenantId || !UUID_REGEX.test(tenantId)) {
            return { ok: false, error: "tenant_id invalido" };
        }

        const status = String(input.status || "free").toLowerCase();
        const currentOrderId = input.currentOrderId || null;

        // Detectar columnas existentes
        const { data: probe } = await supabase
            .from("dining_tables").select("table_number").limit(1).maybeSingle();
        const tnValue: any = input.tableNumber != null ? String(input.tableNumber) : null;

        const payload: Record<string, any> = { status };

        // ★ Solo añadir current_order_id si la columna existe Y tenemos valor
        // (verificamos via information_schema via una heuristica: intentar y fallback)
        if (currentOrderId) {
            payload.current_order_id = currentOrderId;
        } else {
            payload.current_order_id = null;
        }

        let q = supabase.from("dining_tables").update(payload).eq("tenant_id", tenantId);

        if (input.tableId) {
            if (UUID_REGEX.test(input.tableId)) {
                q = q.eq("id", input.tableId);
            } else {
                // legacy: 'local-table-8'
                const cleaned = String(input.tableId).replace("local-table-", "");
                q = q.or(`table_number.eq.${cleaned},table_number.eq.${input.tableId},table_id.eq.${input.tableId}`);
            }
        } else if (tnValue) {
            q = q.eq("table_number", tnValue);
        }

        const { data, error } = await q.select();
        if (error) {
            // ★ Si falla por columna inexistente (current_order_id), retry sin esa columna
            if (error.code === "PGRST204" || error.message.includes("does not exist")) {
                const minimalPayload = { status };
                const { data: d2, error: e2 } = await supabase
                    .from("dining_tables")
                    .update(minimalPayload)
                    .eq("tenant_id", tenantId);
                if (e2) return { ok: false, error: e2.message };
                return { ok: true, data: d2 };
            }
            return { ok: false, error: error.message, code: error.code };
        }
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// 5. CANCEL SALE
// =====================================================================
export async function rpcCancelSale(
    tenantId: string | null,
    orderId: string,
): Promise<RpcResult<{ deleted_items: number }>> {
    const res = await callRpc("fn_cancel_sale", {
        p_tenant_id: tenantId,
        p_order_id:  orderId,
    }, tenantId);

    if (!res.ok && (res as any)._fallback) {
        return await cancelSaleLegacy(tenantId, orderId);
    }
    return res;
}

async function cancelSaleLegacy(
    tenantId: string | null,
    orderId: string,
): Promise<RpcResult<{ deleted_items: number }>> {
    try {
        if (!tenantId || !UUID_REGEX.test(tenantId) || !UUID_REGEX.test(orderId)) {
            return { ok: false, error: "tenant_id u order_id invalido" };
        }
        await supabase.from("order_items").delete()
            .eq("tenant_id", tenantId).eq("order_id", orderId);
        const { error } = await supabase.from("orders").delete()
            .eq("tenant_id", tenantId).eq("id", orderId);
        if (error) return { ok: false, error: error.message };
        await supabase.from("open_orders").delete()
            .eq("tenant_id", tenantId).eq("order_id", orderId);
        return { ok: true, data: { deleted_items: 0 } };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// 6. SAVE PRODUCT
// =====================================================================
export async function rpcSaveProduct(input: {
    tenantId:     string | null;
    id?:          string | null;
    name:         string;
    price:        number;
    category?:    string;
    categoryId?:  string | null;
    imageUrl?:    string | null;
    description?: string | null;
    taxRate?:     number;
    isActive?:    boolean;
}): Promise<RpcResult<{ id: string }>> {
    return await callRpc("fn_save_product", {
        p_tenant_id:   input.tenantId,
        p_id:          input.id ?? null,
        p_name:        input.name,
        p_price:       input.price,
        p_category:    input.category ?? "Otros",
        p_category_id: input.categoryId ?? null,
        p_image_url:   input.imageUrl ?? null,
        p_description: input.description ?? null,
        p_tax_rate:    input.taxRate ?? 10,
        p_is_active:   input.isActive ?? true,
    }, input.tenantId);
}

// =====================================================================
// 7. DELETE PRODUCT
// =====================================================================
export async function rpcDeleteProduct(
    tenantId: string | null,
    id: string,
): Promise<RpcResult<{ deleted: number }>> {
    return await callRpc("fn_delete_product", {
        p_tenant_id: tenantId,
        p_id:        id,
    }, tenantId);
}

// =====================================================================
// 8. SAVE TENANT SETTINGS
// =====================================================================
export interface TenantSettingsRpc {
    theme_mode?:         string;
    theme_accent?:       string;
    theme_contrast?:     string;
    button_size?:        string;
    grid_density?:       string;
    panel_layout?:       string;
    show_product_images?: boolean;
    header_text?:        string | null;
    footer_text?:        string | null;
    show_vat_breakdown?: boolean;
    ticket_paper_width?: number;
    ticket_layout_json?: any;
}

export async function rpcSaveTenantSettings(
    tenantId: string | null,
    s: TenantSettingsRpc,
): Promise<RpcResult> {
    return await callRpc("fn_save_tenant_settings", {
        p_tenant_id:           tenantId,
        p_header_text:         s.header_text ?? null,
        p_footer_text:         s.footer_text ?? null,
        p_show_vat_breakdown:  s.show_vat_breakdown ?? true,
        p_ticket_paper_width:  s.ticket_paper_width ?? 58,
        p_ticket_layout_json:  s.ticket_layout_json ?? null,
        p_theme_mode:          s.theme_mode ?? "system",
        p_theme_accent:        s.theme_accent ?? "blue",
        p_theme_contrast:      s.theme_contrast ?? "normal",
        p_button_size:         s.button_size ?? "md",
        p_grid_density:        s.grid_density ?? "normal",
        p_panel_layout:        s.panel_layout ?? "horizontal",
        p_show_product_images: s.show_product_images ?? true,
    }, tenantId);
}

// =====================================================================
// 9. SAVE COMPANY (PATCH tenants)
// =====================================================================
export async function rpcSaveCompany(input: {
    tenantId:           string | null;
    businessName?:      string;
    cifNif?:            string;
    address?:           string;
    phone?:             string;
    contactEmail?:      string;
    ticketHeaderMsg?:   string;
    ticketFooterMsg?:   string;
    ticketShowTax?:     boolean;
    ticketPaperWidth?:  number;
    defaultSeries?:     string;
    businessType?:      "retail" | "hospitality";
    featuresConfig?:    any;
}): Promise<RpcResult> {
    return await callRpc("fn_save_company", {
        p_tenant_id:          input.tenantId,
        p_business_name:      input.businessName,
        p_cif_nif:            input.cifNif,
        p_address:            input.address,
        p_phone:              input.phone,
        p_contact_email:      input.contactEmail,
        p_ticket_header_msg:  input.ticketHeaderMsg,
        p_ticket_footer_msg:  input.ticketFooterMsg,
        p_ticket_show_tax:    input.ticketShowTax,
        p_ticket_paper_width: input.ticketPaperWidth,
        p_default_series:     input.defaultSeries,
        p_business_type:      input.businessType,
        p_features_config:    input.featuresConfig,
    }, input.tenantId);
}

// =====================================================================
// 10. GET CATEGORIES
// =====================================================================
export interface CategoryRpc {
    id: string;
    tenant_id: string;
    name: string;
    sort_order: number;
    image_url?: string | null;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
    metadata?: any;
}

export async function rpcGetCategories(
    tenantId: string | null,
    onlyActive: boolean = true,
): Promise<RpcResult<{ data: CategoryRpc[]; count: number }>> {
    return await callRpc("fn_get_tenant_categories", {
        p_tenant_id: tenantId,
        p_only_active: onlyActive,
    }, tenantId);
}

// =====================================================================
// 11. SAVE CATEGORY
// =====================================================================
export async function rpcSaveCategory(input: {
    tenantId:    string | null;
    id?:         string | null;
    name:        string;
    sortOrder?:  number;
    imageUrl?:   string | null;
    isActive?:   boolean;
}): Promise<RpcResult<{ id: string }>> {
    return await callRpc("fn_save_category", {
        p_tenant_id:  input.tenantId,
        p_id:         input.id ?? null,
        p_name:       input.name,
        p_sort_order: input.sortOrder ?? 0,
        p_image_url:  input.imageUrl ?? null,
        p_is_active:  input.isActive ?? true,
    }, input.tenantId);
}

// =====================================================================
// 12. DELETE CATEGORY
// =====================================================================
export async function rpcDeleteCategory(
    tenantId: string | null,
    id: string,
): Promise<RpcResult<{ deleted: number }>> {
    return await callRpc("fn_delete_category", {
        p_tenant_id: tenantId,
        p_id:        id,
    }, tenantId);
}

// =====================================================================
// 13. GET COMPANY FULL (v4.5.0 — fuente unica para tickets)
// =====================================================================
export interface CompanyRpc {
    tenant_id:         string;
    business_name:     string;
    cif_nif:           string;
    address:           string;
    phone:             string;
    contact_email:     string;
    ticket_header_msg: string;
    ticket_footer_msg: string;
    ticket_show_tax:   boolean;
    paper_width_mm:    number;
    logo_url:          string;
    updated_at:        string;
}

export async function rpcGetCompanyFull(
    tenantId: string | null,
): Promise<RpcResult<CompanyRpc>> {
    if (!tenantId || !UUID_REGEX.test(tenantId)) {
        return { ok: false, error: "tenant_id invalido" };
    }
    const res = await callRpc("fn_get_company_full", {
        p_tenant_id: tenantId,
    }, tenantId);
    if (!res.ok && (res as any)._fallback) {
        return await getCompanyFullLegacy(tenantId);
    }
    return res;
}

async function getCompanyFullLegacy(tenantId: string): Promise<RpcResult<CompanyRpc>> {
    try {
        // ★ v4.5.5: usar select=* seguro (puede fallar con PGRST204 si columna no existe)
        // Hacer fallback con columnas individuales si falla
        let tenant: any = null;
        let tenantErr: any = null;

        // Intento 1: select=* (puede fallar por RLS)
        try {
            const r = await supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle();
            tenant = r.data;
            tenantErr = r.error;
        } catch (e) {
            tenantErr = e;
        }

        // Si select=* falla, intentar columnas específicas que seguramente existen
        if (tenantErr || !tenant) {
            try {
                const r = await supabase.from("tenants")
                    .select("id, business_name, cif_nif, address, phone, contact_email, logo_url")
                    .eq("id", tenantId)
                    .maybeSingle();
                tenant = r.data;
                tenantErr = r.error;
            } catch (e) {
                tenantErr = e;
            }
        }

        if (tenantErr || !tenant) {
            return { ok: false, error: tenantErr?.message || "tenant no encontrado" };
        }

        // 2) Get tenant_settings (puede no existir)
        let settings: any = null;
        try {
            const r = await supabase.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
            settings = r.data;
        } catch (e) {
            settings = null;
        }

        const company: CompanyRpc = {
            tenant_id: tenantId,
            business_name: tenant.business_name || "",
            cif_nif: tenant.cif_nif || "",
            address: tenant.address || "",
            phone: tenant.phone || "",
            contact_email: tenant.contact_email || "",
            // ★ v4.5.5: leer ticket_* de AMBAS tablas
            ticket_header_msg: tenant.ticket_header_msg || settings?.ticket_header_msg || "",
            ticket_footer_msg: tenant.ticket_footer_msg || settings?.ticket_footer_msg || "",
            ticket_show_tax: tenant.ticket_show_tax ?? settings?.ticket_show_tax ?? true,
            paper_width_mm: settings?.paper_width_mm ?? 80,
            logo_url: tenant.logo_url || "",
            updated_at: settings?.updated_at || tenant.updated_at || new Date().toISOString(),
        };
        return { ok: true, data: company };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// 14. SAVE COMPANY FULL
// =====================================================================
export async function rpcSaveCompanyFull(input: {
    tenantId:         string | null;
    businessName?:    string;
    cifNif?:          string;
    address?:         string;
    phone?:           string;
    contactEmail?:    string;
    ticketHeaderMsg?: string;
    ticketFooterMsg?: string;
    ticketShowTax?:   boolean;
    paperWidthMm?:    number;
    logoUrl?:         string;
}): Promise<RpcResult<CompanyRpc>> {
    if (!input.tenantId || !UUID_REGEX.test(input.tenantId)) {
        return { ok: false, error: "tenant_id invalido" };
    }
    const res = await callRpc("fn_save_company_full", {
        p_tenant_id:        input.tenantId,
        p_business_name:    input.businessName ?? null,
        p_cif_nif:          input.cifNif ?? null,
        p_address:          input.address ?? null,
        p_phone:            input.phone ?? null,
        p_contact_email:    input.contactEmail ?? null,
        p_ticket_header_msg: input.ticketHeaderMsg ?? null,
        p_ticket_footer_msg: input.ticketFooterMsg ?? null,
        p_ticket_show_tax:  input.ticketShowTax ?? null,
        p_paper_width_mm:   input.paperWidthMm ?? null,
        p_logo_url:         input.logoUrl ?? null,
    }, input.tenantId);

    if (!res.ok && (res as any)._fallback) {
        return await saveCompanyFullLegacy(input);
    }
    return res;
}

async function saveCompanyFullLegacy(input: any): Promise<RpcResult<CompanyRpc>> {
    try {
        const tenantId = input.tenantId;
        // 1) UPDATE tenants
        const tPayload: Record<string, any> = {};
        if (input.businessName != null) tPayload.business_name = input.businessName;
        if (input.cifNif != null) tPayload.cif_nif = input.cifNif;
        if (input.address != null) tPayload.address = input.address;
        if (input.phone != null) tPayload.phone = input.phone;
        if (input.contactEmail != null) tPayload.contact_email = input.contactEmail;
        if (input.logoUrl != null) tPayload.logo_url = input.logoUrl;
        if (Object.keys(tPayload).length > 0) {
            const { error: tErr } = await supabase.from("tenants")
                .update(tPayload).eq("id", tenantId);
            if (tErr) {
                return { ok: false, error: tErr.message };
            }
        }
        // 2) UPSERT tenant_settings
        const sPayload: Record<string, any> = { tenant_id: tenantId };
        if (input.paperWidthMm != null) sPayload.paper_width_mm = input.paperWidthMm;
        if (input.ticketShowTax != null) sPayload.ticket_show_tax = input.ticketShowTax;
        if (Object.keys(sPayload).length > 1) {
            await supabase.from("tenant_settings").upsert(sPayload, { onConflict: "tenant_id" });
        }
        // 3) Re-fetch
        return await getCompanyFullLegacy(tenantId);
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// 15. GET TENANT DASHBOARD (bootstrap 1 sola RPC)
// =====================================================================
export interface TenantDashboardData {
    company:     CompanyRpc;
    products:    any[];
    categories:  any[];
    tables:      any[];
    open_orders: any[];
    drafts:      any[];
}

export async function rpcGetTenantDashboard(
    tenantId: string | null,
): Promise<RpcResult<TenantDashboardData>> {
    return await callRpc("fn_get_tenant_dashboard", {
        p_tenant_id: tenantId,
    }, tenantId);
}

// =====================================================================
// Exports para debug
// =====================================================================
if (typeof window !== "undefined") {
    try {
        (window as any).__rpc = {
            rpcAtomicCheckout,
            rpcUpsertDraft,
            rpcClearDraft,
            rpcUpdateTableStatus,
            rpcCancelSale,
            rpcSaveProduct,
            rpcDeleteProduct,
            rpcSaveTenantSettings,
            rpcSaveCompany,
            rpcGetCategories,
            rpcSaveCategory,
            rpcDeleteCategory,
            rpcGetCompanyFull,
            rpcSaveCompanyFull,
            rpcGetTenantDashboard,
        };
    } catch {}
}
