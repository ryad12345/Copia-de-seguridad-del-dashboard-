// =====================================================================
// MOZONA TPV — offlineStorage.ts: persistencia 100% offline (IndexedDB)
// =====================================================================
// Capa de almacenamiento offline-first. La app es 100% funcional sin
// red: la carta, las mesas y las comandas viven aquí, y las facturas
// VeriFactu se encolan para sincronizar con la nube cuando vuelva la
// conexión.
//
// Usa `idb` (~2 KB) sobre la API nativa IndexedDB. Esquema versionado
// con migraciones en `upgrade()`.
// =====================================================================

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Product, Category, RestaurantTable, OrderItem, PaymentMethod } from "./types";

// ---------------------------------------------------------------------
// Camareros (caché local)
// ---------------------------------------------------------------------

/** Camarero cacheado para validación offline de PIN. */
export interface CachedWaiter {
    id:         string;
    tenant_id:  string;
    user_id:    string | null;
    name:       string;
    pin_code:   string | null;
    role:       "owner" | "manager" | "waiter" | "kitchen";
    is_active:  boolean;
    cached_at:  number;
}

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface LocalOrder {
    id:             string;
    tableId:        string;
    tableNumber:    string;
    items:          OrderItem[];
    subtotal:       number;
    taxAmount:      number;
    total:          number;
    paymentMethod?: PaymentMethod;
    status:         "OPEN" | "PAID" | "CANCELLED";
    waiterName:     string;
    createdAt:      string;
    updatedAt:      string;
}

export type SyncKind = "INVOICE_PUSH" | "ORDER_PUSH" | "CATEGORY_PULL" | "PRODUCT_PULL";
export type SyncStatus = "PENDING" | "SYNCING" | "DONE" | "FAILED";

export interface PendingSyncItem {
    id?:           number;          // auto-increment
    kind:          SyncKind;
    payload:       unknown;          // JSON-serializable
    status:        SyncStatus;
    attempts:      number;
    createdAt:     string;
    nextRetryAt:   string;
    lastError?:    string;
}

interface MetaValue {
    key:   string;
    value:  unknown;
}

// ---------------------------------------------------------------------
// Esquema IDB
// ---------------------------------------------------------------------

interface MozonaDB extends DBSchema {
    products: {
        key:    string;
        value:  Product;
        indexes: { "by-category": string };
    };
    categories: {
        key:    string;
        value:  Category;
        indexes: { "by-sortOrder": number };
    };
    tables: {
        key:    string;
        value:  RestaurantTable;
        indexes: { "by-status": string };
    };
    orders: {
        key:    string;
        value:  LocalOrder;
        indexes: { "by-table": string; "by-status": string };
    };
    waiters: {
        key:    string;
        value:  CachedWaiter;
        indexes: { "by-tenant": string; "by-pin": string };
    };
    pendingSync: {
        key:    number;
        value:  PendingSyncItem;
        indexes: { "by-status": string; "by-createdAt": string; "by-nextRetry": string };
    };
    meta: {
        key:    string;
        value:   MetaValue;
    };
}

const DB_NAME    = "mozona-tpv";
const DB_VERSION = 2;

// ---------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<MozonaDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MozonaDB>> {
    if (typeof indexedDB === "undefined") {
        return Promise.reject(new Error("IndexedDB no está disponible"));
    }
    if (dbPromise) return dbPromise;
    const p = openDB<MozonaDB>(DB_NAME, DB_VERSION, {
        upgrade(db: IDBPDatabase<MozonaDB>, oldVersion: number) {
            // v0 → v1: schema inicial
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains("products")) {
                    const s = db.createObjectStore("products", { keyPath: "id" });
                    s.createIndex("by-category", "category_id");
                }
                if (!db.objectStoreNames.contains("categories")) {
                    const s = db.createObjectStore("categories", { keyPath: "id" });
                    s.createIndex("by-sortOrder", "sort_order");
                }
                if (!db.objectStoreNames.contains("tables")) {
                    const s = db.createObjectStore("tables", { keyPath: "id" });
                    s.createIndex("by-status", "status");
                }
                if (!db.objectStoreNames.contains("orders")) {
                    const s = db.createObjectStore("orders", { keyPath: "id" });
                    s.createIndex("by-table",  "tableId");
                    s.createIndex("by-status", "status");
                }
                if (!db.objectStoreNames.contains("pendingSync")) {
                    const s = db.createObjectStore("pendingSync", {
                        keyPath: "id", autoIncrement: true,
                    });
                    s.createIndex("by-status",     "status");
                    s.createIndex("by-createdAt",  "createdAt");
                    s.createIndex("by-nextRetry",  "nextRetryAt");
                }
                if (!db.objectStoreNames.contains("meta")) {
                    db.createObjectStore("meta", { keyPath: "key" });
                }
            }
            // v1 → v2: añadir store waiters
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains("waiters")) {
                    const s = db.createObjectStore("waiters", { keyPath: "id" });
                    s.createIndex("by-tenant", "tenant_id");
                    s.createIndex("by-pin",    "pin_code", { unique: false });
                }
            }
            // Futuras migraciones: if (oldVersion < 3) { ... }
        },
        blocked() {
            console.warn("[offlineStorage] Otra pestaña está bloqueando la migración");
        },
        blocking() {
            // Cierra la conexión para que la otra pestaña pueda migrar
            if (dbPromise) {
                void dbPromise.then(d => d.close());
                dbPromise = null;
            }
        },
        terminated() {
            dbPromise = null;
        },
    });
    dbPromise = p;
    return p;
}

// ---------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------

export async function putProducts(list: Product[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("products", "readwrite");
    await Promise.all(list.map(p => tx.store.put(p)));
    await tx.done;
}

export async function getAllProducts(): Promise<Product[]> {
    return (await getDB()).getAll("products");
}

export async function getProductById(id: string): Promise<Product | undefined> {
    return (await getDB()).get("products", id);
}

// ---------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------

export async function putCategories(list: Category[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("categories", "readwrite");
    await Promise.all(list.map(c => tx.store.put(c)));
    await tx.done;
}

export async function getAllCategories(): Promise<Category[]> {
    return (await getDB()).getAll("categories");
}

// ---------------------------------------------------------------------
// Mesas
// ---------------------------------------------------------------------

export async function putTables(list: RestaurantTable[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("tables", "readwrite");
    await Promise.all(list.map(t => tx.store.put(t)));
    await tx.done;
}

export async function getAllTables(): Promise<RestaurantTable[]> {
    return (await getDB()).getAll("tables");
}

export async function updateTableStatus(
    id: string, status: RestaurantTable["status"],
): Promise<void> {
    const db = await getDB();
    const t = await db.get("tables", id);
    if (!t) return;
    await db.put("tables", { ...t, status });
}

// ---------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------

export async function putOrder(o: LocalOrder): Promise<void> {
    await (await getDB()).put("orders", o);
}

export async function getOrder(id: string): Promise<LocalOrder | undefined> {
    return (await getDB()).get("orders", id);
}

export async function getOpenOrdersForTable(tableId: string): Promise<LocalOrder[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex("orders", "by-table", tableId);
    return all.filter((o: LocalOrder) => o.status === "OPEN");
}

export async function getAllOpenOrders(): Promise<LocalOrder[]> {
    const db = await getDB();
    const all = await db.getAll("orders");
    return all.filter((o: LocalOrder) => o.status === "OPEN");
}

// ---------------------------------------------------------------------
// Cola de sincronización (outbox)
// ---------------------------------------------------------------------

/** Añade un elemento a la cola de sincronización. */
export async function enqueueSync(
    kind: SyncKind,
    payload: unknown,
): Promise<number> {
    const db = await getDB();
    const now = new Date().toISOString();
    return db.add("pendingSync", {
        kind,
        payload,
        status:      "PENDING",
        attempts:    0,
        createdAt:   now,
        nextRetryAt: now,
    } as PendingSyncItem) as Promise<number>;
}

/** Devuelve los elementos PENDING cuya nextRetryAt ya pasó. */
export async function getReadyPending(limit = 50): Promise<PendingSyncItem[]> {
    const db = await getDB();
    const now = new Date().toISOString();
    const tx = db.transaction("pendingSync", "readonly");
    const idx = tx.store.index("by-status");
    const pending = await idx.getAll("PENDING");
    await tx.done;
    return pending
        .filter((p: PendingSyncItem) => p.nextRetryAt <= now)
        .sort((a: PendingSyncItem, b: PendingSyncItem) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
}

export async function countPending(): Promise<number> {
    const db = await getDB();
    return db.countFromIndex("pendingSync", "by-status", "PENDING");
}

/** Marca un elemento como en curso (SYNCING). */
export async function markSyncing(id: number): Promise<void> {
    const db = await getDB();
    const item = await db.get("pendingSync", id);
    if (!item) return;
    await db.put("pendingSync", { ...item, status: "SYNCING" });
}

/** Marca un elemento como DONE y lo elimina. */
export async function markSyncDone(id: number): Promise<void> {
    await (await getDB()).delete("pendingSync", id);
}

/** Marca un elemento como fallido e incrementa el backoff exponencial. */
export async function markSyncFailed(id: number, error: string): Promise<void> {
    const db = await getDB();
    const item = await db.get("pendingSync", id);
    if (!item) return;

    // Backoff: 1m, 5m, 30m, 2h, 12h, 1d
    const delaysMin = [1, 5, 30, 120, 720, 1440];
    const next = new Date(Date.now()
        + delaysMin[Math.min(item.attempts, delaysMin.length - 1)] * 60_000);

    // Si supera 6 intentos, lo marcamos como CONFLICT (queda en FAILED)
    // y dejamos que un humano lo resuelva.
    const status: SyncStatus = item.attempts + 1 >= 6 ? "FAILED" : "PENDING";

    await db.put("pendingSync", {
        ...item,
        status,
        attempts:    item.attempts + 1,
        lastError:   error,
        nextRetryAt: next.toISOString(),
    });
}

// ---------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------

export async function setMeta(key: string, value: unknown): Promise<void> {
    await (await getDB()).put("meta", { key, value });
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
    const item = await (await getDB()).get("meta", key);
    return item?.value as T | undefined;
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------

/** Borra toda la base de datos. Útil para "Reset local". */
export async function wipeAll(): Promise<void> {
    const db = await getDB();
    await Promise.all([
        db.clear("products"),
        db.clear("categories"),
        db.clear("tables"),
        db.clear("orders"),
        db.clear("pendingSync"),
        db.clear("meta"),
    ]);
}

/** Tamaño aproximado de la base de datos (best-effort). */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

// =====================================================================
// WAITERS — CRUD + caché para validación offline de PIN
// =====================================================================

/** Persiste la lista completa de camareros (reemplaza la anterior). */
export async function putWaiters(tenantId: string, list: Omit<CachedWaiter, "cached_at">[]): Promise<void> {
    const db = await getDB();
    const now = Date.now();
    const tx = db.transaction("waiters", "readwrite");
    // Borrar todos los del tenant
    const idx = tx.store.index("by-tenant");
    let cursor = await idx.openCursor(IDBKeyRange.only(tenantId));
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    // Insertar nuevos
    for (const w of list) {
        await tx.store.put({ ...w, cached_at: now });
    }
    await tx.done;
}

/** Lista todos los camareros de un tenant (cacheados). */
export async function getAllWaiters(tenantId: string): Promise<CachedWaiter[]> {
    const db = await getDB();
    return db.getAllFromIndex("waiters", "by-tenant", tenantId);
}

/** Alias semántico para getAllWaiters. */
export const listCachedWaiters = getAllWaiters;

/** Busca un camarero por PIN dentro de un tenant. */
export async function findWaiterByPin(tenantId: string, pin: string): Promise<CachedWaiter | null> {
    const all = await getAllWaiters(tenantId);
    return all.find(w => w.is_active && w.pin_code === pin) ?? null;
}

/** Añade o actualiza un camarero en la caché. */
export async function putWaiter(w: Omit<CachedWaiter, "cached_at">): Promise<void> {
    const db = await getDB();
    await db.put("waiters", { ...w, cached_at: Date.now() });
}

/** Borra un camarero de la caché. */
export async function deleteWaiter(id: string): Promise<void> {
    const db = await getDB();
    await db.delete("waiters", id);
}

/** Limpia TODAS las tablas de la BD IndexedDB. Usado en cache-bust. */
export async function clearAll(): Promise<void> {
    const db = await getDB();
    const storeNames = Array.from(db.objectStoreNames);
    const tx = db.transaction(storeNames, "readwrite");
    await Promise.all(storeNames.map(name => tx.objectStore(name).clear()));
    await tx.done;
    console.log("[offlineStorage] clearAll: todas las tablas vaciadas");
}
