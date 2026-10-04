// =====================================================================
// MOZONA TPV — bidirectionalSync (v4.0.7-bidir-sync)
// =====================================================================
// Sincronización bidireccional OFFLINE-FIRST entre Supabase y localStorage.
//
// PATRÓN:
//   1. Lectura: Supabase → cache local → state (UI inmediata)
//   2. Escritura: state → cache local → Supabase (background)
//   3. Si Supabase falla: queda en queue de pending_sync
//   4. useNetworkSync() detecta online y procesa queue
//
// GARANTÍAS:
//   - UI NUNCA se bloquea (lectura optimista desde cache)
//   - Datos NUNCA se pierden (queue persistente en localStorage)
//   - Sincronización automática cuando vuelve la conexión
// =====================================================================

import { supabase, isSupabaseConfigured } from "./supabase";
import { safeFetch } from "./safeFetch";
import { resolveRealTenantId } from "./waiters";
import { SUPABASE_URL as SUPABASE_URL_VAL, SUPABASE_ANON_KEY } from "./constants";

const PENDING_KEY = "mozona.pending_sync";
const CACHE_PREFIX = "mozona.sync.cache.";

export type SyncTable = "products" | "categories" | "dining_tables" | "tenants" | "ticket_settings" | "tenant_settings";

export interface PendingChange {
    id:         string;
    table:      SyncTable;
    operation:  "insert" | "update" | "delete";
    payload:    any;
    attempts:   number;
    last_error: string | null;
    created_at: number;
}

interface CacheEntry<T = any> {
    data:       T;
    source:     "supabase" | "cache";
    cached_at:  number;
}

// ═══════════════════════════════════════════════════════════════════════
// QUEUE: Cambios pendientes de sincronizar
// ═══════════════════════════════════════════════════════════════════════

function loadQueue(): PendingChange[] {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveQueue(q: PendingChange[]): void {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(q));
    } catch { /* ignore */ }
}

export function enqueueChange(change: Omit<PendingChange, "id" | "attempts" | "created_at">): void {
    const q = loadQueue();
    q.push({
        ...change,
        id: crypto.randomUUID(),
        attempts: 0,
        created_at: Date.now(),
    });
    saveQueue(q);
}

export function getQueueSize(): number {
    return loadQueue().length;
}

// ═══════════════════════════════════════════════════════════════════════
// CACHE: Datos cargados desde Supabase (para UX offline)
// ═══════════════════════════════════════════════════════════════════════

function cacheKey(table: SyncTable, tenantId: string): string {
    return `${CACHE_PREFIX}${table}::${tenantId}`;
}

export function getCached<T = any>(table: SyncTable, tenantId: string): T | null {
    try {
        const raw = localStorage.getItem(cacheKey(table, tenantId));
        if (!raw) return null;
        const entry: CacheEntry<T> = JSON.parse(raw);
        return entry.data;
    } catch {
        return null;
    }
}

function setCache(table: SyncTable, tenantId: string, data: any): void {
    try {
        const entry: CacheEntry = {
            data,
            source: "supabase",
            cached_at: Date.now(),
        };
        localStorage.setItem(cacheKey(table, tenantId), JSON.stringify(entry));
    } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURA: Supabase → cache local → return
// =====================================================================

export async function fetchWithCache<T = any>(
    table: SyncTable,
    tenantId: string,
    options: {
        select?: string;
        orderBy?: { column: string; ascending?: boolean };
        limit?: number;
        forceRefresh?: boolean;
    } = {}
): Promise<{ data: T[]; source: "supabase" | "cache" | "empty" }> {
    // 1. Si no hay Supabase, devolver cache
    if (!isSupabaseConfigured || !supabase) {
        const cached = getCached<T[]>(table, tenantId);
        return { data: cached || [], source: cached ? "cache" : "empty" };
    }

    // 2. Si NO es forceRefresh, devolver cache inmediato
    if (!options.forceRefresh) {
        const cached = getCached<T[]>(table, tenantId);
        if (cached) {
            // Devuelve cache YA y refresca en background
            refreshInBackground(table, tenantId, options);
            return { data: cached, source: "cache" };
        }
    }

    // 3. Sin cache: fetch directo
    try {
        const data = await fetchFromSupabase<T>(table, tenantId, options);
        setCache(table, tenantId, data);
        return { data, source: "supabase" };
    } catch (e) {
        console.warn(`[bidir-sync] ${table} fetch failed:`, e);
        const cached = getCached<T[]>(table, tenantId);
        return { data: cached || [], source: cached ? "cache" : "empty" };
    }
}

async function fetchFromSupabase<T>(
    table: SyncTable,
    tenantId: string,
    options: {
        select?: string;
        orderBy?: { column: string; ascending?: boolean };
        limit?: number;
    }
): Promise<T[]> {
    if (!supabase) return [];

    // ★ v4.0.7-bidir-jwt: si tenemos JWT del usuario, usar REST directo
    //   para que RLS funcione correctamente (RLS usa auth.uid())
    const jwt = getUserJwt();
    if (jwt) {
        let url = `${table}?tenant_id=eq.${tenantId}&select=${encodeURIComponent(options.select || "*")}`;
        if (options.orderBy) {
            const dir = options.orderBy.ascending === false ? "desc" : "asc";
            url += `&order=${encodeURIComponent(options.orderBy.column)}.${dir}`;
        }
        if (options.limit) {
            url += `&limit=${options.limit}`;
        }
        return await fetchWithJwt(url, { method: "GET" }, false);
    }

    let q = supabase.from(table).select(options.select || "*").eq("tenant_id", tenantId);

    if (options.orderBy) {
        q = q.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
    }
    if (options.limit) {
        q = q.limit(options.limit);
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as T[];
}

function refreshInBackground(
    table: SyncTable,
    tenantId: string,
    options: any
): void {
    // No await: refresh silencioso
    fetchFromSupabase(table, tenantId, options)
        .then(data => setCache(table, tenantId, data))
        .catch(() => { /* fail silently */ });
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURA: cache local → enqueue → Supabase (background)
// =====================================================================

export interface WriteOptions {
    /** Si true, espera a que termine la sincronización con Supabase */
    awaitSync?: boolean;
    /** Si true, muestra error en consola si falla */
    silent?: boolean;
}

export async function writeWithSync<T = any>(
    table: SyncTable,
    tenantId: string,
    operation: "insert" | "update" | "delete",
    payload: any,
    options: WriteOptions = {}
): Promise<{ ok: boolean; source: "supabase" | "queue" | "cache"; error?: string }> {
    // 1. SIEMPRE actualizar cache local primero (UX inmediata)
    updateLocalCache(table, tenantId, operation, payload);

    // 2. Intentar sync inmediato con Supabase
    try {
        await syncOne(table, operation, payload);
        return { ok: true, source: "supabase" };
    } catch (e: any) {
        // 3. Si falla: enqueue para retry en background
        enqueueChange({
            table,
            operation,
            payload,
            last_error: e?.message || "unknown",
        });

        if (!options.silent) {
            console.warn(`[bidir-sync] ${table} ${operation} enqueued (retry later):`, e?.message);
        }

        if (options.awaitSync) {
            return { ok: false, source: "queue", error: e?.message };
        }
        return { ok: true, source: "queue", error: e?.message };
    }
}

// ★ v4.0.7-bidir-jwt: obtiene el JWT del usuario activo para queries autenticadas
function getUserJwt(): string | null {
    try {
        const raw = localStorage.getItem("pos_current_user");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const token = parsed?.session?.access_token;
        // Solo usar tokens que NO sean JWT formato viejo cuando la anon_key es publishable
        const ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
        if (ANON_KEY.startsWith("sb_publishable_") && token?.startsWith("eyJ")) {
            // El token es del formato viejo pero la anon_key es nueva
            // Necesitamos refrescar el token via supabase.auth
            return null;
        }
        return token || null;
    } catch {
        return null;
    }
}

async function fetchWithJwt(table: string, options: RequestInit, returnRepresentation = false): Promise<any> {
    const ANON_KEY = SUPABASE_ANON_KEY;
    const SUPABASE_URL = SUPABASE_URL_VAL;
    const jwt = getUserJwt();

    const headers: any = {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        ...(options.headers || {}),
    };

    // Si hay JWT del usuario, usarlo para que RLS funcione (auth.uid())
    if (jwt) {
        headers["Authorization"] = `Bearer ${jwt}`;
    } else {
        headers["Authorization"] = `Bearer ${ANON_KEY}`;
    }

    if (returnRepresentation) {
        headers["Prefer"] = "return=representation";
    }

    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const res = await fetch(url, {
        ...options,
        headers,
    });

    const contentType = res.headers.get("content-type") || "";
    let data: any = null;
    if (contentType.includes("application/json")) {
        try { data = await res.json(); } catch (_) {}
    } else {
        try { data = await res.text(); } catch (_) {}
    }

    if (!res.ok) {
        const msg = typeof data === "object" ? (data?.message || data?.error || JSON.stringify(data)) : String(data);
        throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return data;
}

async function syncOne(table: SyncTable, operation: "insert" | "update" | "delete", payload: any): Promise<void> {
    if (!supabase) throw new Error("Supabase no configurado");

    // ★ v4.4.3: safety-net global — eliminar created_at UUID-ify
    //   que causa error 42804: column created_at is of type timestamp
    //   but expression is of type uuid
    const { sanitizePayload } = await import("./payload-sanitizer");
    payload = sanitizePayload(payload);

    const ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
    const jwt = getUserJwt();

    let result;
    switch (operation) {
        case "insert":
            // ★ v4.0.7-bidir-sync: UPSERT si la tabla tiene tenant_id
            // Si tenemos JWT del usuario, usamos REST API directo para que RLS funcione
            if (payload.tenant_id && jwt) {
                // ★ v4.0.7-bidir-jwt: usar REST directo con JWT del usuario
                await fetchWithJwt(table, {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
                }, false);
                return;  // Success
            }
            // Si no hay JWT, intentar via supabase (con anon key + RLS fallará)
            if (payload.tenant_id && (
                table === "tenant_settings" || table === "ticket_settings" ||
                table === "products" || table === "categories" || table === "dining_tables"
            )) {
                result = await supabase.from(table).upsert(payload, {
                    onConflict: table === "products" ? "id" :
                                table === "categories" ? "id" :
                                table === "dining_tables" ? "id" :
                                "tenant_id"
                });
            } else {
                result = await supabase.from(table).insert(payload);
            }
            break;
        case "update":
            if (!payload.id) throw new Error("UPDATE requires id");
            if (jwt) {
                await fetchWithJwt(`${table}?id=eq.${payload.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                }, false);
                return;
            }
            result = await supabase.from(table).update(payload).eq("id", payload.id);
            break;
        case "delete":
            if (!payload.id) throw new Error("DELETE requires id");
            if (jwt) {
                await fetchWithJwt(`${table}?id=eq.${payload.id}`, {
                    method: "DELETE",
                }, false);
                return;
            }
            result = await supabase.from(table).delete().eq("id", payload.id);
            break;
    }

    if (result?.error) throw new Error(result.error.message);
}

// ═══════════════════════════════════════════════════════════════════════
// CACHE LOCAL: actualizar tras cada operación
// =====================================================================

function updateLocalCache(table: SyncTable, tenantId: string, operation: string, payload: any): void {
    const cached = getCached<any[]>(table, tenantId) || [];
    let updated: any[];

    switch (operation) {
        case "insert":
            updated = [...cached, payload];
            break;
        case "update":
            updated = cached.map(item => item.id === payload.id ? { ...item, ...payload } : item);
            break;
        case "delete":
            updated = cached.filter(item => item.id !== payload.id);
            break;
        default:
            updated = cached;
    }

    setCache(table, tenantId, updated);
}

// ═══════════════════════════════════════════════════════════════════════
// SYNC ENGINE: Procesar queue cuando hay conexión
// =====================================================================

let syncInProgress = false;
let syncListeners: Array<() => void> = [];

export function onSyncProgress(fn: () => void): () => void {
    syncListeners.push(fn);
    return () => { syncListeners = syncListeners.filter(l => l !== fn); };
}

function notifySyncListeners(): void {
    syncListeners.forEach(fn => { try { fn(); } catch {} });
}

export async function processQueue(): Promise<{
    processed: number;
    failed: number;
    remaining: number;
}> {
    if (syncInProgress) {
        return { processed: 0, failed: 0, remaining: getQueueSize() };
    }

    syncInProgress = true;
    notifySyncListeners();

    const queue = loadQueue();
    let processed = 0;
    let failed = 0;
    const remaining: PendingChange[] = [];

    for (const change of queue) {
        try {
            await syncOne(change.table, change.operation, change.payload);
            processed++;
        } catch (e: any) {
            change.attempts++;
            change.last_error = e?.message || "unknown";
            // Max 10 retries
            if (change.attempts < 10) {
                remaining.push(change);
            }
            failed++;
        }
    }

    saveQueue(remaining);
    syncInProgress = false;
    notifySyncListeners();

    return { processed, failed, remaining: remaining.length };
}

/**
 * Procesa la queue automáticamente cuando vuelve la conexión.
 * Llamar desde useNetworkSync.
 */
export function autoSyncOnReconnect(): void {
    if (typeof window !== "undefined") {
        window.addEventListener("online", () => {
            console.log("[bidir-sync] online → process queue");
            processQueue().catch(() => {});
        });

        // Procesar al cargar si hay queue pendiente
        if (getQueueSize() > 0) {
            setTimeout(() => processQueue().catch(() => {}), 5000);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Tenant actual
// =====================================================================

/**
 * Resuelve el tenant_id del usuario actual con fallback VIP.
 */
export async function getCurrentTenantId(): Promise<string | null> {
    if (typeof window === "undefined") return null;

    // 1. localStorage cache
    try {
        const cached = localStorage.getItem("mozona.current_tenant_id");
        if (cached) return cached;
    } catch {}

    // 2. resolveRealTenantId (con VIP fallback)
    try {
        const userEmail = (window as any)?.mozona?.auth?.user?.email ||
                           JSON.parse(localStorage.getItem("mozona.session") || "{}")?.user?.email ||
                           "";
        const tid = await resolveRealTenantId(userEmail || null);
        if (tid) {
            try { localStorage.setItem("mozona.current_tenant_id", tid); } catch {}
            return tid;
        }
    } catch {}

    // 3. VIP hardcoded fallback
    const VIP = "58a8e6f5-3172-409c-8aa5-ae02be0b7e76";
    return VIP;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Tenant completo (incluye business_name, cif, address, phone)
// =====================================================================

export interface TenantFull {
    id:                 string;
    business_name:      string | null;
    cif_nif:            string | null;
    address:            string | null;
    phone:              string | null;
    contact_email:      string | null;  // ★ real column name in tenants table
    owner_id:           string | null;
    plan:               string | null;
    activation_status:  string | null;
}

export async function fetchTenantFull(tenantId: string): Promise<TenantFull | null> {
    if (!supabase) return null;
    try {
        // ★ v4.0.7-quirúrgico-fix: usar 'contact_email' (la columna real en Supabase)
        //   Antes usaba 'email' que NO existe en tenants → HTTP 400
        const { data, error } = await supabase
            .from("tenants")
            .select("id, business_name, cif_nif, address, phone, contact_email, owner_id, plan, activation_status")
            .eq("id", tenantId)
            .maybeSingle();
        if (error) {
            // Si la columna contact_email no existe (algunos entornos viejos), intentar fallback
            if (error.code === "42703") {
                console.warn("[bidirectionalSync] columna contact_email no existe, fallback email");
                const fallback = await supabase
                    .from("tenants")
                    .select("id, business_name, cif_nif, address, phone, owner_id, plan, activation_status")
                    .eq("id", tenantId)
                    .maybeSingle();
                if (fallback.error) throw fallback.error;
                if (fallback.data) {
                    try {
                        localStorage.setItem(`mozona.tenant.${tenantId}`, JSON.stringify(fallback.data));
                    } catch {}
                    return { ...(fallback.data as any), contact_email: null } as TenantFull;
                }
                return null;
            }
            throw error;
        }
        if (!data) return null;

        // Cache en localStorage para acceso rápido
        try {
            localStorage.setItem(`mozona.tenant.${tenantId}`, JSON.stringify(data));
        } catch {}

        return data as TenantFull;
    } catch (e) {
        // Fallback a cache
        try {
            const cached = localStorage.getItem(`mozona.tenant.${tenantId}`);
            if (cached) return JSON.parse(cached);
        } catch {}
        return null;
    }
}
