// =====================================================================
// MOZONA TPV — server/routes.ts
// =====================================================================
// Endpoints REST:
//   GET  /api/health                → health check
//   GET  /api/network-info          → IP local + puerto (para mostrar QR)
//   GET  /api/menu                  → carta completa
//   GET  /api/tables                → mesas y zonas
//   POST /api/orders                → crear pedido (broadcast ORDER_SENT)
//   PATCH /api/tables/:id/status    → cambiar estado de mesa
//   PATCH /api/restaurant           → actualizar datos del restaurante
//
// Auth: header `X-Mozona-Key: <key>` en todos salvo /api/health.
// =====================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "./db.js";
import type { WsManager } from "./ws-manager.js";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

interface MenuRow {
    id:            string;
    name:          string;
    sort_order:    number;
    products:      ProductRow[] | string;
}

interface ProductRow {
    id:            string;
    category_id:   string;
    name:          string;
    description:   string | null;
    price:         string;   // pg devuelve numeric como string
    tax_rate:      string;
    is_available:  boolean;
}

interface TableRow {
    id:            string;
    restaurant_id: string;
    zone_id:       string | null;
    zone:          string | null;
    table_number:  string;
    status:        "FREE" | "OCCUPIED" | "BILL_REQUESTED" | "RESERVED" | "DIRTY";
}

interface OrderItemInput {
    productId: string;
    quantity:  number;
    notes?:    string;
}

interface CreateOrderBody {
    tableId:    string;
    items:      OrderItemInput[];
    waiter:     string;
    notes?:     string;
}

interface UpdateTableStatusBody {
    status:     "FREE" | "OCCUPIED" | "BILL_REQUESTED" | "RESERVED" | "DIRTY";
    changedBy:  string;
}

interface UpdateRestaurantBody {
    business_name?:     string;
    cif_nif?:           string;
    address?:           string;
    phone?:             string | null;
    primary_color?:     string;
    logo_url?:          string | null;
    cover_url?:         string | null;
    ticket_footer_msg?: string;
    default_series?:    string;
}

// ---------------------------------------------------------------------
// Helper: middleware de autenticación
// ---------------------------------------------------------------------

// Comparación constant-time de la API key. Evita timing attacks y
// rechaza longitudes distintas sin cortocircuitar por contenido.
function keysMatch(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

function requireKey(expected: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        // ★ Sólo cabecera `X-Mozona-Key`. Se elimina el fallback por query
        // string (?key=...) para no filtrar la clave en logs, historiales,
        // cabeceras Referer ni caches intermedias.
        const header = req.header("x-mozona-key");
        if (!header || !keysMatch(header, expected)) {
            res.status(401).json({ error: "unauthorized", message: "API key inválida" });
            return;
        }
        next();
    };
}

// ---------------------------------------------------------------------
// Builder del router
// ---------------------------------------------------------------------

export function buildRouter(opts: {
    apiKey:  string;
    ws:      WsManager;
    version: string;
}): Router {
    const r = Router();
    const auth = requireKey(opts.apiKey);

    // ----- /api/health (público) -------------------------------------
    r.get("/api/health", async (_req, res) => {
        try {
            await query("SELECT 1");
            res.json({
                status:    "ok",
                version:   opts.version,
                db:        "ok",
                clients:   opts.ws.listClients().length,
                timestamp: new Date().toISOString(),
            });
        } catch (e) {
            res.status(503).json({
                status: "degraded",
                version: opts.version,
                db: "error",
                error: (e as Error).message,
            });
        }
    });

    // ----- /api/menu ------------------------------------------------
    r.get("/api/menu", auth, async (_req, res, next) => {
        try {
            const result = await query<MenuRow>(`
                SELECT c.id, c.name, c.sort_order,
                       COALESCE(
                           json_agg(
                               json_build_object(
                                   'id', p.id,
                                   'category_id', p.category_id,
                                   'name', p.name,
                                   'description', p.description,
                                   'price', p.price,
                                   'tax_rate', p.tax_rate,
                                   'is_available', p.is_available
                               ) ORDER BY p.name
                           ) FILTER (WHERE p.id IS NOT NULL),
                           '[]'::json
                       ) AS products
                FROM categories c
                LEFT JOIN products p ON p.category_id = c.id
                GROUP BY c.id, c.name, c.sort_order
                ORDER BY c.sort_order, c.name
            `);
            res.json({ categories: result.rows });
        } catch (e) { next(e); }
    });

    // ----- /api/tables ----------------------------------------------
    r.get("/api/tables", auth, async (_req, res, next) => {
        try {
            const result = await query<TableRow>(`
                SELECT t.id, t.restaurant_id, t.zone_id, z.name AS zone,
                       t.table_number, t.status
                FROM tables t
                LEFT JOIN zones z ON z.id = t.zone_id
                ORDER BY z.name NULLS LAST, t.table_number
            `);
            res.json({ tables: result.rows });
        } catch (e) { next(e); }
    });

    // ----- POST /api/orders -----------------------------------------
    r.post("/api/orders", auth, async (req, res, next) => {
        const body = req.body as CreateOrderBody;
        if (!body?.tableId || !Array.isArray(body.items) || body.items.length === 0) {
            res.status(400).json({ error: "validation", message: "tableId e items requeridos" });
            return;
        }

        try {
            const order = await withTransaction(async (client) => {
                // 1) Localizar mesa y restaurante
                const t = await client.query<{
                    restaurant_id: string;
                    table_number:  string;
                }>(`SELECT restaurant_id, table_number FROM tables WHERE id = $1`,
                    [body.tableId]);
                if (t.rows.length === 0) throw new Error("Mesa no encontrada");
                const { restaurant_id, table_number } = t.rows[0];

                // 2) Calcular importes
                let subtotal = 0, taxAmount = 0;
                const lineItems: Array<{
                    productId: string; name: string; quantity: number;
                    unitPrice: number; taxRate: number; notes?: string;
                }> = [];
                for (const it of body.items) {
                    const p = await client.query<{
                        name: string; price: string; tax_rate: string;
                    }>(
                        `SELECT name, price, tax_rate FROM products WHERE id = $1`,
                        [it.productId],
                    );
                    if (p.rows.length === 0) throw new Error(`Producto ${it.productId} no existe`);
                    const { name, price, tax_rate } = p.rows[0];
                    const unitPrice = parseFloat(price);
                    const taxRate   = parseFloat(tax_rate);
                    const lineSub   = unitPrice * it.quantity;
                    subtotal  += lineSub;
                    taxAmount += lineSub * (taxRate / 100);
                    lineItems.push({
                        productId: it.productId, name, quantity: it.quantity,
                        unitPrice, taxRate, notes: it.notes,
                    });
                }
                const total = round2(subtotal + taxAmount);

                // 3) Crear pedido
                const o = await client.query<{ id: string; created_at: string }>(
                    `INSERT INTO orders (restaurant_id, table_id, status)
                     VALUES ($1, $2, 'OPEN')
                     RETURNING id, created_at`,
                    [restaurant_id, body.tableId],
                );
                const orderId = o.rows[0].id;

                // 4) Insertar líneas
                for (const li of lineItems) {
                    await client.query(
                        `INSERT INTO order_items
                            (order_id, product_id, quantity, unit_price, notes)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [orderId, li.productId, li.quantity, li.unitPrice, li.notes ?? null],
                    );
                }

                // 5) Marcar mesa ocupada
                await client.query(
                    `UPDATE tables SET status = 'OCCUPIED' WHERE id = $1`,
                    [body.tableId],
                );

                return {
                    orderId,
                    tableId:     body.tableId,
                    tableNumber: table_number,
                    items:       lineItems.map(li => ({
                        productId: li.productId,
                        name:      li.name,
                        quantity:  li.quantity,
                        unitPrice: li.unitPrice,
                        notes:     li.notes,
                    })),
                    subtotal:  round2(subtotal),
                    taxAmount: round2(taxAmount),
                    total,
                    waiter:    body.waiter,
                    notes:     body.notes,
                };
            });

            // 6) Broadcast WS a todos los demás clientes
            opts.ws.broadcast("ORDER_SENT", {
                orderId:      order.orderId,
                tableId:      order.tableId,
                tableNumber:  order.tableNumber,
                items:        order.items,
                subtotal:     order.subtotal,
                taxAmount:    order.taxAmount,
                total:        order.total,
                waiter:       order.waiter,
                notes:        order.notes,
            });

            // 7) Broadcast del cambio de estado de la mesa
            opts.ws.broadcast("TABLE_STATUS_CHANGED", {
                tableId:        order.tableId,
                tableNumber:    order.tableNumber,
                previousStatus: "FREE",
                newStatus:      "OCCUPIED",
                changedBy:      order.waiter,
            });

            res.status(201).json({ order });
        } catch (e) { next(e); }
    });

    // ----- PATCH /api/tables/:id/status ----------------------------
    r.patch("/api/tables/:id/status", auth, async (req, res, next) => {
        const body = req.body as UpdateTableStatusBody;
        if (!body?.status || !body?.changedBy) {
            res.status(400).json({ error: "validation", message: "status y changedBy requeridos" });
            return;
        }

        try {
            const result = await query<{ table_number: string; previous_status: string }>(`
                UPDATE tables SET status = $1
                WHERE id = $2
                RETURNING table_number,
                    (SELECT status FROM tables WHERE id = $2) AS previous_status
            `, [body.status, req.params.id]);

            if (result.rows.length === 0) {
                res.status(404).json({ error: "not_found" });
                return;
            }

            // Tomamos el estado anterior de una segunda query (RETURNING no soporta
            // OLD en PostgreSQL)
            const prev = await query<{ status: string }>(
                `SELECT status FROM tables WHERE id = $1`,
                [req.params.id],
            );
            const previousStatus = prev.rows[0]?.status ?? body.status;

            opts.ws.broadcast("TABLE_STATUS_CHANGED", {
                tableId:        req.params.id,
                tableNumber:    result.rows[0].table_number,
                previousStatus: previousStatus as UpdateTableStatusBody["status"],
                newStatus:      body.status,
                changedBy:      body.changedBy,
            });

            res.json({ ok: true });
        } catch (e) { next(e); }
    });

    // ----- PATCH /api/restaurant ------------------------------------
    r.patch("/api/restaurant", auth, async (req, res, next) => {
        const body = req.body as UpdateRestaurantBody;
        if (!body || Object.keys(body).length === 0) {
            res.status(400).json({ error: "validation", message: "body vacío" });
            return;
        }
        // Whitelist de campos editables
        const allowed: (keyof UpdateRestaurantBody)[] = [
            "business_name", "cif_nif", "address", "phone",
            "primary_color", "logo_url", "cover_url",
            "ticket_footer_msg", "default_series",
        ];
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        for (const k of allowed) {
            if (body[k] !== undefined) {
                sets.push(`${k} = $${i++}`);
                values.push(body[k]);
            }
        }
        if (sets.length === 0) {
            res.status(400).json({ error: "validation", message: "sin campos editables" });
            return;
        }
        try {
            const sql = `UPDATE restaurants SET ${sets.join(", ")} RETURNING *`;
            const result = await query(sql, values);
            res.json({ restaurant: result.rows[0] });
        } catch (e) { next(e); }
    });

    return r;
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
