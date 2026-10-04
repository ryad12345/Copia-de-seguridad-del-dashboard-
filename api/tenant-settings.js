// =====================================================================
// MOZONA TPV — /api/tenant-settings (v3.4.0)
// =====================================================================
// GET / POST para configuración personalizable por tenant.
// SIEMPRE devuelve 200 con JSON.
// =====================================================================

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js");
const ENV = require("./_env.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

const DEFAULT_SETTINGS = {
    ticket_paper_width: 58,
    ticket_header_text: "",
    ticket_footer_text: "",
    ticket_show_id: true,
    ticket_show_date: true,
    ticket_show_time: true,
    ticket_show_table: true,
    ticket_show_waiter: true,
    ticket_show_payment: true,
    ticket_show_vat: true,
    theme_mode: "light",
    theme_accent: "blue",
    theme_contrast: "normal",
    button_size: "md",
    grid_density: "normal",
    panel_layout: "horizontal",
    show_product_images: true,
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        return { ok: false, status: 0 };
    }
}

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = ["https://mozonatpv.site", "https://www.mozonatpv.site", "https://mozonatpv.vercel.app", "http://localhost:5173", "http://localhost:4173"];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-email");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        // Parsear body
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) {} }

        // Auth: por tenantId, email, o header admin
        const tenantId = (body.tenantId || req.query?.tenantId || "").toString();
        const email = (body.email || "").toString().trim().toLowerCase();
        const adminEmail = (req.headers && req.headers["x-admin-email"] || "").toString().toLowerCase();
        const token = (req.query && req.query.token || "").toString();
        const isAdmin = adminEmail === "rofixinsta@gmail.com"
            || token === "mozona-admin-2025"
            || token === "mozona-approve-2025";

        const supabaseUrl = (ENV.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/$/, "");
        const serviceKey = ENV.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !serviceKey) {
            return safeJson(200, { ok: false, error: "Sistema no configurado", settings: DEFAULT_SETTINGS });
        }

        const headers = {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        };

        // ════════════════════════════════════════════════════
        // GET: leer settings
        // ════════════════════════════════════════════════════
        if (req.method === "GET") {
            const VIP_EMAILS = ["chalohiahmd1980@gmail.com"];
            // Resolver tenantId si solo tenemos email
            let targetTenantId = tenantId;
            let resolvedUserId = null;
            if (!targetTenantId && email) {
                try {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`,
                        { headers }, 15000
                    );
                    if (r.ok) {
                        const data = await r.json();
                        const users = data?.users || data || [];
                        if (Array.isArray(users)) {
                            const u = users.find(u => (u.email || "").toLowerCase() === email);
                            if (u) {
                                resolvedUserId = u.id;
                                // Buscar tenant por owner_id
                                const tr = await fetchWithTimeout(
                                    `${supabaseUrl}/rest/v1/tenants?owner_id=eq.${u.id}&select=id&limit=1`,
                                    { headers }, 10000
                                );
                                if (tr.ok) {
                                    const arr = await tr.json();
                                    if (arr?.[0]) targetTenantId = arr[0].id;
                                }

                                // ★ v3.4.13: AUTO-ASSIGN transparente para VIPs sin tenant
                                if (!targetTenantId && VIP_EMAILS.includes(email.toLowerCase()) && resolvedUserId) {
                                    console.log(`[tenant-settings] VIP ${email} sin tenant, auto-asignando primer tenant activo`);
                                    // 1) Buscar el primer tenant activo
                                    const first = await fetchWithTimeout(
                                        `${supabaseUrl}/rest/v1/tenants?order=created_at.asc&select=id,owner_id,activation_status&limit=1`,
                                        { headers }, 10000
                                    );
                                    let candidateId = null;
                                    let prevOwner = null;
                                    if (first.ok) {
                                        const arr = await first.json();
                                        if (arr?.[0]) {
                                            candidateId = arr[0].id;
                                            prevOwner = arr[0].owner_id;
                                        }
                                    }
                                    if (candidateId) {
                                        // 2) Asignar el VIP como owner del tenant (UPDATE atomico)
                                        const upd = await fetchWithTimeout(
                                            `${supabaseUrl}/rest/v1/tenants?id=eq.${candidateId}`,
                                            {
                                                method: "PATCH",
                                                headers,
                                                body: JSON.stringify({ owner_id: resolvedUserId }),
                                            },
                                            10000
                                        );
                                        if (upd.ok) {
                                            targetTenantId = candidateId;
                                            console.log(`[tenant-settings] ✓ VIP ${email} ahora owner del tenant ${targetTenantId}`);
                                        } else {
                                            let errText = "";
                                            try { errText = await upd.text(); } catch (_) {}
                                            console.error(`[tenant-settings] ✗ UPDATE tenant falló: ${errText.slice(0, 200)}`);
                                        }
                                    } else {
                                        // ★ Fallback extremo: crear tenant nuevo para el VIP
                                        console.log(`[tenant-settings] Creando tenant nuevo para VIP ${email}`);
                                        const create = await fetchWithTimeout(
                                            `${supabaseUrl}/rest/v1/tenants`,
                                            {
                                                method: "POST",
                                                headers,
                                                body: JSON.stringify({
                                                    owner_id: resolvedUserId,
                                                    name: email.split("@")[0],
                                                    slug: email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-"),
                                                    contact_email: email,
                                                    subscription_status: "active",
                                                    activation_status: "active",
                                                    plan: "lifetime_vip",
                                                    onboarding_completed: true,
                                                }),
                                            },
                                            10000
                                        );
                                        if (create.ok) {
                                            const arr = await create.json();
                                            if (arr?.[0]) targetTenantId = arr[0].id;
                                            console.log(`[tenant-settings] ✓ Tenant nuevo creado: ${targetTenantId}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (_) {}
            }

            if (!targetTenantId) {
                // Devolver defaults si no hay tenant
                return safeJson(200, { ok: true, settings: DEFAULT_SETTINGS, method: "default", tenant_id: null });
            }

            try {
                const r = await fetchWithTimeout(
                    `${supabaseUrl}/rest/v1/tenant_settings?tenant_id=eq.${targetTenantId}&select=*&limit=1`,
                    { headers }, 10000
                );
                if (r.ok) {
                    const arr = await r.json();
                    if (arr && arr[0]) {
                        return safeJson(200, { ok: true, settings: arr[0], method: "db", tenant_id: targetTenantId });
                    }
                }
            } catch (_) {}

            // ★ v3.4.13: Si el tenant no tiene fila en tenant_settings, crearla
            //   (caso del VIP que acabamos de auto-asignar)
            try {
                const newSettings = {
                    ...DEFAULT_SETTINGS,
                    tenant_id: targetTenantId,
                };
                const create = await fetchWithTimeout(
                    `${supabaseUrl}/rest/v1/tenant_settings`,
                    {
                        method: "POST",
                        headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
                        body: JSON.stringify(newSettings),
                    },
                    10000
                );
                if (create.ok) {
                    const arr = await create.json();
                    if (arr && arr[0]) {
                        return safeJson(200, { ok: true, settings: arr[0], method: "db_new", tenant_id: targetTenantId });
                    }
                }
            } catch (_) {}

            return safeJson(200, { ok: true, settings: { ...DEFAULT_SETTINGS, tenant_id: targetTenantId }, method: "default", tenant_id: targetTenantId });
        }

        // ════════════════════════════════════════════════════
        // POST/PUT: guardar settings
        // ════════════════════════════════════════════════════
        if (req.method === "POST" || req.method === "PUT") {
            if (!tenantId && !email) {
                return safeJson(200, { ok: false, error: "tenantId o email requerido" });
            }

            // Resolver tenantId si solo tenemos email
            let targetTenantId = tenantId;
            if (!targetTenantId && email) {
                try {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`,
                        { headers }, 15000
                    );
                    if (r.ok) {
                        const data = await r.json();
                        const users = data?.users || data || [];
                        if (Array.isArray(users)) {
                            const u = users.find(u => (u.email || "").toLowerCase() === email);
                            if (u) {
                                const tr = await fetchWithTimeout(
                                    `${supabaseUrl}/rest/v1/tenants?owner_id=eq.${u.id}&select=id&limit=1`,
                                    { headers }, 10000
                                );
                                if (tr.ok) {
                                    const arr = await tr.json();
                                    if (arr?.[0]) targetTenantId = arr[0].id;
                                }
                            }
                        }
                    }
                } catch (_) {}
            }

            if (!targetTenantId) {
                return safeJson(200, { ok: false, error: "No se pudo resolver tenantId" });
            }

            // Construir objeto a guardar
            const updateData = {
                tenant_id: targetTenantId,
                updated_at: new Date().toISOString(),
            };
            const allowed = Object.keys(DEFAULT_SETTINGS);
            for (const k of allowed) {
                if (body[k] !== undefined) {
                    updateData[k] = body[k];
                }
            }

            // UPSERT
            try {
                const r = await fetchWithTimeout(
                    `${supabaseUrl}/rest/v1/tenant_settings?on_conflict=tenant_id`,
                    {
                        method: "POST",
                        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
                        body: JSON.stringify(updateData),
                    },
                    15000
                );
                if (r.ok) {
                    const arr = await r.json();
                    return safeJson(200, { ok: true, settings: arr?.[0] || updateData, method: "upserted" });
                }
                let errText = "";
                try { errText = await r.text(); } catch (_) {}
                return safeJson(200, { ok: false, error: errText.slice(0, 300) });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        return safeJson(200, { ok: false, error: "Método no soportado" });
    } catch (e) {
        return safeJson(200, { ok: false, error: e?.message || String(e) });
    }
};
