// =====================================================================
// MOZONA TPV — Supabase Edge Function: waiter-api (v4.0.8-secure)
// =====================================================================
// API para camareros ligeros (sin cuenta Supabase).
// Usa SERVICE_ROLE_KEY para bypasear RLS y permitir al camarero
// leer productos/mesas y crear comandas.
//
// AUTENTICACIÓN:
//   Header `x-waiter-token`: token firmado = base64(tenant_id:username:exp)
//   Validamos que el (tenant_id, username) exista en tenant_users
//   y que no haya expirado (24h).
//
// HARDENING v4.0.8-secure:
//   - Fail-closed si WAITER_SECRET / SERVICE_ROLE_KEY no están configurados.
//   - Comparación de firma HMAC en tiempo constante (timingSafeEqual).
//   - Rate limiting en login (por username y por IP) contra fuerza bruta de PIN.
//   - create_order verifica que la mesa pertenece al tenant del token.
//   - CORS restringido a allowlist (nunca `*`).
//   - Errores genéricos (sin filtrar mensajes crudos de Postgres).
//
// NOTA DE SEGURIDAD (requiere cambio de esquema, ver resumen):
//   El PIN se delega a la RPC `verify_waiter_login`. Para almacenar el PIN
//   con hash (pgcrypto) en vez de texto plano hace falta migrar
//   tenant_users y dicha RPC. Nunca se devuelve el PIN ni su hash al cliente.
// =====================================================================

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?target=denonext";
import {
    corsHeaders,
    timingSafeEqual,
    rateLimit,
    clientIp,
} from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// ★ WAITER_SECRET debe venir SIEMPRE del entorno. Si falta, NO se usa default:
//   la función responde 503 (fail-closed) en lugar de aceptar tokens forjados.
const WAITER_SECRET = Deno.env.get("WAITER_SECRET") ?? "";
if (!WAITER_SECRET) {
    console.error("[waiter-api] FATAL: WAITER_SECRET no configurado en secrets");
}

const supabase = SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;

function jsonResponse(req: Request, body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(req, "GET, POST, OPTIONS"), "Content-Type": "application/json" },
    });
}

const CONFIG_OK = Boolean(SUPABASE_URL && SERVICE_KEY && WAITER_SECRET && supabase);

// ---------------------------------------------------------------------
// Token: base64(tenant_id|username|exp). HMAC-SHA256 con WAITER_SECRET
// ---------------------------------------------------------------------

async function hmac(secret: string, msg: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): string {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    try {
        return atob(s);
    } catch (e) { return ""; }
}

async function verifyToken(token: string): Promise<{ ok: boolean; tenant_id?: string; username?: string; reason?: string }> {
    if (!WAITER_SECRET) return { ok: false, reason: "server not configured" };
    if (!token) return { ok: false, reason: "missing token" };
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed token" };
    const [payload, sig] = parts;
    const expected = await hmac(WAITER_SECRET, payload);
    // ★ Comparación en tiempo constante.
    if (!timingSafeEqual(expected, sig)) return { ok: false, reason: "bad signature" };
    const decoded = b64urlDecode(payload);
    const fields = decoded.split("|");
    if (fields.length !== 3) return { ok: false, reason: "malformed payload" };
    const [tenant_id, username, expStr] = fields;
    const exp = Number(expStr);
    if (!tenant_id || !username || !exp) return { ok: false, reason: "missing fields" };
    if (Date.now() > exp) return { ok: false, reason: "expired" };
    return { ok: true, tenant_id, username };
}

async function signToken(tenantId: string, username: string, ttlMs = 24 * 60 * 60 * 1000): Promise<string> {
    const exp = Date.now() + ttlMs;
    const payload = btoa(`${tenantId}|${username}|${exp}`)
        .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const sig = await hmac(WAITER_SECRET, payload);
    return `${payload}.${sig}`;
}

// ---------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req, "GET, POST, OPTIONS") });

    // ★ Fail-closed: sin secretos configurados no se procesa nada.
    if (!CONFIG_OK) {
        return jsonResponse(req, { error: "Servicio no disponible" }, 503);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "ping";

    // 1) Ping — solo verifica que el token es válido
    if (action === "ping" && req.method === "GET") {
        const token = req.headers.get("x-waiter-token") ?? "";
        const v = await verifyToken(token);
        if (!v.ok) return jsonResponse(req, { ok: false, error: v.reason }, 401);
        return jsonResponse(req, { ok: true, tenant_id: v.tenant_id, username: v.username });
    }

    // 2) Login — recibe username/pin, devuelve token
    if (action === "login" && req.method === "POST") {
        // ★ Anti fuerza bruta de PIN: por username y por IP.
        const ip = clientIp(req);
        let body: { username?: string; pin?: string; password?: string };
        try { body = await req.json(); } catch { return jsonResponse(req, { error: "invalid json" }, 400); }
        // Aceptar tanto `pin` (nuevo) como `password` (retrocompat)
        const username = (body.username ?? "").trim();
        const pin      = (body.pin ?? body.password ?? "").trim();
        if (!username || !pin) {
            return jsonResponse(req, { error: "username and pin required" }, 400);
        }
        if (
            !rateLimit(`waiter-login:user:${username.toLowerCase()}`, 5, 5 * 60_000) ||
            !rateLimit(`waiter-login:ip:${ip}`, 15, 5 * 60_000)
        ) {
            return jsonResponse(req, { ok: false, error: "demasiados intentos" }, 429);
        }
        // La verificación del PIN es server-side (RPC). El PIN nunca se compara
        // en el Edge Function ni se devuelve; la RPC debe usar hash (ver nota).
        const { data, error } = await supabase.rpc("verify_waiter_login", {
            p_username: username,
            p_pin:      pin,
        });
        if (error || !data?.ok) {
            // Respuesta genérica: no revelar si el usuario existe ni el error crudo.
            return jsonResponse(req, { ok: false, error: "credenciales inválidas" }, 401);
        }
        const token = await signToken(data.tenant_id, username);
        return jsonResponse(req, {
            ok:        true,
            token,
            tenant_id: data.tenant_id,
            name:      data.name,
            role:      data.role,
        });
    }

    // Para el resto: requiere token válido
    const token = req.headers.get("x-waiter-token") ?? "";
    const v = await verifyToken(token);
    if (!v.ok) return jsonResponse(req, { ok: false, error: v.reason }, 401);
    const tenantId = v.tenant_id!;

    // 3) Productos
    if (action === "products" && req.method === "GET") {
        const { data, error } = await supabase
            .from("products")
            .select("id, name, description, price, tax_rate, category_id, image_url, is_active")
            .eq("tenant_id", tenantId)
            .order("name");
        if (error) return jsonResponse(req, { error: "error interno" }, 500);
        return jsonResponse(req, { ok: true, products: data ?? [] });
    }

    // 4) Categorías
    if (action === "categories" && req.method === "GET") {
        const { data, error } = await supabase
            .from("categories")
            .select("id, name, sort_order, color")
            .eq("tenant_id", tenantId)
            .order("sort_order");
        if (error) return jsonResponse(req, { error: "error interno" }, 500);
        return jsonResponse(req, { ok: true, categories: data ?? [] });
    }

    // 5) Mesas
    if (action === "tables" && req.method === "GET") {
        const { data, error } = await supabase
            .from("dining_tables")
            .select("id, name, zone, status, table_number")
            .eq("tenant_id", tenantId)
            .order("zone")
            .order("name");
        if (error) return jsonResponse(req, { error: "error interno" }, 500);
        return jsonResponse(req, { ok: true, tables: data ?? [] });
    }

    // 6) Crear comanda
    if (action === "create_order" && req.method === "POST") {
        let body: { table_id?: string; items?: Array<{ product_id: string; name: string; price: number; quantity: number; notes?: string }> };
        try { body = await req.json(); } catch { return jsonResponse(req, { error: "invalid json" }, 400); }
        if (!body.table_id || !body.items || body.items.length === 0) {
            return jsonResponse(req, { error: "table_id and items required" }, 400);
        }

        // ★ IDOR: verificar que la mesa pertenece al tenant del token.
        const { data: table, error: tErr } = await supabase
            .from("dining_tables")
            .select("id")
            .eq("id", body.table_id)
            .eq("tenant_id", tenantId)
            .maybeSingle();
        if (tErr || !table) {
            return jsonResponse(req, { error: "mesa no encontrada" }, 404);
        }

        let subtotal = 0;
        for (const it of body.items) subtotal += Number(it.price) * Number(it.quantity);

        const { data: order, error: oErr } = await supabase
            .from("orders")
            .insert({
                tenant_id:   tenantId,
                table_id:    body.table_id,
                waiter_name: v.username,
                status:      "sent",
                subtotal,
                tax_total:   0,
                total:       subtotal,
            })
            .select()
            .single();
        if (oErr || !order) return jsonResponse(req, { error: "no se pudo crear la comanda" }, 500);

        const { data: items, error: iErr } = await supabase
            .from("order_items")
            .insert(body.items.map(it => ({
                order_id:   order.id,
                product_id: it.product_id,
                name:       it.name,
                price:      Number(it.price),
                quantity:   Number(it.quantity),
                notes:      it.notes ?? null,
            })))
            .select();
        if (iErr) {
            await supabase.from("orders").delete().eq("id", order.id);
            return jsonResponse(req, { error: "no se pudieron crear los items" }, 500);
        }

        // Marcar mesa como ocupada (siempre acotado al tenant)
        await supabase.from("dining_tables")
            .update({ status: "occupied" })
            .eq("id", body.table_id)
            .eq("tenant_id", tenantId);

        return jsonResponse(req, { ok: true, order, items: items ?? [] });
    }

    // 7) Marcar comanda como pagada
    if (action === "mark_paid" && req.method === "POST") {
        let body: { order_id?: string; payment_method?: string };
        try { body = await req.json(); } catch { return jsonResponse(req, { error: "invalid json" }, 400); }
        if (!body.order_id) return jsonResponse(req, { error: "order_id required" }, 400);

        // Comprobar pertenencia y obtener la mesa antes de actualizar (IDOR-safe).
        const { data: order } = await supabase
            .from("orders")
            .select("id, table_id")
            .eq("id", body.order_id)
            .eq("tenant_id", tenantId)
            .maybeSingle();
        if (!order) return jsonResponse(req, { error: "comanda no encontrada" }, 404);

        const { error } = await supabase
            .from("orders")
            .update({ status: "paid", payment_method: body.payment_method ?? "cash" })
            .eq("id", body.order_id)
            .eq("tenant_id", tenantId);
        if (error) return jsonResponse(req, { error: "no se pudo actualizar la comanda" }, 500);

        // Liberar mesa (acotada al tenant)
        if (order.table_id) {
            await supabase.from("dining_tables")
                .update({ status: "available" })
                .eq("id", order.table_id)
                .eq("tenant_id", tenantId);
        }

        return jsonResponse(req, { ok: true });
    }

    return jsonResponse(req, { error: "unknown action", action }, 400);
});
