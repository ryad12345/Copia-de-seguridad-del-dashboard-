// =====================================================================
// MOZONA TPV — restaurantData: carga real desde Supabase
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";
import type { Restaurant, Category, Product, RestaurantTable } from "./types";

// ---------------------------------------------------------------------
// Tipos de respuesta
// ---------------------------------------------------------------------

export interface RestaurantDataResult {
    restaurant: Restaurant | null;
    categories: Category[];
    products:   Product[];
    tables:     RestaurantTable[];
    source:     "supabase" | "cache" | "mock" | "empty";
    error:      string | null;
}

// ---------------------------------------------------------------------
// Tenant del usuario actual (busca por owner_id = auth.uid())
// ---------------------------------------------------------------------

export async function getMyTenant(): Promise<Restaurant | null> {
    if (!isSupabaseConfigured) return null;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            // Sin sesión: intentar el primer tenant activo (VIP bypass)
            const firstActive = await getFirstActiveTenant();
            if (firstActive) {
                const result = await supabase
                    .from("tenants").select("*").eq("id", firstActive).maybeSingle();
                if (result.error && /recursion/i.test(result.error.message)) {
                    console.warn("[getMyTenant] RLS recursion detectada, saltando");
                } else if (result.data) {
                    return result.data as Restaurant;
                }
            }
            return null;
        }

        // ★ v1.9.1: ir DIRECTO al primer tenant activo (sin owner_id)
        try {
            const firstActive = await getFirstActiveTenant();
            if (firstActive) {
                const result = await supabase
                    .from("tenants").select("*").eq("id", firstActive).maybeSingle();
                if (result.error && /recursion/i.test(result.error.message)) {
                    console.warn("[getMyTenant] RLS recursion detectada, saltando");
                } else if (result.data) {
                    console.log("[getMyTenant] ✓ primer tenant activo:", firstActive);
                    return result.data as Restaurant;
                }
            }
        } catch (e) {
            console.warn("[getMyTenant] first tenant lookup error:", e);
        }

        // Si tampoco funcionó, intentar tenant_users (best-effort)
        try {
            const { data: tu, error: err2 } = await supabase
                .from("tenant_users")
                .select("tenant_id")
                .eq("user_id", user.id)
                .maybeSingle();
            if (err2) console.warn("[getMyTenant] tenant_users error:", err2.message);
            if (tu?.tenant_id) {
                const result = await supabase
                    .from("tenants").select("*").eq("id", tu.tenant_id).maybeSingle();
                if (result.error && /recursion/i.test(result.error.message)) {
                    console.warn("[getMyTenant] RLS recursion en tenant lookup, saltando");
                } else if (result.data) {
                    return result.data as Restaurant;
                }
            }
        } catch (e) {
            console.warn("[getMyTenant] tenant_users lookup error:", e);
        }

        return null;
    } catch (e) {
        console.warn("[restaurantData] getMyTenant error:", e);
        return null;
    }
}

/** Llama al RPC get_first_active_tenant() (SECURITY DEFINER, bypasea RLS). */
async function getFirstActiveTenant(): Promise<string | null> {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.rpc("get_first_active_tenant");
        if (error || !data) return null;
        return data as string;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------
// Categorías del tenant
// ---------------------------------------------------------------------

export async function loadCategories(tenantId: string): Promise<Category[]> {
    if (!isSupabaseConfigured) return [];
    // ★ v1.9.2: NO usar is_active (puede no existir)
    // ★ v3.4.9: SIEMPRE filtrar por tenant_id. RLS valida el acceso.
    //   ELIMINADO el fallback que leía TODAS las categorías de TODOS los tenants
    //   (cross-tenant contamination).
    if (!tenantId) {
        console.warn("[loadCategories] ⚠️ Sin tenant_id");
        return [];
    }
    const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order");
    if (error) {
        console.warn("[restaurantData] loadCategories error:", error.message);
        return [];
    }
    console.log("[loadCategories] ✓", data?.length ?? 0, "del tenant", tenantId);
    return (data ?? []) as Category[];
}

// ---------------------------------------------------------------------
// Productos del tenant
// ---------------------------------------------------------------------

/** ★★★ CONEXIÓN DIRECTA A SUPABASE ★★★
 *  Sin IndexedDB, sin localStorage, sin fallback estático.
 *  Garantiza que el catálogo de la caja viene SIEMPRE de la BD.
 *
 *  Si tenantId no devuelve resultados, hace query sin filtro
 *  y usa los productos del tenant dominante (el que tenga más).
 */
export async function loadProducts(tenantId: string): Promise<Product[]> {
    if (!isSupabaseConfigured) return [];
    console.log("[loadProducts] ★★ INICIO ★★ tenantId=", tenantId);

    const mapProduct = (p: any): Product => ({
        ...p,
        price: Number(p.price ?? 0),
        tax_rate: Number(p.tax_rate ?? 10),
        is_available: p.is_active ?? true,
        restaurant_id: p.tenant_id,
        category_id: p.category_id ?? null,
    });

    // ★ v3.4.9: SIEMPRE filtrar por tenant_id. RLS valida acceso.
    //   ELIMINADO el fallback que leía TODOS los productos y usaba el
    //   "tenant dominante" (cross-tenant contamination).
    if (!tenantId) {
        console.warn("[loadProducts] ⚠️ Sin tenant_id");
        return [];
    }
    const { data, error } = await supabase
        .from("products")
        .select("id, name, description, price, category, image_url, is_active, tenant_id, tax_rate, category_id, sort_order")
        .eq("tenant_id", tenantId)
        .order("name");
    if (error) {
        console.warn("[loadProducts] error con tenant:", error.message);
        return [];
    }
    console.log("[loadProducts] ✓", data?.length ?? 0, "del tenant", tenantId);
    return (data ?? []).map(mapProduct);
}

// ---------------------------------------------------------------------
// Mesas del tenant
// ---------------------------------------------------------------------

export async function loadTables(tenantId: string): Promise<RestaurantTable[]> {
    if (!isSupabaseConfigured) return [];
    // ★ v3.4.9: SIEMPRE filtrar por tenant_id. RLS valida acceso.
    //   ELIMINADO el fallback que leía TODAS las mesas.
    if (!tenantId) {
        console.warn("[loadTables] ⚠️ Sin tenant_id");
        return [];
    }
    let { data, error } = await supabase
        .from("dining_tables")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("zone", { ascending: true })
        .order("name", { ascending: true });
    if (error) {
        console.warn("[restaurantData] loadTables error:", error.message);
        data = null;
    }
    console.log("[loadTables] ✓", data?.length ?? 0, "mesas cargadas");
    return (data ?? []).map((t, i) => mapTableRow(t, i));
}

/** Mapea una fila de dining_tables a RestaurantTable.
 *  Numeración correlativa (1..N) según el índice en la lista,
 *  evitando duplicados al extraer números del campo 'name'
 *  (ej: "S-1", "B-1" ambos extraerían "1").
 *  El `id` original se preserva para que las comandas se guarden
 *  correctamente en la base de datos.
 */
function mapTableRow(t: any, i: number): RestaurantTable {
    return {
        id: t.id,                                  // ★ id original
        restaurant_id: t.tenant_id,
        zone_id: null,
        zone: t.zone ?? null,
        table_number: String(i + 1),               // ★ 1..N correlativo
        status: t.status === "occupied" ? "OCCUPIED"
              : t.status === "billed"   ? "BILL_REQUESTED"
              : t.status === "reserved" ? "RESERVED"
              : t.status === "dirty"    ? "DIRTY"
              : "FREE",
    };
}

// ---------------------------------------------------------------------
// Carga completa: tenant + categorías + productos + mesas
// ---------------------------------------------------------------------

export async function loadRestaurantData(tenantId?: string): Promise<RestaurantDataResult> {
    if (!isSupabaseConfigured) {
        return {
            restaurant: null, categories: [], products: [], tables: [],
            source: "empty", error: "Supabase no configurado",
        };
    }

    try {
        // 1) Resolver tenant
        let tenant: Restaurant | null = null;
        if (tenantId) {
            // ★ v4.0.7-rls-fix: Capturar recursion de RLS silenciosamente
            const result = await supabase
                .from("tenants")
                .select("*")
                .eq("id", tenantId)
                .maybeSingle();
            if (result.error) {
                if (/infinite recursion|recursion detected/i.test(result.error.message)) {
                    console.warn("[loadRestaurantData] RLS recursion en tenants, saltando query directa");
                } else {
                    console.warn("[loadRestaurantData] tenants query error:", result.error.message);
                }
            } else {
                tenant = result.data as Restaurant | null;
            }
        }
        if (!tenant) tenant = await getMyTenant();
        if (!tenant) {
            return {
                restaurant: null, categories: [], products: [], tables: [],
                source: "empty", error: "No se encontró un tenant para este usuario",
            };
        }

        // 2) Cargar en paralelo
        const [categories, products, tables] = await Promise.all([
            loadCategories(tenant.id),
            loadProducts(tenant.id),
            loadTables(tenant.id),
        ]);

        console.log(
            "[loadRestaurantData] tenant =", tenant.id,
            "products =", products.length,
            "categories =", categories.length,
            "tables =", tables.length,
        );

        return { restaurant: tenant, categories, products, tables, source: "supabase", error: null };
    } catch (e) {
        return {
            restaurant: null, categories: [], products: [], tables: [],
            source: "empty", error: e instanceof Error ? e.message : String(e),
        };
    }
}
