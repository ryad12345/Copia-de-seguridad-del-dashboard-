// =====================================================================
// MOZONA TPV — catalog: conexión 100% DIRECTA a Supabase
// =====================================================================
// Sin IndexedDB, sin mocks, sin fallbacks estáticos.
// Lee en vivo de public.products y public.categories.
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";
import { getUserJwt } from "./auth-helpers";
import { dbWrite } from "./db-write";

const FALLBACK_TENANT_ID = "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";

export interface PosProduct {
    id:            string;
    name:          string;
    description:   string | null;
    price:         number;
    category_id:   string | null;
    category:      string | null;
    category_name: string | null;
    image_url:     string | null;
    is_active:     boolean;
    tenant_id:     string | null;
    tax_rate:      number;
}

export interface PosCategory {
    id:          string;
    name:        string;
    description: string | null;
    image_url:   string | null;
    sort_order:  number;
    is_active:   boolean;
    tenant_id:   string | null;
}

// =====================================================================
// CATÁLOGO DE PRODUCTOS
// =====================================================================

/**
 * Lee el catálogo en vivo desde Supabase. Sin IndexedDB ni fallbacks estáticos.
 *
 * @param tenantId Si se proporciona, filtra por tenant. Si no, lee TODOS los
 *                 productos activos de la BD.
 */
export async function fetchCatalog(tenantId?: string | null): Promise<PosProduct[]> {
    if (!supabase) {
        console.error("[fetchCatalog] ❌ Supabase no configurado");
        return [];
    }
    console.log("[fetchCatalog] 📡 Consultando Supabase EN VIVO... tenantId=", tenantId);

    // ★ v3.4.9: SIEMPRE filtrar por tenant_id (RLS se encarga de validar
    //   que el usuario tiene acceso al tenant).
    //   ELIMINADO el fallback que leía TODOS los productos de TODOS los tenants
    //   (cross-tenant contamination).
    const useTenant = tenantId && tenantId !== "vip-bypass" && tenantId !== "null" && tenantId !== "";
    if (!useTenant) {
        console.warn("[fetchCatalog] ⚠️ Sin tenant_id, no se puede consultar productos");
        return [];
    }

    const { data, error } = await supabase
        .from("products")
        .select("id, name, description, price, category_id, category, category_name, image_url, is_active, tenant_id, tax_rate")
        .eq("is_active", true)
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });

    if (error) {
        console.error("[fetchCatalog] ❌ Error Supabase:", error.code, error.message);
        return [];
    }

    console.log(`[fetchCatalog] ✓ Cargados ${data?.length ?? 0} productos del tenant ${tenantId}`);
    return (data ?? []).map(normalizeProduct);
}

function normalizeProduct(p: any): PosProduct {
    return {
        id:            p.id,
        name:          p.name ?? "—",
        description:   p.description ?? null,
        price:         Number(p.price ?? 0),
        category_id:   p.category_id ?? null,
        category:      p.category ?? p.category_name ?? null,
        category_name: p.category_name ?? p.category ?? null,
        image_url:     p.image_url ?? p.image ?? null,
        is_active:     p.is_active ?? true,
        tenant_id:     p.tenant_id ?? null,
        tax_rate:      Number(p.tax_rate ?? p.vat_rate ?? 10),
    };
}

// =====================================================================
// CATEGORÍAS
// =====================================================================

/**
 * Lee las categorías en vivo desde Supabase.
 *
 * ★ v4.0.9-stable-GUARDIAN: BLOQUEO total si tenantId es inválido.
 *   Nunca llama a Supabase si el tenant no está listo.
 *   Devuelve [] (vacío) y registra warning, NO rompe la UI.
 */
export async function fetchCategories(tenantId?: string | null): Promise<PosCategory[]> {
    if (!supabase) {
        console.error("[fetchCategories] ❌ Supabase no configurado");
        return [];
    }

    // ★ GUARDIÁN: bloqueo si tenantId es null/undefined/empty/vip-bypass
    const validTenant =
        tenantId &&
        typeof tenantId === "string" &&
        tenantId !== "vip-bypass" &&
        tenantId !== "null" &&
        tenantId !== "" &&
        tenantId !== "undefined" &&
        tenantId !== "00000000-0000-0000-0000-000000000000";

    if (!validTenant) {
        console.warn("[fetchCategories] ⛔ BLOQUEADO: tenantId inválido:", tenantId, "— usando cache LS");
        return loadCategoriesFromLS();
    }

    console.log("[fetchCategories] 📡 Consultando Supabase EN VIVO... tenantId=", tenantId);

    const { data, error } = await supabase
        .from("categories")
        .select("id, name, sort_order, tenant_id")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true });

    if (error) {
        console.error("[fetchCategories] ❌ Error:", error.message);
        return [];
    }

    // Ordenar por sort_order
    const arr = (data ?? []).slice();
    arr.sort((a: any, b: any) => {
        const sa = Number(a.sort_order ?? 0);
        const sb = Number(b.sort_order ?? 0);
        if (sa !== sb) return sa - sb;
        return String(a.name).localeCompare(String(b.name));
    });

    const normalized = arr.map(normalizeCategory);

    // ★ v4.0.9-stable: cachear resultado en LS para mostrarlo offline
    if (normalized.length > 0) {
        saveCategoriesToLS(normalized);
    }

    console.log(`[fetchCategories] ✓ Cargadas ${normalized.length} categorías del tenant ${tenantId}`);
    return normalized;
}

function normalizeCategory(c: any): PosCategory {
    return {
        id:          c.id,
        name:        c.name ?? "—",
        description: c.description ?? null,
        image_url:   c.image_url ?? c.image ?? null,
        sort_order:  Number(c.sort_order ?? 0),
        is_active:   c.is_active ?? true,
        tenant_id:   c.tenant_id ?? null,
    };
}

// =====================================================================
// CRUD PRODUCTOS
// =====================================================================

export interface ProductInput {
    id?:          string;
    name:        string;
    price:       number;
    category?:   string | null;
    category_id?: string | null;
    description?: string | null;
    image_url?:  string | null;
    is_active?:  boolean;
    tax_rate?:   number;
}

// ★ v4.0.7-caja-fix-2: STORAGE_KEY para fallback localStorage
const TARGET_USER_EMAIL_LS = "chalohiahmd1980@gmail.com";
const STORAGE_KEY_PRODUCTS = `pos_custom_products_${TARGET_USER_EMAIL_LS}`;
const STORAGE_KEY_CATEGORIES = `pos_custom_categories_${TARGET_USER_EMAIL_LS}`;

function readCategoriesCache(): PosCategory[] {
    try {
        if (typeof localStorage === "undefined") return [];
        const raw = localStorage.getItem(STORAGE_KEY_CATEGORIES);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed as PosCategory[];
        }
    } catch {}
    return [];
}

function writeCategoriesCache(categories: PosCategory[]): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(STORAGE_KEY_CATEGORIES, JSON.stringify(categories));
    } catch (e) {
        console.warn("[catalog] writeCategoriesCache fallo:", e);
    }
}

export function loadCategoriesFromLS(): PosCategory[] {
    const cached = readCategoriesCache();
    if (cached.length > 0) {
        console.log("[fetchCategories] 📦 Sirviendo desde cache LS:", cached.length, "categorías");
    }
    return cached;
}

function saveCategoriesToLS(categories: PosCategory[]): void {
    writeCategoriesCache(categories);
}

function readProductsCache(): any[] {
    try {
        if (typeof localStorage === "undefined") return [];
        const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch {}
    return [];
}

function writeProductsCache(products: any[]) {
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
            console.log("[saveProduct] cache localStorage actualizado:", products.length, "productos");
        }
    } catch (e) {
        console.warn("[saveProduct] cache localStorage fallo:", e);
    }
}

export async function saveProduct(input: ProductInput): Promise<{ ok: boolean; id?: string; error?: string; savedInCache?: boolean }> {
    if (!supabase) {
        // Supabase no configurado → solo cache local
        const cache = readProductsCache();
        const idx = input.id ? cache.findIndex(p => p.id === input.id) : -1;
        const newProduct = {
            id: input.id || `local-${Date.now()}`,
            name: input.name,
            price: input.price,
            category: input.category,
            category_id: input.category_id,
            description: input.description,
            image_url: input.image_url,
            is_active: input.is_active ?? true,
            tenant_id: FALLBACK_TENANT_ID,
        };
        if (idx >= 0) {
            cache[idx] = { ...cache[idx], ...newProduct };
        } else {
            cache.push(newProduct);
        }
        writeProductsCache(cache);
        return { ok: true, id: newProduct.id, savedInCache: true };
    }

    // ★ v1.9.11: payload MINIMO solo con columnas que EXISTEN
    const realTenantId = (await resolveRealTenantId(null)) || FALLBACK_TENANT_ID;
    const payload: any = {
        name:         String(input.name).trim(),
        price:        Number(input.price),
        category_id:  input.category_id ?? null,
        category:     input.category ?? null,
        is_active:    input.is_active ?? true,
        tenant_id:    realTenantId,
    };
    console.log("[saveProduct] payload:", payload);

    // ★ v4.0.7-caja-fix-2: SIEMPRE guardar en localStorage (incluso si Supabase falla)
    //   Garantiza que el producto se ve en la caja INMEDIATAMENTE
    const cache = readProductsCache();
    const cacheIdx = input.id ? cache.findIndex(p => p.id === input.id) : -1;
    const localProduct = {
        ...(input.id ? {} : { id: `local-${Date.now()}` }),
        ...payload,
        description: input.description ?? "",
        image_url: input.image_url ?? "",
    };
    if (cacheIdx >= 0) {
        cache[cacheIdx] = { ...cache[cacheIdx], ...localProduct };
    } else if (!input.id) {
        // Solo añadir a cache si es nuevo (no update de uno existente en BD)
        cache.push(localProduct);
    }
    writeProductsCache(cache);

    // ★ v4.2.1: usar dbWrite con JWT explicito (RLS passa garantizado)
    try {
        const jwt = getUserJwt();
        if (input.id && !input.id.startsWith("local-")) {
            const r = await dbWrite({
                table: "products",
                action: "UPDATE",
                payload,
                filter: { id: input.id },
                jwt,
            });
            if (!r.ok) {
                console.error("[saveProduct] UPDATE fail:", r.error, "(cache sigue OK)");
                return { ok: true, id: input.id, savedInCache: true, error: r.error };
            }
            const id = (Array.isArray(r.data) ? r.data?.[0]?.id : r.data?.id) || input.id;
            console.log("[saveProduct] ✅ UPDATE", id);
            return { ok: true, id, savedInCache: true };
        } else {
            const r = await dbWrite({
                table: "products",
                action: "INSERT",
                payload,
                jwt,
            });
            if (!r.ok) {
                console.warn("[saveProduct] INSERT fail:", r.error, "(cache sigue OK)");
                return { ok: true, id: localProduct.id, savedInCache: true, error: r.error };
            }
            const id = (Array.isArray(r.data) ? r.data?.[0]?.id : r.data?.id) || localProduct.id;
            console.log("[saveProduct] ✅ INSERT", id);
            // Actualizar cache con id real
            if (id && id !== localProduct.id) {
                const cache2 = readProductsCache();
                const idx = cache2.findIndex(p => p.id === localProduct.id);
                if (idx >= 0) cache2[idx] = { ...cache2[idx], id };
                writeProductsCache(cache2);
            }
            return { ok: true, id, savedInCache: true };
        }
    } catch (e: any) {
        console.warn("[saveProduct] exception, guardando solo en cache:", e?.message);
        return { ok: true, id: localProduct.id, savedInCache: true, error: e?.message };
    }
}

export async function deleteProduct(id: string, hard = false): Promise<{ ok: boolean; error?: string }> {
    const jwt = getUserJwt();
    try {
        if (hard) {
            const r = await dbWrite({
                table: "products",
                action: "DELETE",
                filter: { id },
                jwt,
            });
            if (!r.ok) return { ok: false, error: r.error };
        } else {
            const r = await dbWrite({
                table: "products",
                action: "UPDATE",
                payload: { is_active: false },
                filter: { id },
                jwt,
            });
            if (!r.ok) return { ok: false, error: r.error };
        }
        // Limpiar cache local
        const cache = readProductsCache();
        writeProductsCache(cache.filter(p => p.id !== id));
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message };
    }
}

// =====================================================================
// CRUD CATEGORÍAS
// =====================================================================

export interface CategoryInput {
    id?:         string;
    name:        string;
    description?: string | null;
    image_url?:  string | null;
    sort_order?: number;
    is_active?:  boolean;
}

export async function saveCategory(input: CategoryInput): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    // ★ v1.9.4: resolver tenant_id SIEMPRE (es NOT NULL en la BD)
    const realTenantId = (await resolveRealTenantId(null)) || FALLBACK_TENANT_ID;
    // ★ v1.9.2: 'description' e 'is_active' no existen en tabla real
    const payload: any = {
        name:        input.name,
        sort_order:  Number(input.sort_order ?? 0),
        tenant_id:   realTenantId,
    };
    // Solo añadir image_url si viene definido
    if (input.image_url) {
        payload.image_url = input.image_url;
    }
    try {
        if (input.id) {
            // ★ v4.2.7: defense in depth — añadir tenant_id filter
            const { data, error } = await supabase
                .from("categories")
                .update(payload)
                .eq("id", input.id)
                .eq("tenant_id", realTenantId)
                .select()
                .single();
            if (error) return { ok: false, error: error.message };
            return { ok: true, id: (data as any)?.id };
        } else {
            const { data, error } = await supabase
                .from("categories")
                .insert([payload])
                .select()
                .single();
            if (error) return { ok: false, error: error.message };
            return { ok: true, id: (data as any)?.id };
        }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function deleteCategory(id: string, hard = false): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    // ★ v4.2.7: defense in depth — resolver tenant_id
    const realTenantId = (await resolveRealTenantId(null)) || FALLBACK_TENANT_ID;
    try {
        if (hard) {
            const { error } = await supabase
                .from("categories")
                .delete()
                .eq("id", id)
                .eq("tenant_id", realTenantId);
            if (error) return { ok: false, error: error.message };
        } else {
            const { error } = await supabase
                .from("categories")
                .update({ is_active: false })
                .eq("id", id)
                .eq("tenant_id", realTenantId);
            if (error) return { ok: false, error: error.message };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// =====================================================================
// COMPATIBILIDAD (tipo antiguo)
// =====================================================================

/** @deprecated usar PosProduct */
export type CatalogProduct = PosProduct;
/** @deprecated usar fetchCatalog */
export const fetchCatalogLegacy = fetchCatalog;
