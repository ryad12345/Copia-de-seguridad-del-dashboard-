// =====================================================================
// MOZONA TPV — business-mode.ts v4.3.0
// =====================================================================
// Selector dinámico de tipo de negocio: 'retail' | 'hospitality'
// Permite ocultar mesas en retail y adaptar UI dinámicamente.
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { supabaseFetch } from "./supabase-fetch";
import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import { onTenantChange } from "./tenant-realtime-sync";

export type BusinessType = "hospitality" | "retail";

const LS_KEY = "mozona.business_type";

function readLocalBusinessType(): BusinessType {
    if (typeof localStorage === "undefined") return "hospitality";
    try {
        const v = localStorage.getItem(LS_KEY);
        return (v === "retail" || v === "hospitality") ? v : "hospitality";
    } catch {
        return "hospitality";
    }
}

function writeLocalBusinessType(t: BusinessType) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(LS_KEY, t); } catch {}
}

/**
 * Devuelve el business_type desde BD. Fallback a LS y luego default.
 * ★ v4.3.1: si la query falla (columna no existe / SQL #64 no aplicado),
 *   no hace ruido — usa LS/default.
 */
export async function loadBusinessType(tenantId?: string | null): Promise<{
    type: BusinessType;
    features: Record<string, any>;
    source: "supabase" | "local" | "default";
}> {
    const tid = await resolveRealTenantId(tenantId ?? null);
    if (!tid) {
        return { type: readLocalBusinessType(), features: {}, source: "default" };
    }
    try {
        const r = await supabaseFetch(
            `/rest/v1/tenants?id=eq.${tid}&select=business_type,features_config&limit=1`,
            { jwt: null }
        );
        if (r.ok) {
            const arr = await r.json();
            const row = Array.isArray(arr) && arr[0] ? arr[0] : null;
            if (row) {
                // Si la columna existe pero es null → usar default
                const t = (row.business_type === "retail" ? "retail" : "hospitality") as BusinessType;
                writeLocalBusinessType(t);
                return {
                    type: t,
                    features: row.features_config || {},
                    source: "supabase",
                };
            }
        } else if (r.status === 400 || r.status === 404) {
            // ★ columnas no existen aún (cliente no ejecutó SQL #64)
            console.log("[business-mode] business_type no existe aún (SQL #64 pendiente)");
        }
    } catch (e: any) {
        console.log("[business-mode] load silent fail:", e?.message);
    }
    return { type: readLocalBusinessType(), features: {}, source: "local" };
}

/**
 * Persiste business_type en BD.
 */
export async function saveBusinessType(
    type: BusinessType,
    features: Record<string, any> = {},
    tenantId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
    const tid = await resolveRealTenantId(tenantId ?? null);
    if (!tid) return { ok: false, error: "Sin tenantId" };

    writeLocalBusinessType(type);

    try {
        const r = await supabaseFetch(
            `/rest/v1/tenants?id=eq.${tid}`,
            {
                method: "PATCH",
                jwt: null,
                body: JSON.stringify({
                    business_type: type,
                    features_config: features,
                }),
            }
        );
        if (!r.ok) {
            const errText = await r.text().catch(() => "");
            return { ok: false, error: errText };
        }
        console.log("[business-mode] ✅ saved", type);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

/**
 * ★ Hook React: useBusinessMode()
 * Suscribe realtime de tenants para refrescar automáticamente.
 */
export function useBusinessMode(tenantId?: string | null) {
    const [type, setType] = useState<BusinessType>(readLocalBusinessType);
    const [features, setFeatures] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await loadBusinessType(tenantId);
            setType(r.type);
            setFeatures(r.features);
        } catch (e: any) {
            setError(e?.message);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const off = onTenantChange((newRow) => {
            if (!newRow) return;
            const t = newRow.business_type === "retail" ? "retail" : "hospitality";
            setType(t);
            setFeatures(newRow.features_config || {});
        });
        return off;
    }, []);

    const isRetail = type === "retail";
    const isHospitality = type === "hospitality";

    return {
        type,
        isRetail,
        isHospitality,
        features,
        loading,
        error,
        refresh,
        setType,
        saveBusinessType: (newType: BusinessType, newFeatures?: Record<string, any>) =>
            saveBusinessType(newType, newFeatures, tenantId).then(r => {
                if (r.ok) setType(newType);
                return r;
            }),
    };
}

if (typeof window !== "undefined") {
    try {
        (window as any).__businessMode = {
            loadBusinessType,
            saveBusinessType,
            useBusinessMode,
        };
    } catch {}
}
