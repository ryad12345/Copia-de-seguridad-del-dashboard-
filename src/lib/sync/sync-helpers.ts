// =====================================================================
// MOZONA TPV — sync-helpers.ts (v4.2.0-enterprise)
// =====================================================================
// Servicios robustos de sincronización con cache + fallback duro.
// Estrategia Offline-First:
//   1. Intentar Supabase
//   2. Si falla -> cache localStorage por tenant
//   3. Si no hay cache -> fallback hardcoded garantizado
// =====================================================================

import { supabase } from "../supabase";

// =====================================================================
// CONSTANTES
// =====================================================================

export const CACHE_KEY_CATEGORIES = (tid: string) =>
    `mozona.sync.cache.categories::${tid}`;

export const CACHE_KEY_PRODUCTS = (tid: string) =>
    `mozona.sync.cache.products::${tid}`;

// =====================================================================
// FALLBACKS HARDCODEADOS (último recurso)
// =====================================================================

export const FALLBACK_CATEGORIES = [
    { id: "c1", name: "Entrantes", sort_order: 10 },
    { id: "c2", name: "Carnes",    sort_order: 20 },
    { id: "c3", name: "Pescados",  sort_order: 30 },
    { id: "c4", name: "Pizzas",    sort_order: 40 },
    { id: "c5", name: "Pastas",    sort_order: 50 },
    { id: "c6", name: "Bebidas",   sort_order: 60 },
    { id: "c7", name: "Postres",   sort_order: 70 },
    { id: "c8", name: "Extras",    sort_order: 80 },
];

const DEFAULT_CATEGORY_NAME = "Entrantes";

// =====================================================================
// TIPOS
// =====================================================================

export interface Category {
    id: string;
    name: string;
    sort_order: number;
    tenant_id?: string;
    image_url?: string | null;
    is_active?: boolean;
}

export interface Product {
    id: string;
    name: string;
    category?: string | null;
    category_id?: string | null;
    price: number;
    description?: string | null;
    image_url?: string | null;
    image?: string | null;
    is_active?: boolean;
    is_available?: boolean;
    tenant_id?: string;
    tax_rate?: number;
}

// =====================================================================
// CATEGORIES: cache-first + fallback duro
// =====================================================================

export async function getCategoriesWithFallback(tenantId: string): Promise<Category[]> {
    const cacheKey = CACHE_KEY_CATEGORIES(tenantId);

    // 1) Intentar Supabase (con JWT inyectado por setSession)
    if (supabase && tenantId) {
        try {
            const { data, error } = await supabase
                .from("categories")
                .select("id, name, sort_order, tenant_id, is_active")
                .eq("tenant_id", tenantId)
                .order("sort_order", { ascending: true });

            if (!error && Array.isArray(data) && data.length > 0) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data,
                        cached_at: Date.now(),
                    }));
                } catch {}
                console.log(`[getCategoriesWithFallback] BD OK: ${data.length}`);
                return data as Category[];
            }
        } catch (e) {
            console.warn("[getCategoriesWithFallback] Supabase error:", e);
        }
    }

    // 2) Cache localStorage
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
                console.log(`[getCategoriesWithFallback] cache LS: ${parsed.data.length}`);
                return parsed.data as Category[];
            }
        }
    } catch {}

    // 3) Fallback duro (8 categorías maestras)
    const fallback = FALLBACK_CATEGORIES.map((c) => ({
        ...c,
        tenant_id: tenantId,
        is_active: true,
    }));
    try {
        localStorage.setItem(cacheKey, JSON.stringify({
            data: fallback,
            cached_at: Date.now(),
            isFallback: true,
        }));
    } catch {}
    console.warn(`[getCategoriesWithFallback] fallback duro: ${fallback.length}`);
    return fallback;
}

// =====================================================================
// PRODUCTS: cache-first + sanitizer
// =====================================================================

export function sanitizeProductsData(products: Product[]): Product[] {
    if (!Array.isArray(products)) return [];
    return products.map((p) => ({
        ...p,
        category:
            p?.category && String(p.category).trim() !== ""
                ? String(p.category).trim()
                : DEFAULT_CATEGORY_NAME,
    }));
}

export async function getProductsWithFallback(tenantId: string): Promise<Product[]> {
    const cacheKey = CACHE_KEY_PRODUCTS(tenantId);

    // 1) Supabase
    if (supabase && tenantId) {
        try {
            const { data, error } = await supabase
                .from("products")
                .select("id, name, price, category, image_url, is_available, tenant_id")
                .eq("tenant_id", tenantId)
                .order("name");

            if (!error && Array.isArray(data) && data.length > 0) {
                const sanitized = sanitizeProductsData(data as Product[]);
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data: sanitized,
                        cached_at: Date.now(),
                    }));
                } catch {}
                console.log(`[getProductsWithFallback] BD OK: ${sanitized.length}`);
                return sanitized;
            }
        } catch (e) {
            console.warn("[getProductsWithFallback] Supabase error:", e);
        }
    }

    // 2) Cache LS
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
                const sanitized = sanitizeProductsData(parsed.data);
                console.log(`[getProductsWithFallback] cache LS: ${sanitized.length}`);
                return sanitized;
            }
        }
    } catch {}

    // 3) Fallback duro (legacy LS key)
    try {
        const legacy = localStorage.getItem("pos_custom_products_chalohiahmd1980@gmail.com");
        if (legacy) {
            const parsed = JSON.parse(legacy);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const sanitized = sanitizeProductsData(parsed);
                console.log(`[getProductsWithFallback] legacy LS: ${sanitized.length}`);
                return sanitized;
            }
        }
    } catch {}

    // 4) Array vacío (sin fallback duro para productos, cada tenant tiene los suyos)
    console.warn("[getProductsWithFallback] sin productos");
    return [];
}

// =====================================================================
// UTILIDADES DE MIGRACIÓN LS → BD
// =====================================================================

export async function bulkSyncLocalProductsToSupabase(tenantId: string): Promise<{
    ok: boolean;
    inserted: number;
    error?: string;
}> {
    if (!supabase || !tenantId) {
        return { ok: false, inserted: 0, error: "no supabase or tenant" };
    }

    // Leer productos del LS legacy
    let localProducts: Product[] = [];
    try {
        const raw = localStorage.getItem("pos_custom_products_chalohiahmd1980@gmail.com");
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) localProducts = parsed;
        }
    } catch {}

    if (localProducts.length === 0) {
        return { ok: true, inserted: 0 };
    }

    const sanitized = sanitizeProductsData(localProducts);
    const rows = sanitized.map((p) => ({
        id: p.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(p.name || "Sin nombre").slice(0, 200),
        price: Number(p.price ?? 0),
        category: p.category || DEFAULT_CATEGORY_NAME,
        category_id: p.category_id || null,
        image_url: p.image_url ?? p.image ?? null,
        is_active: p.is_active ?? true,
        is_available: p.is_available ?? true,
        tenant_id: tenantId,
    })).filter((r) => r.name.length > 0);

    try {
        // Batch insert (max 50 rows per request)
        let inserted = 0;
        for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            const { data, error } = await supabase
                .from("products")
                .insert(batch)
                .select();
            if (error) {
                return { ok: false, inserted, error: error.message };
            }
            inserted += data?.length || 0;
        }
        return { ok: true, inserted };
    } catch (e: any) {
        return { ok: false, inserted: 0, error: e?.message || String(e) };
    }
}

if (typeof window !== "undefined") {
    try {
        (window as any).__syncHelpers = {
            getCategoriesWithFallback,
            getProductsWithFallback,
            sanitizeProductsData,
            bulkSyncLocalProductsToSupabase,
        };
    } catch {}
}
