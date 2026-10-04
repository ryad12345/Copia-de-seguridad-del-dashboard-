// =====================================================================
// MOZONA TPV — Supabase Edge Function: admin-ops (v4.0.7-full-control)
// =====================================================================
// Panel admin completo + chat widget.
// TODAS las acciones que el admin puede hacer desde /admin.
//
// Acciones:
//   - list_tenants        → lista con paginación y búsqueda
//   - stats               → contadores por estado
//   - approve_tenant      → aprueba con N días (cálculo REAL de fecha)
//   - reject_tenant       → marca como expired
//   - change_plan         → cambia plan_selected y plan
//   - edit_tenant         → edita nombre, email, tipo
//   - reset_password      → resetea contraseña del usuario
//   - change_email        → cambia el email del usuario
//   - change_credentials  → cambia email + password en una operación
//   - delete_tenant       → ELIMINA el tenant (DELETE real)
//   - extend_trial        → añade días al trial actual
//   - get_tenant          → obtiene detalles de un tenant
//   - chat_query          → chat widget Riyad
//   - send_telegram / audit_log
// =====================================================================

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

// ★ v4.0.7-secure: CORS estricto (whitelist de orígenes)
const ALLOWED_ORIGINS = new Set([
    "https://mozonatpv.site",
    "https://www.mozonatpv.site",
    "https://mozona-tpv-v2-real.pages.dev",
    "http://localhost:5173",
    "http://localhost:4173",
]);

function getCorsHeaders(origin: string | null) {
    const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : Array.from(ALLOWED_ORIGINS)[0];
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name, x-application-version",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

const corsHeaders = getCorsHeaders(null);

const sbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        throw e;
    }
}

const json = (payload: any, status = 200) =>
    new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status,
    });

// ─── HELPERS ────────────────────────────────────────────────────────────────

function daysToIso(days: number): string {
    return new Date(Date.now() + days * 86400000).toISOString();
}

async function auditLog(action: string, targetId: string, payload: any, actorEmail?: string) {
    try {
        await fetchWithTimeout(
            `${SUPABASE_URL}/rest/v1/admin_audit_log`,
            {
                method: "POST",
                headers: sbHeaders,
                body: JSON.stringify({
                    action, target_id: targetId, payload,
                    actor_email: actorEmail || "system",
                    created_at: new Date().toISOString(),
                }),
            },
            5000
        );
    } catch (_) {}
}

async function sendTelegram(text: string, chatId?: string) {
    const target = chatId || ADMIN_CHAT_ID;
    if (!BOT_TOKEN || !target) return { ok: false, error: "Telegram no configurado" };
    const r = await fetchWithTimeout(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: target, text, parse_mode: "Markdown", disable_web_page_preview: true }),
        },
        10000
    );
    return { ok: r.ok, status: r.status };
}

// ─── TENANT OPERATIONS ─────────────────────────────────────────────────────

async function approveTenant(tenantId: string, days: number, approvedBy: string) {
    const trialEndsAt = daysToIso(days);
    const activation = days >= 30 ? "active" : "active_trial";
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({
                activation_status: activation,
                approved_at: new Date().toISOString(),
                approved_by: approvedBy,
                trial_ends_at: trialEndsAt,
                updated_at: new Date().toISOString(),
            }),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, tenantId, trialEndsAt, activation_status: activation };
}

async function rejectTenant(tenantId: string) {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({ activation_status: "expired", updated_at: new Date().toISOString() }),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, tenantId };
}

async function changePlan(tenantId: string, plan: string) {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({
                plan_selected: plan,
                plan: plan,
                updated_at: new Date().toISOString(),
            }),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, tenantId, plan };
}

async function editTenant(tenantId: string, fields: any) {
    const allowed: any = {};
    if (fields.name !== undefined) allowed.name = fields.name;
    if (fields.businessName !== undefined) allowed.business_name = fields.businessName;
    if (fields.contactEmail !== undefined) allowed.contact_email = fields.contactEmail;
    if (fields.businessType !== undefined) allowed.business_type = fields.businessType;
    allowed.updated_at = new Date().toISOString();

    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify(allowed),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, tenantId, fields: allowed };
}

async function extendTrial(tenantId: string, extraDays: number) {
    // ★ Calcular nueva fecha a partir de la actual (si existe) o desde ahora
    //    1) Leer trial_ends_at actual
    //    2) base = max(now, trial_ends_at)
    //    3) new = base + N días
    const cur = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=trial_ends_at,activation_status`,
        { method: "GET", headers: sbHeaders },
        8000
    );
    if (!cur.ok) return { ok: false, error: `HTTP ${cur.status}` };
    const arr = await cur.json().catch(() => []);
    const base = arr?.[0]?.trial_ends_at ? new Date(arr[0].trial_ends_at) : new Date();
    const newEnd = new Date(Math.max(base.getTime(), Date.now()) + extraDays * 86400000);
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({
                trial_ends_at: newEnd.toISOString(),
                activation_status: "active_trial",
                updated_at: new Date().toISOString(),
            }),
        },
        15000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, tenantId, trialEndsAt: newEnd.toISOString(), extraDays };
}

async function listTenants(search: string, status: string) {
    const filters: string[] = [];
    if (status) filters.push(`activation_status=eq.${status}`);
    if (search) {
        const enc = encodeURIComponent(`%${search}%`);
        filters.push(`or=(name.ilike.${enc},contact_email.ilike.${enc},business_name.ilike.${enc})`);
    }
    filters.push("order=created_at.desc");
    filters.push("limit=200");
    const qs = filters.join("&");

    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?${qs}`,
        { method: "GET", headers: { ...sbHeaders, Prefer: "count=exact" } },
        15000
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const data = await r.json().catch(() => []);
    return { ok: true, tenants: data || [], count: (data || []).length };
}

async function getTenant(tenantId: string) {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&limit=1`,
        { method: "GET", headers: sbHeaders },
        10000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => []);
    return { ok: true, tenant: data?.[0] || null };
}

async function getStats() {
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?select=activation_status,plan,trial_ends_at&limit=1000`,
        { method: "GET", headers: { ...sbHeaders, Prefer: "count=exact" } },
        15000
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const data: any[] = (await r.json()) || [];
    const now = Date.now();
    const stats = {
        total: data.length,
        pending: 0,
        trial: 0,
        trialActive: 0,  // trial vigente (no expirado)
        trialExpired: 0,  // trial pero ya pasó
        active: 0,
        vip: 0,
        expired: 0,
    };
    for (const t of data) {
        switch (t.activation_status) {
            case "pending_activation": stats.pending++; break;
            case "active_trial":
                stats.trial++;
                if (t.trial_ends_at && new Date(t.trial_ends_at).getTime() < now) stats.trialExpired++;
                else stats.trialActive++;
                break;
            case "active": stats.active++; break;
            case "vip": stats.vip++; break;
            case "expired": stats.expired++; break;
        }
    }
    return { ok: true, stats };
}

// ─── AUTH OPERATIONS (GoTrue admin) ────────────────────────────────────────

async function findUserByEmail(email: string) {
    // GoTrue admin: GET /auth/v1/admin/users?email=
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
        { method: "GET", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
        10000
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const data = await r.json();
    const users = data?.users || data || [];
    const user = Array.isArray(users) ? users[0] : null;
    if (!user?.id) return { ok: false, error: "Usuario no encontrado" };
    return { ok: true, user };
}

async function resetPasswordByEmail(email: string, newPassword: string) {
    const found = await findUserByEmail(email);
    if (!found.ok) return { ok: false, error: found.error };
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/auth/v1/admin/users/${found.user.id}`,
        {
            method: "PUT",
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ password: newPassword }),
        },
        10000
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { ok: false, error: `Reset falló: HTTP ${r.status} ${t.slice(0, 150)}` };
    }
    return { ok: true, email, userId: found.user.id };
}

async function changeUserEmail(oldEmail: string, newEmail: string) {
    const found = await findUserByEmail(oldEmail);
    if (!found.ok) return { ok: false, error: found.error };
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/auth/v1/admin/users/${found.user.id}`,
        {
            method: "PUT",
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ email: newEmail, email_confirm: true }),
        },
        10000
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { ok: false, error: `Cambio email falló: HTTP ${r.status} ${t.slice(0, 150)}` };
    }
    // Actualizar también contact_email en tenants si coincide
    await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?contact_email=eq.${encodeURIComponent(oldEmail)}`,
        {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({ contact_email: newEmail, updated_at: new Date().toISOString() }),
        },
        8000
    ).catch(() => {});
    return { ok: true, oldEmail, newEmail, userId: found.user.id };
}

async function changeUserCredentials(oldEmail: string, newEmail: string, newPassword: string) {
    const found = await findUserByEmail(oldEmail);
    if (!found.ok) return { ok: false, error: found.error };
    const r = await fetchWithTimeout(
        `${SUPABASE_URL}/auth/v1/admin/users/${found.user.id}`,
        {
            method: "PUT",
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ email: newEmail, email_confirm: true, password: newPassword }),
        },
        10000
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { ok: false, error: `Cambio credenciales falló: HTTP ${r.status} ${t.slice(0, 150)}` };
    }
    return { ok: true, userId: found.user.id, newEmail };
}

// ─── DELETE TENANT (DELETE REAL) ────────────────────────────────────────────

async function deleteTenant(tenantId: string) {
    // 1) Borrar tenant
    const tr = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`,
        { method: "DELETE", headers: sbHeaders },
        15000
    );
    if (!tr.ok) {
        const t = await tr.text().catch(() => "");
        return { ok: false, error: `Delete tenant HTTP ${tr.status}: ${t.slice(0, 200)}` };
    }
    // 2) Borrar tablas asociadas (no falla si no existen)
    const tables = ["sales", "products", "tables", "categories", "customers", "sale_items"];
    const errors: string[] = [];
    for (const tbl of tables) {
        try {
            await fetchWithTimeout(
                `${SUPABASE_URL}/rest/v1/${tbl}?tenant_id=eq.${tenantId}`,
                { method: "DELETE", headers: sbHeaders },
                5000
            );
        } catch (e) {
            errors.push(`${tbl}: ${String(e).slice(0, 50)}`);
        }
    }
    return { ok: true, tenantId, deletedTables: tables, warnings: errors };
}

// ─── CHAT QUERY (Riyad widget) ─────────────────────────────────────────────

async function chatQuery(intent: string, tenantId: string) {
    const sbUrl = `${SUPABASE_URL}/rest/v1`;
    const headers = { ...sbHeaders };

    try {
        if (intent === "query_sales") {
            const r = await fetchWithTimeout(
                `${sbUrl}/sales?tenant_id=eq.${tenantId}&order=created_at.desc&limit=10&select=id,total,created_at`,
                { method: "GET", headers }, 10000
            );
            const sales = r.ok ? await r.json() : [];
            const total = (sales || []).reduce((s: number, x: any) => s + (x.total || 0), 0);
            return { ok: true, intent, response: `📊 Ventas recientes: ${(sales || []).length} tickets, total ${total.toFixed(2)}€.` };
        }
        if (intent === "query_low_stock") {
            const r = await fetchWithTimeout(
                `${sbUrl}/products?tenant_id=eq.${tenantId}&stock=lte.5&select=name,stock&limit=10`,
                { method: "GET", headers }, 10000
            );
            const items = r.ok ? await r.json() : [];
            if (!items.length) return { ok: true, intent, response: "✅ Todo tiene stock suficiente." };
            const txt = items.map((p: any) => `${p.name} (${p.stock || 0})`).join(", ");
            return { ok: true, intent, response: `⚠️ Stock bajo: ${txt}` };
        }
        if (intent === "query_top_products") {
            const r = await fetchWithTimeout(
                `${sbUrl}/sale_items?tenant_id=eq.${tenantId}&order=quantity.desc&limit=10&select=product_name,quantity`,
                { method: "GET", headers }, 10000
            );
            const items = r.ok ? await r.json() : [];
            if (!items.length) return { ok: true, intent, response: "Sin datos de ventas." };
            const txt = items.map((p: any) => `${p.product_name} (${p.quantity})`).join(", ");
            return { ok: true, intent, response: `🏆 Top productos: ${txt}` };
        }
        if (intent === "query_table_stats") {
            const r = await fetchWithTimeout(
                `${sbUrl}/tables?tenant_id=eq.${tenantId}&select=status`,
                { method: "GET", headers }, 10000
            );
            const tables: any[] = r.ok ? await r.json() : [];
            const total = tables.length;
            const free = tables.filter(t => t.status === "free" || t.status === "available").length;
            const occupied = tables.filter(t => t.status === "occupied").length;
            const reserved = tables.filter(t => t.status === "reserved").length;
            return {
                ok: true, intent,
                response: `🪑 Mesas: ${total} total, ${free} libres, ${occupied} ocupadas, ${reserved} reservadas.`,
                data: { total, free, occupied, reserved, open: occupied },
            };
        }
        if (intent === "query_profit") {
            const r = await fetchWithTimeout(
                `${sbUrl}/sales?tenant_id=eq.${tenantId}&select=total,cost&limit=1000`,
                { method: "GET", headers }, 10000
            );
            const sales: any[] = r.ok ? await r.json() : [];
            const revenue = sales.reduce((s: number, x: any) => s + (x.total || 0), 0);
            const cost = sales.reduce((s: number, x: any) => s + (x.cost || 0), 0);
            const profit = revenue - cost;
            return { ok: true, intent, response: `💰 Revenue ${revenue.toFixed(2)}€ - Cost ${cost.toFixed(2)}€ = Profit ${profit.toFixed(2)}€.` };
        }
        if (intent === "greeting") {
            return { ok: true, intent, response: "👋 ¡Hola! Soy RiyadBot. Pregúntame sobre ventas, stock, mesas o beneficios." };
        }
        return { ok: true, intent, response: "🤖 Comandos disponibles: ventas, stock, top productos, mesas, beneficios, hola, ayuda." };
    } catch (e: any) {
        return { ok: false, intent, error: e?.message || String(e) };
    }
}

// ─── MAIN DISPATCHER ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });

    try {
        // ★ v4.0.7-secure: Validación JWT REAL contra Supabase Auth
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!SUPABASE_URL || !SERVICE_KEY) {
            return json({ ok: false, error: "Edge Function no configurada" });
        }

        if (!token) {
            return json({ ok: false, error: "Authorization Bearer token requerido" }, 401);
        }

        const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
        });

        if (!userResp.ok) {
            return json({ ok: false, error: "Token inválido o expirado" }, 401);
        }

        const user: any = await userResp.json();
        const actorEmail = String(user?.email || "").toLowerCase();

        // ★ Whitelist de admins permitidos
        const ALLOWED_ADMINS = ["rofixinsta@gmail.com"];
        if (!ALLOWED_ADMINS.includes(actorEmail)) {
            return json({ ok: false, error: "Acceso denegado: usuario no es admin", actor: actorEmail }, 403);
        }

        const body = await req.json().catch(() => ({}));
        const action = String(body.action || "");

        let result: any;

        switch (action) {
            case "list_tenants":
                result = await listTenants(String(body.search || ""), String(body.status || ""));
                break;
            case "get_tenant": {
                const tenantId = String(body.tenantId || "");
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await getTenant(tenantId);
                break;
            }
            case "stats":
                result = await getStats();
                break;
            case "approve_tenant": {
                const tenantId = String(body.tenantId || "");
                const trialDays = Number(body.trialDays || 7);
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await approveTenant(tenantId, trialDays, actorEmail);
                await auditLog("approve_tenant", tenantId, { result, trialDays }, actorEmail);
                if (result.ok) {
                    await sendTelegram(`✅ *Alta aprobada ${trialDays} días*\n\n🆔 \`${tenantId}\`\n👤 Por: ${actorEmail}\n📅 Expira: ${result.trialEndsAt}`);
                }
                break;
            }
            case "reject_tenant": {
                const tenantId = String(body.tenantId || "");
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await rejectTenant(tenantId);
                await auditLog("reject_tenant", tenantId, { result }, actorEmail);
                break;
            }
            case "change_plan": {
                const tenantId = String(body.tenantId || "");
                const plan = String(body.plan || "basic");
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await changePlan(tenantId, plan);
                await auditLog("change_plan", tenantId, { result, plan }, actorEmail);
                break;
            }
            case "edit_tenant": {
                const tenantId = String(body.tenantId || "");
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await editTenant(tenantId, body);
                await auditLog("edit_tenant", tenantId, { result }, actorEmail);
                break;
            }
            case "reset_password": {
                const email = String(body.email || "");
                const newPassword = String(body.newPassword || "");
                if (!email || !newPassword) return json({ ok: false, error: "email + newPassword requeridos" });
                if (newPassword.length < 6) return json({ ok: false, error: "Password mínimo 6 caracteres" });
                result = await resetPasswordByEmail(email, newPassword);
                await auditLog("reset_password", email, { result }, actorEmail);
                break;
            }
            case "change_email": {
                const oldEmail = String(body.oldEmail || body.email || "");
                const newEmail = String(body.newEmail || "");
                if (!oldEmail || !newEmail) return json({ ok: false, error: "oldEmail + newEmail requeridos" });
                result = await changeUserEmail(oldEmail, newEmail);
                await auditLog("change_email", oldEmail, { result, newEmail }, actorEmail);
                break;
            }
            case "change_credentials": {
                const oldEmail = String(body.oldEmail || body.email || "");
                const newEmail = String(body.newEmail || "");
                const newPassword = String(body.newPassword || "");
                if (!oldEmail || !newEmail || !newPassword) return json({ ok: false, error: "oldEmail + newEmail + newPassword requeridos" });
                if (newPassword.length < 6) return json({ ok: false, error: "Password mínimo 6 caracteres" });
                result = await changeUserCredentials(oldEmail, newEmail, newPassword);
                await auditLog("change_credentials", oldEmail, { result }, actorEmail);
                break;
            }
            case "extend_trial": {
                const tenantId = String(body.tenantId || "");
                const extraDays = Number(body.extraDays || body.days || 7);
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await extendTrial(tenantId, extraDays);
                await auditLog("extend_trial", tenantId, { result, extraDays }, actorEmail);
                break;
            }
            case "delete_tenant": {
                const tenantId = String(body.tenantId || "");
                if (!tenantId) return json({ ok: false, error: "tenantId requerido" });
                result = await deleteTenant(tenantId);
                await auditLog("delete_tenant", tenantId, { result }, actorEmail);
                if (result.ok) {
                    await sendTelegram(`🗑️ *Tenant eliminado*\n\n🆔 \`${tenantId}\`\n👤 Por: ${actorEmail}`);
                }
                break;
            }
            case "send_telegram": {
                const text = String(body.text || "");
                if (!text) return json({ ok: false, error: "text requerido" });
                result = await sendTelegram(text, body.chatId);
                break;
            }
            case "audit_log": {
                await auditLog(String(body.subAction || "manual"), String(body.targetId || ""), body.payload || {}, actorEmail);
                result = { ok: true };
                break;
            }
            case "chat_query": {
                const payload = body.payload || {};
                const intent = String(payload.intent || "help");
                const tenantId = String(payload.tenant_id || "");
                if (!tenantId) return json({ ok: false, error: "tenant_id requerido" });
                result = await chatQuery(intent, tenantId);
                break;
            }
            default:
                return json({ ok: false, error: `Acción no reconocida: ${action}` });
        }

        return json(result);
    } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) });
    }
});
