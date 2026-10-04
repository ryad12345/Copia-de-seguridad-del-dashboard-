// =====================================================================
// MOZONA TPV — ticketSettings.ts v4.5.0 (RPC MASTER)
// =====================================================================
// Fuente ÚNICA de verdad: BD vía RPCs SECURITY DEFINER.
// No más supabase.from('tenants').patch() directo.
// No más localStorage como cache de empresa (solo fallback offline).
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import { rpcGetCompanyFull, rpcSaveCompanyFull } from "./rpc";
import type { CompanyRpc } from "./rpc";

export interface CompanyInfo extends Partial<CompanyRpc> {
    tenant_id?: string;
    business_name: string;
    cif_nif?: string;
    address?: string;
    phone?: string;
    contact_email?: string;
    ticket_header_msg?: string;
    ticket_footer_msg?: string;
    ticket_show_tax?: boolean;
    paper_width_mm?: number;
    logo_url?: string;
}

const LS_KEY = "mozona.empresa";

const DEFAULT_COMPANY: CompanyInfo = {
    business_name: "",
    cif_nif: "",
    address: "",
    phone: "",
    contact_email: "",
    ticket_header_msg: "",
    ticket_footer_msg: "",
    ticket_show_tax: true,
    paper_width_mm: 80,
    logo_url: "",
};

const UUID_REGEX_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidLike(s: any): s is string {
    return typeof s === "string" && UUID_REGEX_LOCAL.test(s);
}

/**
 * Lee empresa+ticket del tenant via RPC SECURITY DEFINER.
 * Si falla la BD, usa cache LS como fallback.
 * Si LS vacío, usa DEFAULT_COMPANY.
 */
export async function loadCompany(tenantId: string | null | undefined): Promise<CompanyInfo> {
    const realId = await resolveRealTenantId(tenantId ?? null);

    // ★ v4.5.4: NO llamar RPC si tenantId no es UUID válido.
    // Evita log ruidoso "tenant_id invalido" y evita intentos inútiles.
    if (!isUuidLike(realId)) {
        return readFromLocal() || DEFAULT_COMPANY;
    }

    try {
        const res = await rpcGetCompanyFull(realId);
        if (res?.ok && res.data) {
            const c = res.data;
            const mapped: CompanyInfo = {
                tenant_id:         c.tenant_id || realId,
                business_name:     c.business_name || "",
                cif_nif:           c.cif_nif || "",
                address:           c.address || "",
                phone:             c.phone || "",
                contact_email:     c.contact_email || "",
                ticket_header_msg: c.ticket_header_msg || "",
                ticket_footer_msg: c.ticket_footer_msg || "",
                ticket_show_tax:   c.ticket_show_tax !== false,
                paper_width_mm:    c.paper_width_mm || 80,
                logo_url:          c.logo_url || "",
            };
            writeLocal(mapped);
            return mapped;
        }
        // RPC devolvió ok:false → fallback LS silencioso
    } catch (e: any) {
        // Silencioso: usar LS
    }
    return readFromLocal() || DEFAULT_COMPANY;
}

/**
 * Guarda empresa+ticket via RPC SECURITY DEFINER.
 * UPSERT atómico: actualiza tenants + tenant_settings en BD.
 * Fallback a LS si BD falla.
 *
 * Retorna {ok, source, error, status, data}:
 *   source: "db" si guardó en BD
 *   source: "local" si fallback a localStorage
 */
export async function saveCompany(input: CompanyInfo): Promise<{
    ok: boolean;
    source?: "db" | "local";
    error?: string;
    status?: number;
    data?: CompanyRpc | null;
}> {
    const realId = await resolveRealTenantId(input.tenant_id ?? null);

    // ★ v4.5.5: si no hay UUID válido, fallback offline silencioso
    if (!isUuidLike(realId)) {
        writeLocal(input);
        return { ok: true, source: "local" };
    }

    try {
        const res = await rpcSaveCompanyFull({
            tenantId:         realId,
            businessName:     input.business_name ?? "",
            cifNif:           input.cif_nif ?? "",
            address:          input.address ?? "",
            phone:            input.phone ?? "",
            contactEmail:     input.contact_email ?? "",
            ticketHeaderMsg:  input.ticket_header_msg ?? "",
            ticketFooterMsg:  input.ticket_footer_msg ?? "",
            ticketShowTax:    input.ticket_show_tax !== false,
            paperWidthMm:     input.paper_width_mm ?? 80,
            logoUrl:          input.logo_url ?? "",
        });

        if (res?.ok && res.data) {
            // Persistió en BD
            writeLocal({
                tenant_id:         res.data.tenant_id,
                business_name:     res.data.business_name,
                cif_nif:           res.data.cif_nif,
                address:           res.data.address,
                phone:             res.data.phone,
                contact_email:     res.data.contact_email,
                ticket_header_msg: res.data.ticket_header_msg,
                ticket_footer_msg: res.data.ticket_footer_msg,
                ticket_show_tax:   res.data.ticket_show_tax,
                paper_width_mm:    res.data.paper_width_mm,
                logo_url:          res.data.logo_url,
            });
            return { ok: true, source: "db", data: res.data };
        }

        // RPC falló: fallback a LS
        writeLocal(input);
        return { ok: false, source: "local", error: res?.error || "rpc fail", status: 500 };
    } catch (e: any) {
        writeLocal(input);
        return { ok: false, source: "local", error: e?.message };
    }
}

// ★ Compatibilidad: SettingsPage importa saveTicketSettings
export async function saveTicketSettings(input: TicketSettings): Promise<{
    ok: boolean;
    source?: "db" | "local";
    error?: string;
    status?: number;
}> {
    const res = await saveCompany(input as CompanyInfo);
    return { ok: res.ok, source: res.source, error: res.error, status: res.status };
}

function readFromLocal(): CompanyInfo | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return null;
}

function writeLocal(input: CompanyInfo) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(input));
    } catch {}
}

/**
 * Lee empresa de LS para uso offline / print ticket sin BD.
 */
export function readCompanyFromLocalStorage(): CompanyInfo | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (p && (p.business_name || p.name)) return p;
        }
        const OTHER_KEYS = ["mozona.company", "company", "pos_company"];
        for (const k of OTHER_KEYS) {
            const r = localStorage.getItem(k);
            if (r) {
                const p = JSON.parse(r);
                if (p && (p.business_name || p.name)) return p;
            }
        }
    } catch {}
    return null;
}

// ★ v4.2.3: Compatibilidad — ticketPrinter.ts usa esto
export interface TicketSettings {
    tenant_id?: string;
    business_name?: string;
    cif_nif?: string;
    address?: string;
    phone?: string;
    contact_email?: string;
    ticket_header_msg?: string;
    ticket_footer_msg?: string;
    ticket_show_tax?: boolean;
    ticket_width_mm?: number;
    // ★ v4.6.0: alias de compatibilidad usados por ticketPrinter.ts y
    //   SettingsPage.tsx. Se rellenan automáticamente desde los campos
    //   canónicos en normalizeTicketSettings().
    nif?: string;
    company_name?: string;
    header_text?: string;
    footer_text?: string;
    paper_width_mm?: number;
    logo_url?: string;
    show_vat_breakdown?: boolean;
}

/**
 * ★ v4.6.0: Normaliza un objeto TicketSettings para que SIEMPRE exponga
 * tanto los campos canónicos (business_name, cif_nif, ticket_width_mm…)
 * como los alias de compatibilidad (company_name, nif, paper_width_mm…).
 * Corrige el bug de ancho de papel, que caía siempre a 58 mm porque
 * ticketPrinter leía paper_width_mm y loadTicketSettings sólo emitía
 * ticket_width_mm.
 */
export function normalizeTicketSettings(s: Partial<TicketSettings> | null | undefined): TicketSettings {
    const src = s ?? {};
    const businessName = src.business_name ?? src.company_name ?? "";
    const cifNif       = src.cif_nif       ?? src.nif        ?? "";
    const header       = src.ticket_header_msg ?? src.header_text ?? "";
    const footer       = src.ticket_footer_msg ?? src.footer_text ?? "";
    const width        = src.ticket_width_mm   ?? src.paper_width_mm ?? 80;
    return {
        ...src,
        business_name:     businessName,
        company_name:      src.company_name      ?? businessName,
        cif_nif:           cifNif,
        nif:               src.nif               ?? cifNif,
        address:           src.address ?? "",
        phone:             src.phone ?? "",
        contact_email:     src.contact_email ?? "",
        ticket_header_msg: header,
        header_text:       src.header_text       ?? header,
        ticket_footer_msg: footer,
        footer_text:       src.footer_text       ?? footer,
        ticket_show_tax:   src.ticket_show_tax !== false,
        show_vat_breakdown: src.show_vat_breakdown ?? (src.ticket_show_tax !== false),
        ticket_width_mm:   width,
        paper_width_mm:    src.paper_width_mm    ?? width,
    };
}

/**
 * loadTicketSettings sobrecargado:
 *   - sin args → lee de LS SINCRONO (no HTTP) para ticket printer
 *   - con args → async RPC
 */
export function loadTicketSettings(): TicketSettings;
export function loadTicketSettings(tenantId: string | null | undefined): Promise<TicketSettings>;
export function loadTicketSettings(tenantId?: string | null | undefined): TicketSettings | Promise<TicketSettings> {
    if (tenantId === undefined || tenantId === null) {
        const local = readFromLocal();
        if (local && local.business_name) return normalizeTicketSettings(local as TicketSettings);
        return normalizeTicketSettings({
            business_name: "",
            cif_nif: "",
            address: "",
            phone: "",
            contact_email: "",
            ticket_header_msg: "",
            ticket_footer_msg: "",
            ticket_show_tax: true,
            ticket_width_mm: 80,
        });
    }
    return loadCompany(tenantId).then(c => normalizeTicketSettings(c as TicketSettings));
}

/**
 * Devuelve datos de empresa para imprimir ticket (RPC + LS fallback).
 */
export async function companyFromSettingsWithLocal(tenantId: string | null): Promise<{
    business_name: string;
    cif_nif: string;
    address: string;
    phone: string;
    contact_email: string;
}> {
    const c = await loadCompany(tenantId);
    return {
        business_name: c.business_name || "",
        cif_nif: c.cif_nif || "",
        address: c.address || "",
        phone: c.phone || "",
        contact_email: c.contact_email || "",
    };
}
