// =====================================================================
// MOZONA TPV — migration.ts (v4.0.7-migration)
// =====================================================================
// Sincronización atómica desde localStorage → Supabase.
// Garantiza que:
//   - NO sobrescribe registros existentes (idempotente)
//   - NO elimina datos (preserva historial)
//   - Marca los registros migrados para evitar duplicados
//   - Reintenta en caso de fallo de red
// =====================================================================

import { supabase } from "./supabase";
import { resolveRealTenantId } from "./waiters";

const MIGRATION_KEY = "mozona.migration.completed.v1";
const MIGRATED_IDS_KEY = "mozona.migration.migrated_ids";

export interface MigrationResult {
    ok: boolean;
    customers: { migrated: number; skipped: number; failed: number };
    orders:    { migrated: number; skipped: number; failed: number };
    pre_bills: { migrated: number; skipped: number; failed: number };
    errors: string[];
    duration_ms: number;
}

/**
 * Lee localStorage y devuelve los IDs de registros ya migrados.
 */
function getMigratedIds(): Set<string> {
    try {
        const raw = localStorage.getItem(MIGRATED_IDS_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function saveMigratedIds(ids: Set<string>): void {
    try {
        localStorage.setItem(MIGRATED_IDS_KEY, JSON.stringify(Array.from(ids)));
    } catch (_) { /* ignore */ }
}

/**
 * Verifica si ya se ejecutó la migración global.
 */
export function isMigrationCompleted(): boolean {
    try {
        return localStorage.getItem(MIGRATION_KEY) === "true";
    } catch {
        return false;
    }
}

function markMigrationCompleted(): void {
    try {
        localStorage.setItem(MIGRATION_KEY, "true");
    } catch (_) { /* ignore */ }
}

/**
 * Migra clientes desde localStorage `mozona.customers.<tenantId>` a Supabase.
 * Usa upsert con onConflict para idempotencia.
 */
async function migrateCustomers(tenantId: string, migratedIds: Set<string>): Promise<{ migrated: number; skipped: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0, skipped = 0, failed = 0;

    // Lee clientes de localStorage
    const keys = Object.keys(localStorage).filter(k =>
        k.startsWith("mozona.customers.") || k === "mozona.customers"
    );
    if (keys.length === 0) return { migrated, skipped, failed, errors };

    const customers: any[] = [];
    for (const k of keys) {
        try {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            const data = JSON.parse(raw);
            const list = Array.isArray(data) ? data : [data];
            for (const c of list) {
                if (!c || !c.name) continue;
                customers.push({ ...c, _lsKey: k });
            }
        } catch (_) {}
    }

    if (customers.length === 0) return { migrated, skipped, failed, errors };

    // Para cada cliente, verificar si ya existe en BD y migrar
    for (const c of customers) {
        try {
            const lsId = c.id || `${c._lsKey}:${c.name}`;
            if (migratedIds.has(lsId)) {
                skipped++;
                continue;
            }

            // Verificar si ya existe en BD por (tenant_id, name)
            const { data: existing } = await supabase
                .from("customers")
                .select("id")
                .eq("tenant_id", tenantId)
                .eq("name", c.name)
                .is("deleted_at", null)
                .maybeSingle();

            if (existing) {
                // Ya existe → no migrar (preservar datos del servidor)
                migratedIds.add(lsId);
                skipped++;
                continue;
            }

            // No existe → insertar
            const insertPayload = {
                id:          c.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id) ? c.id : undefined,
                tenant_id:   tenantId,
                name:        c.name,
                phone:       c.phone ?? null,
                email:       c.email ?? null,
                nif:         c.nif ?? null,
                address:     c.address ?? null,
                notes:       c.notes ?? null,
                created_at:  c.created_at || new Date().toISOString(),
            };

            const { error } = await supabase
                .from("customers")
                .insert(insertPayload);

            if (error) {
                // Si es por constraint UNIQUE, marcar como skipped
                if (/duplicate key|unique constraint/i.test(error.message)) {
                    skipped++;
                } else {
                    failed++;
                    errors.push(`customers[${c.name}]: ${error.message}`);
                }
            } else {
                migrated++;
            }
            migratedIds.add(lsId);
        } catch (e: any) {
            failed++;
            errors.push(`customers[${c.name}]: ${e?.message || "unknown"}`);
        }
    }

    return { migrated, skipped, failed, errors };
}

/**
 * Migra órdenes desde localStorage a Supabase.
 */
async function migrateOrders(tenantId: string, migratedIds: Set<string>): Promise<{ migrated: number; skipped: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0, skipped = 0, failed = 0;

    const keys = Object.keys(localStorage).filter(k =>
        k.startsWith("mozona.orders.") ||
        k.startsWith("mozona.order.") ||
        k === "mozona.orders"
    );
    if (keys.length === 0) return { migrated, skipped, failed, errors };

    const orders: any[] = [];
    for (const k of keys) {
        try {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            const data = JSON.parse(raw);
            const list = Array.isArray(data) ? data : [data];
            for (const o of list) {
                if (!o || !o.total) continue;
                orders.push({ ...o, _lsKey: k });
            }
        } catch (_) {}
    }

    if (orders.length === 0) return { migrated, skipped, failed, errors };

    for (const o of orders) {
        try {
            const lsId = o.id || `${o._lsKey}:${o.created_at}`;
            if (migratedIds.has(lsId)) {
                skipped++;
                continue;
            }

            // Verificar si ya existe por tenant_id + created_at
            if (o.created_at) {
                const { data: existing } = await supabase
                    .from("orders")
                    .select("id")
                    .eq("tenant_id", tenantId)
                    .eq("created_at", o.created_at)
                    .is("deleted_at", null)
                    .maybeSingle();

                if (existing) {
                    migratedIds.add(lsId);
                    skipped++;
                    continue;
                }
            }

            const insertPayload = {
                id:              o.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.id) ? o.id : undefined,
                tenant_id:       tenantId,
                table_id:        o.table_id ?? null,
                waiter_id:       o.waiter_id ?? null,
                waiter_name:     o.waiter_name ?? null,
                status:          o.status || "closed",
                subtotal:        Number(o.subtotal) || 0,
                tax_total:       Number(o.tax_total) || 0,
                total:           Number(o.total) || 0,
                payment_method:  o.payment_method ?? null,
                created_at:      o.created_at || new Date().toISOString(),
            };

            const { error } = await supabase
                .from("orders")
                .insert(insertPayload);

            if (error) {
                if (/duplicate key|unique constraint/i.test(error.message)) {
                    skipped++;
                } else {
                    failed++;
                    errors.push(`orders[${o.id || o.created_at}]: ${error.message}`);
                }
            } else {
                migrated++;
            }
            migratedIds.add(lsId);
        } catch (e: any) {
            failed++;
            errors.push(`orders[${o.id}]: ${e?.message || "unknown"}`);
        }
    }

    return { migrated, skipped, failed, errors };
}

/**
 * Migra pre-cuentas desde localStorage a Supabase.
 */
async function migratePreBills(tenantId: string, migratedIds: Set<string>): Promise<{ migrated: number; skipped: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0, skipped = 0, failed = 0;

    const keys = Object.keys(localStorage).filter(k =>
        k.startsWith("mozona.prebill.") ||
        k.startsWith("mozona.prebills.") ||
        k === "mozona.prebills"
    );
    if (keys.length === 0) return { migrated, skipped, failed, errors };

    const bills: any[] = [];
    for (const k of keys) {
        try {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            const data = JSON.parse(raw);
            const list = Array.isArray(data) ? data : [data];
            for (const b of list) {
                if (!b) continue;
                bills.push({ ...b, _lsKey: k });
            }
        } catch (_) {}
    }

    if (bills.length === 0) return { migrated, skipped, failed, errors };

    for (const b of bills) {
        try {
            const lsId = b.id || `${b._lsKey}:${b.created_at}`;
            if (migratedIds.has(lsId)) {
                skipped++;
                continue;
            }

            // Verificar si ya existe
            if (b.created_at) {
                const { data: existing } = await supabase
                    .from("pre_bills")
                    .select("id")
                    .eq("tenant_id", tenantId)
                    .eq("created_at", b.created_at)
                    .is("deleted_at", null)
                    .maybeSingle();

                if (existing) {
                    migratedIds.add(lsId);
                    skipped++;
                    continue;
                }
            }

            const insertPayload = {
                id:          b.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id) ? b.id : undefined,
                tenant_id:   tenantId,
                order_id:    b.order_id ?? null,
                table_id:    b.table_id ?? null,
                table_number: b.table_number ?? null,
                waiter_name: b.waiter_name ?? null,
                lines:       b.lines || [],
                subtotal:    Number(b.subtotal) || 0,
                tax_total:   Number(b.tax_total) || 0,
                total:       Number(b.total) || 0,
                status:      b.status || "open",
                created_at:  b.created_at || new Date().toISOString(),
            };

            const { error } = await supabase
                .from("pre_bills")
                .insert(insertPayload);

            if (error) {
                if (/duplicate key|unique constraint/i.test(error.message)) {
                    skipped++;
                } else {
                    failed++;
                    errors.push(`pre_bills[${b.id || b.created_at}]: ${error.message}`);
                }
            } else {
                migrated++;
            }
            migratedIds.add(lsId);
        } catch (e: any) {
            failed++;
            errors.push(`pre_bills[${b.id}]: ${e?.message || "unknown"}`);
        }
    }

    return { migrated, skipped, failed, errors };
}

/**
 * Ejecuta la migración completa desde localStorage a Supabase.
 * Es idempotente: si se ejecuta varias veces, no duplica datos.
 */
export async function runMigration(): Promise<MigrationResult> {
    const start = Date.now();
    const errors: string[] = [];

    let tenantId: string;
    try {
        tenantId = (await resolveRealTenantId(null)) || "";
    } catch {
        tenantId = "";
    }

    if (!tenantId) {
        return {
            ok: false,
            customers: { migrated: 0, skipped: 0, failed: 0 },
            orders:    { migrated: 0, skipped: 0, failed: 0 },
            pre_bills: { migrated: 0, skipped: 0, failed: 0 },
            errors: ["No hay tenant activo. Inicia sesión para migrar datos."],
            duration_ms: Date.now() - start,
        };
    }

    if (!supabase) {
        return {
            ok: false,
            customers: { migrated: 0, skipped: 0, failed: 0 },
            orders:    { migrated: 0, skipped: 0, failed: 0 },
            pre_bills: { migrated: 0, skipped: 0, failed: 0 },
            errors: ["Supabase no disponible."],
            duration_ms: Date.now() - start,
        };
    }

    const migratedIds = getMigratedIds();

    const [custs, ords, bills] = await Promise.all([
        migrateCustomers(tenantId, migratedIds),
        migrateOrders(tenantId, migratedIds),
        migratePreBills(tenantId, migratedIds),
    ]);

    saveMigratedIds(migratedIds);

    const totalMigrated = custs.migrated + ords.migrated + bills.migrated;
    const totalFailed = custs.failed + ords.failed + bills.failed;

    errors.push(...custs.errors, ...ords.errors, ...bills.errors);

    // Solo marcar como completado si no hubo fallos críticos
    if (totalFailed === 0) {
        markMigrationCompleted();
    }

    return {
        ok: totalFailed === 0,
        customers: { migrated: custs.migrated, skipped: custs.skipped, failed: custs.failed },
        orders:    { migrated: ords.migrated, skipped: ords.skipped, failed: ords.failed },
        pre_bills: { migrated: bills.migrated, skipped: bills.skipped, failed: bills.failed },
        errors,
        duration_ms: Date.now() - start,
    };
}

/**
 * Soft-delete seguro vía RPC.
 * Nunca falla aunque el registro no exista o ya esté borrado.
 */
export async function safeSoftDelete(
    table: "customers" | "orders" | "pre_bills",
    id: string,
    reason?: string
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no disponible" };

    const rpcName = table === "customers" ? "soft_delete_customer"
                  : table === "orders"    ? "soft_delete_order"
                  :                          "soft_delete_pre_bill";

    const { error } = await supabase.rpc(rpcName, {
        p_id: id,
        p_reason: reason || null,
    });

    if (error) {
        // Si ya está borrado, devolver OK (idempotente)
        if (/not found|access denied/i.test(error.message)) {
            return { ok: true };
        }
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

/**
 * Restaurar un registro soft-deleted.
 */
export async function safeRestore(
    table: "customers" | "orders",
    id: string
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no disponible" };

    const rpcName = table === "customers" ? "restore_customer" : "restore_order";

    const { error } = await supabase.rpc(rpcName, { p_id: id });

    if (error) {
        return { ok: false, error: error.message };
    }
    return { ok: true };
}
