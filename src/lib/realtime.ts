// =====================================================================
// MOZONA TPV — realtime: singleton seguro (anti-bucle)
// =====================================================================
// Patrón singleton para evitar suscripciones duplicadas que causan
// RangeError: Maximum call stack size exceeded.
// Solo UN canal activo en toda la app. Cleanup seguro con flag.

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

let globalChannel: RealtimeChannel | null = null;
let refCount = 0;
let isUnsubscribing = false;  // ★ guard contra re-entry

/**
 * Suscribe al canal GLOBAL de Realtime.
 * Solo se crea UN canal aunque se llame múltiples veces (singleton).
 *
 * ★ v4.1.7-multi-tenant: filtra por tenant_id para que cada tenant
 *   SOLO reciba cambios de SUS propios datos (defensa en profundidad
 *   sobre RLS).
 *
 * @param onUpdate Callback con el payload del evento
 * @param tenantId  ID del tenant para filtrar (defense in depth)
 * @returns Función de cleanup que decrementa el refCount
 */
export function subscribeToPosChannels(
    onUpdate: (payload: { table: string; eventType: string; new: any; old: any }) => void,
    tenantId?: string | null,
): () => void {
    if (!supabase) return () => {};

    // ★ Guard contra bucle: si ya estamos desuscribiendo, no hacer nada
    if (isUnsubscribing) {
        console.warn("[realtime] ya está desuscribiendo, ignorando llamada");
        return () => {};
    }

    refCount++;
    const myRef = refCount;
    console.log("[realtime] suscribiendo, refCount=", myRef, "tenant=", tenantId);

    // Si ya hay un canal, solo añadir el listener
    if (globalChannel) {
        console.log("[realtime] reutilizando canal existente, refCount=", myRef);
        return () => {
            refCount--;
            console.log("[realtime] cleanup (sin canal), refCount=", refCount);
        };
    }

    // ★ v4.1.7: filtros por tenant_id para cada tabla
    //   Si NO hay tenantId, no se suscribe (defense in depth)
    if (!tenantId) {
        console.warn("[realtime] sin tenantId, no se suscribe a cambios remotos");
        refCount--;
        return () => {};
    }

    const tid = String(tenantId);
    const channelName = `tpv-global-sync-${tid}-${Date.now()}`;
    console.log("[realtime] creando nuevo canal:", channelName);

    let channel: RealtimeChannel;
    try {
        channel = supabase.channel(channelName);
        channel
            .on("postgres_changes",
                { event: "*", schema: "public", table: "products", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "products", eventType: p.eventType, new: p.new, old: p.old }))
            .on("postgres_changes",
                { event: "*", schema: "public", table: "dining_tables", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "dining_tables", eventType: p.eventType, new: p.new, old: p.old }))
            .on("postgres_changes",
                { event: "*", schema: "public", table: "open_orders", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "open_orders", eventType: p.eventType, new: p.new, old: p.old }))
            .on("postgres_changes",
                { event: "*", schema: "public", table: "orders", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "orders", eventType: p.eventType, new: p.new, old: p.old }))
            .on("postgres_changes",
                { event: "*", schema: "public", table: "order_items", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "order_items", eventType: p.eventType, new: p.new, old: p.old }))
            .on("postgres_changes",
                { event: "*", schema: "public", table: "categories", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "categories", eventType: p.eventType, new: p.new, old: p.old }))
            // ★ v4.2.7: realtime en tenants — refleja cambios de empresa
            //   (nombre, CIF, dirección, ticket_*, contacto) al instante
            .on("postgres_changes",
                { event: "*", schema: "public", table: "tenants", filter: `id=eq.${tid}` },
                (p: any) => onUpdate({ table: "tenants", eventType: p.eventType, new: p.new, old: p.old }))
            // ★ v4.2.7: realtime en tenant_settings — refleja cambios de
            //   tema, ancho papel, header_text, footer_text, etc.
            .on("postgres_changes",
                { event: "*", schema: "public", table: "tenant_settings", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "tenant_settings", eventType: p.eventType, new: p.new, old: p.old }))
            // ★ v4.2.7: realtime en waiters — refleja cambios de PIN/nombre
            .on("postgres_changes",
                { event: "*", schema: "public", table: "waiters", filter: `tenant_id=eq.${tid}` },
                (p: any) => onUpdate({ table: "waiters", eventType: p.eventType, new: p.new, old: p.old }))
            .subscribe((status: string) => {
                console.log("[realtime] status:", status);
            });
        globalChannel = channel;
    } catch (e) {
        console.error("[realtime] error creando canal:", e);
        refCount--;
        return () => {};
    }

    return () => {
        // ★ Cleanup seguro con queueMicrotask para evitar recursión
        // (el bug era: leave() se llama dentro de trigger() que es
        //  llamado por callback de leave() => bucle)
        isUnsubscribing = true;
        refCount--;
        console.log("[realtime] cleanup, refCount=", refCount);

        if (refCount <= 0 && globalChannel) {
            const ch = globalChannel;
            globalChannel = null;
            // ★ queueMicrotask saca el removeChannel del stack actual
            queueMicrotask(() => {
                try {
                    void supabase.removeChannel(ch);
                } catch (e) {
                    console.warn("[realtime] removeChannel error:", e);
                }
                setTimeout(() => { isUnsubscribing = false; }, 100);
            });
        } else {
            // Pequeño delay antes de resetear el flag
            setTimeout(() => { isUnsubscribing = false; }, 100);
        }
    };
}

/** Para diagnóstico: cuántos consumidores hay activos */
export function getRealtimeRefCount(): number {
    return refCount;
}
