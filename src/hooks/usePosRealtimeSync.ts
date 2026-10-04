// =====================================================================
// MOZONA TPV — usePosRealtimeSync: hook centralizado de sincronización
// =====================================================================
// Mantiene en un único lugar los 3 canales de Realtime de Supabase:
//   1. products  → catálogo
//   2. dining_tables → estado de mesas
//   3. open_orders → comandas activas
//   4. orders (opcional) → para SalesPanel
//
// El estado de React se actualiza INMEDIATAMENTE al recibir cualquier
// evento.  No se necesita F5.
//
// Uso:
//   const { products, tables, openOrders, lastEvent } = usePosRealtimeSync(tenantId);
// =====================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { resolveRealTenantId } from "../lib/waiters";

export interface RealtimeProduct {
    id: string;
    name: string;
    price: number;
    category: string | null;
    image_url: string | null;
    is_active: boolean;
    tax_rate: number;
    tenant_id: string | null;
}

export interface RealtimeTable {
    id: string;
    table_number: string | number;
    status: "FREE" | "OCCUPIED" | "DIRTY" | "BILL_REQUESTED" | "RESERVED" | string;
    current_order_id?: string | null;
    tenant_id?: string | null;
}

export interface RealtimeOpenOrder {
    id: string;
    tenant_id: string;
    table_id: string;
    table_number: string;
    waiter_name: string | null;
    items: any[];
    status: "open" | "locked";
    updated_at: string;
}

export interface RealtimeOrder {
    id: string;
    tenant_id: string;
    table_id: string | null;
    table_number: string | null;
    waiter_name: string | null;
    subtotal: number;
    tax_total: number;
    total: number;
    payment_method: string | null;
    status: string;
    items: any[];
    created_at: string;
}

export interface UsePosRealtimeSyncOptions {
    /** Si true, también sincroniza la tabla orders (para SalesPanel) */
    includeOrders?: boolean;
}

export function usePosRealtimeSync(
    tenantId: string | null,
    options: UsePosRealtimeSyncOptions = {},
) {
    const { includeOrders = false } = options;
    const [products, setProducts] = useState<RealtimeProduct[]>([]);
    const [tables, setTables] = useState<RealtimeTable[]>([]);
    const [openOrders, setOpenOrders] = useState<RealtimeOpenOrder[]>([]);
    const [orders, setOrders] = useState<RealtimeOrder[]>([]);
    const [lastEvent, setLastEvent] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "subscribing" | "ready" | "error">("idle");
    const channelsRef = useRef<any[]>([]);

    // Reset al cambiar tenant
    useEffect(() => {
        setProducts([]);
        setTables([]);
        setOpenOrders([]);
        setOrders([]);
    }, [tenantId]);

    const setupChannels = useCallback(async () => {
        if (!supabase) return;
        const realId = await resolveRealTenantId(tenantId);
        if (!realId || realId === "00000000-0000-0000-0000-000000000000") return;

        setStatus("subscribing");
        const ts = Date.now();
        const rnd = Math.random().toString(36).slice(2, 6);
        const newChannels: any[] = [];

        // 1) Canal de PRODUCTS
        const productsCh = supabase
            .channel(`realtime-products-${ts}-${rnd}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload: any) => {
                console.log("[realtime] products:", payload.eventType);
                setLastEvent(`products:${payload.eventType}`);
                if (payload.eventType === "INSERT") {
                    setProducts(prev => [...prev.filter(p => p.id !== payload.new.id), payload.new as RealtimeProduct]);
                } else if (payload.eventType === "UPDATE") {
                    setProducts(prev => prev.map(p => p.id === payload.new.id ? payload.new as RealtimeProduct : p));
                } else if (payload.eventType === "DELETE") {
                    setProducts(prev => prev.filter(p => p.id !== (payload.old as any).id));
                }
            })
            .subscribe((s: string) => console.log("[realtime] products status:", s));
        newChannels.push(productsCh);

        // 2) Canal de DINING_TABLES
        const tablesCh = supabase
            .channel(`realtime-tables-${ts}-${rnd}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "dining_tables" }, (payload: any) => {
                console.log("[realtime] dining_tables:", payload.eventType);
                setLastEvent(`dining_tables:${payload.eventType}`);
                const tbl = (payload.new ?? payload.old) as any;
                if (payload.eventType === "DELETE") {
                    setTables(prev => prev.filter(t => t.id !== tbl?.id));
                } else {
                    setTables(prev => {
                        const idx = prev.findIndex(t => t.id === tbl?.id);
                        if (idx >= 0) {
                            const next = [...prev];
                            next[idx] = { ...next[idx], ...tbl };
                            return next;
                        }
                        return [...prev, tbl as RealtimeTable];
                    });
                }
            })
            .subscribe((s: string) => console.log("[realtime] tables status:", s));
        newChannels.push(tablesCh);

        // 3) Canal de OPEN_ORDERS
        const openOrdersCh = supabase
            .channel(`realtime-open-orders-${ts}-${rnd}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "open_orders" }, (payload: any) => {
                console.log("[realtime] open_orders:", payload.eventType);
                setLastEvent(`open_orders:${payload.eventType}`);
                if (payload.eventType === "DELETE") {
                    setOpenOrders(prev => prev.filter(o => o.id !== (payload.old as any).id));
                } else {
                    setOpenOrders(prev => {
                        const idx = prev.findIndex(o => o.id === (payload.new as any).id);
                        if (idx >= 0) {
                            const next = [...prev];
                            next[idx] = payload.new as RealtimeOpenOrder;
                            return next;
                        }
                        return [...prev, payload.new as RealtimeOpenOrder];
                    });
                }
            })
            .subscribe((s: string) => console.log("[realtime] open_orders status:", s));
        newChannels.push(openOrdersCh);

        // 4) Canal de ORDERS (opcional, solo si includeOrders)
        if (includeOrders) {
            const ordersCh = supabase
                .channel(`realtime-orders-${ts}-${rnd}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload: any) => {
                    console.log("[realtime] orders:", payload.eventType);
                    setLastEvent(`orders:${payload.eventType}`);
                    if (payload.eventType === "DELETE") {
                        setOrders(prev => prev.filter(o => o.id !== (payload.old as any).id));
                    } else {
                        setOrders(prev => [payload.new as RealtimeOrder, ...prev.filter(o => o.id !== (payload.new as any).id)]);
                    }
                })
                .subscribe((s: string) => console.log("[realtime] orders status:", s));
            newChannels.push(ordersCh);
        }

        channelsRef.current = newChannels;
        setStatus("ready");
    }, [tenantId, includeOrders]);

    useEffect(() => {
        setupChannels();
        return () => {
            // Cleanup
            for (const ch of channelsRef.current) {
                try { void supabase?.removeChannel(ch); } catch {}
            }
            channelsRef.current = [];
        };
    }, [setupChannels]);

    return {
        products,
        tables,
        openOrders,
        orders,
        lastEvent,
        status,
        setProducts,   // Para carga inicial desde el hook
        setTables,
        setOpenOrders,
        setOrders,
    };
}
