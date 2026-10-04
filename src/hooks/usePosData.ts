// =====================================================================
// MOZONA TPV — usePosData: hook de datos del terminal (v4.0.7-bidir-sync)
// =====================================================================
// Usa bidirectionalSync.ts para conexión bidireccional OFFLINE-FIRST con Supabase.
// - Lectura: Supabase → cache local → UI
// - Escritura: cache local → Supabase (background con retry)
// =====================================================================

import { useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
    fetchWithCache,
    writeWithSync,
    processQueue,
    getCurrentTenantId,
    fetchTenantFull,
    onSyncProgress,
    type TenantFull,
} from "../lib/bidirectionalSync";
import {
    putCategories, putProducts, putTables,
} from "../lib/offlineStorage";
import type {
    Restaurant, Category, Product, RestaurantTable, ConnectionStatus,
} from "../lib/types";

// ★ v4.5.13: VIP tenant IDs hardcoded (último recurso)
//   CRÍTICO: el admin (rofixinsta) NO debe tener tenant_id
//   porque solo debe ver el panel admin, NUNCA datos de tenants.
//   Chalohiahmd mantiene su tenant de "El Rincón de Casablanca".
const VIP_HARDCODED: Record<string, string> = {
    "chalohiahmd1980@gmail.com": "58a8e6f5-3172-409c-8aa5-ae02be0b7e76",
    // ★ v4.5.13: rofixinsta ELIMINADO de este mapa
    // El admin no es un tenant — es el operador del sistema.
};

export interface PosDataState {
    restaurant:  Restaurant | null;
    tenantFull:  TenantFull | null;
    categories:  Category[];
    products:    Product[];
    tables:      RestaurantTable[];
    connection:  ConnectionStatus;
    loading:     boolean;
    error:       string | null;
    refresh:     () => Promise<void>;
    saveProduct: (product: Partial<Product>) => Promise<{ ok: boolean; source: string }>;
    saveTable:   (table: Partial<RestaurantTable>) => Promise<{ ok: boolean; source: string }>;
    source:      "supabase" | "lan" | "cache" | "empty";
    syncQueueSize: number;
}

export function usePosData(): PosDataState {
    const auth = useAuth();
    const [restaurant, setRestaurant]   = useState<Restaurant | null>(null);
    const [tenantFull, setTenantFull]   = useState<TenantFull | null>(null);
    const [categories, setCategories]   = useState<Category[]>([]);
    const [products,   setProducts]     = useState<Product[]>([]);
    const [tables,     setTables]       = useState<RestaurantTable[]>([]);
    const [connection, setConnection]   = useState<ConnectionStatus>({
        printer: false, network: navigator.onLine, supabase: isSupabaseConfigured,
    });
    const [loading,    setLoading]      = useState(true);
    const [error,      setError]        = useState<string | null>(null);
    const [source,     setSource]       = useState<"supabase" | "cache" | "empty">("empty");
    const [syncQueueSize, setSyncQueueSize] = useState(0);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            if (!isSupabaseConfigured || !supabase) {
                setRestaurant(null);
                setTenantFull(null);
                setCategories([]);
                setProducts([]);
                setTables([]);
                setSource("empty");
                setError("Supabase no configurado");
                setLoading(false);
                return;
            }

            // ★ Resolver tenant_id
            const userEmail = (auth.user?.email || "").toLowerCase();
            const candidate = auth.tenant?.id || userEmail || null;

            let realTenantId = "";
            try {
                realTenantId = (await getCurrentTenantId()) || "";
            } catch (e) {
                console.warn("[usePosData] tenant resolve warn:", String(e));
            }

            // Fallback VIP
            if ((!realTenantId || realTenantId === "00000000-0000-0000-0000-000000000000")
                && VIP_HARDCODED[userEmail]) {
                realTenantId = VIP_HARDCODED[userEmail];
            }

            if (!realTenantId || realTenantId === "00000000-0000-0000-0000-000000000000") {
                setRestaurant(null);
                setTenantFull(null);
                setCategories([]);
                setProducts([]);
                setTables([]);
                setSource("empty");
                setError("No se pudo resolver tenant_id");
                setLoading(false);
                return;
            }

            // ★ Cargar en paralelo: tenant full, products, categories, tables
            const [tenantFullRes, productsRes, categoriesRes, tablesRes] = await Promise.all([
                fetchTenantFull(realTenantId),
                fetchWithCache<Product>("products", realTenantId, {
                    orderBy: { column: "name", ascending: true },
                    forceRefresh: true,
                }),
                fetchWithCache<Category>("categories", realTenantId, {
                    orderBy: { column: "sort_order", ascending: true },
                    forceRefresh: true,
                }),
                fetchWithCache<RestaurantTable>("dining_tables", realTenantId, {
                    forceRefresh: true,
                }),
            ]);

            // Productos
            const productsArr = productsRes.data.map((p: any) => ({
                ...p,
                price: Number(p.price ?? 0),
                tax_rate: Number(p.tax_rate ?? 10),
                is_available: p.is_active ?? true,
                restaurant_id: p.tenant_id,
            })) as Product[];

            // Mesas: si no hay en BD, generar dummy locales
            let tablesArr = tablesRes.data as RestaurantTable[];
            if (tablesArr.length === 0) {
                // Generar 16 mesas dummy locales
                tablesArr = Array.from({ length: 16 }, (_, i) => ({
                    id: `local-table-${i + 1}`,
                    tenant_id: realTenantId,
                    table_number: i + 1,
                    name: `Mesa ${i + 1}`,
                    seats: 4,
                    status: "available",
                    is_active: true,
                } as any));
            }

            // Update state
            setTenantFull(tenantFullRes);
            setRestaurant((tenantFullRes as any) || { id: realTenantId });
            setProducts(productsArr);
            setCategories(categoriesRes.data as Category[]);
            setTables(tablesArr);
            setConnection({
                printer: false,
                network: navigator.onLine,
                supabase: productsRes.source === "supabase" || categoriesRes.source === "supabase",
            });
            setSource(productsRes.source);
            setError(null);

            // Cache en offlineStorage
            try {
                await Promise.all([
                    putCategories(categoriesRes.data as Category[]),
                    putProducts(productsArr),
                    putTables(tablesArr),
                ]);
            } catch {/* ignore */}

            // Auto-sync queue
            processQueue().catch(() => {});
        } catch (e) {
            console.error("[usePosData] ERROR:", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [auth.user?.email, auth.tenant?.id]);

    // ★ Guardar producto (con sync bidireccional + SECURITY DEFINER fallback)
    const saveProduct = useCallback(async (product: Partial<Product>) => {
        const tenantId = await getCurrentTenantId();
        if (!tenantId) return { ok: false, source: "none" };

        const payload = {
            ...product,
            tenant_id: tenantId,
            price: Number(product.price ?? 0),
            tax_rate: Number(product.tax_rate ?? 10),
            is_active: product.is_available ?? true,
        };

        // 1) SECURITY DEFINER RPC (sin Vercel, bypasa RLS anon)
        try {
            const { rpcSaveProduct } = await import("../lib/secureRpc");
            const rpc = await rpcSaveProduct(payload);
            if (rpc.ok) {
                if (refresh) await refresh();
                return { ok: true, source: "rpc" };
            }
        } catch (e) {
            console.warn("[usePosData] rpcSaveProduct fallback:", e);
        }

        // 2) Fallback writeWithSync (intenta con cache local + queue)
        const operation = payload.id ? "update" : "insert";
        const result = await writeWithSync("products", tenantId, operation, payload);
        if (result.ok && refresh) await refresh();
        return { ok: result.ok, source: result.source };
    }, [refresh]);

    // ★ Guardar mesa
    const saveTable = useCallback(async (table: Partial<RestaurantTable>) => {
        const tenantId = await getCurrentTenantId();
        if (!tenantId) return { ok: false, source: "none" };

        const payload = { ...table, tenant_id: tenantId };

        // Si es mesa local (no tiene UUID), guardar solo local
        if (table.id?.startsWith("local-table-")) {
            return { ok: true, source: "local" };
        }

        // 1) SECURITY DEFINER RPC (preferido para bypasar RLS)
        try {
            const { rpcSaveTable } = await import("../lib/secureRpc");
            const rpc = await rpcSaveTable(payload);
            if (rpc.ok) {
                if (refresh) await refresh();
                return { ok: true, source: "rpc" };
            }
        } catch (e) {
            console.warn("[usePosData] rpcSaveTable fallback:", e);
        }

        // 2) Fallback writeWithSync
        const operation = payload.id ? "update" : "insert";
        const result = await writeWithSync("dining_tables", tenantId, operation, payload);
        if (result.ok && refresh) await refresh();
        return { ok: result.ok, source: result.source };
    }, [refresh]);

    // Suscribirse a cambios de sync
    useEffect(() => {
        const unsub = onSyncProgress(() => {
            setSyncQueueSize(0); // recalcular si es necesario
        });
        return unsub;
    }, []);

    // Suscribirse a online/offline
    useEffect(() => {
        const onOnline = () => {
            setConnection(c => ({ ...c, network: true }));
            processQueue().catch(() => {});
        };
        const onOffline = () => {
            setConnection(c => ({ ...c, network: false }));
        };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    // Initial load
    useEffect(() => { void refresh(); }, [refresh]);

    return {
        restaurant, tenantFull, categories, products, tables,
        connection, loading, error, refresh, saveProduct, saveTable,
        source, syncQueueSize,
    };
}
