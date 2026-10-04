// =====================================================================
// MOZONA TPV — /api/business-intelligence (v3.6.0)
// =====================================================================
// DECISION ARQUITECTONICA: Logica de negocio nativa en SQL.
//   - action=restock-drafts: get_restock_drafts() SQL puro
//   - action=profit-insights: get_profit_insights() SQL puro
//   - action=invoice-scan:    IA centralizada (AI_BACKEND_URL)
//   - action=voice-order:     IA centralizada (AI_BACKEND_URL)
//
// CERO latencia IA para Barista y Socio (instantaneo).
// CERO friccion para el cliente: IA corre en NUESTRO servidor.
// =====================================================================

let _securityLib = undefined;
function getSecurity() {
    if (_securityLib !== undefined) return _securityLib;
    try { _securityLib = require("./_security.js");
const ENV = require("./_env.js"); } catch (_) { _securityLib = null; }
    return _securityLib;
}

// ═════════════════════════════════════════════════════════════════════
// ★ v4.0.7-secure: AUTORIZACION DE TENANT
//   - VIP emails (whitelist) pueden acceder a cualquier tenant
//   - Usuarios normales: solo al tenant donde están en tenant_users
//   - Sin sesion o tenant invalido = denegado
// ═════════════════════════════════════════════════════════════════════
const VIP_EMAILS = new Set([
    "chalohiahmd1980@gmail.com",
    "rofixinsta@gmail.com",
]);

function isValidUuid(s) {
    return typeof s === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Extrae el email del usuario del request.
 *   Prioridad: x-user-email header > body.userEmail > query.userEmail
 *   En modo mock (VIP), tambien acepta x-mock-user.
 */
function extractUserEmail(req) {
    return (
        (req.headers?.["x-user-email"] || req.headers?.["X-User-Email"] || "").toString().toLowerCase() ||
        (req.body?.userEmail || "").toString().toLowerCase() ||
        (req.query?.userEmail || "").toString().toLowerCase() ||
        (req.headers?.["x-mock-user"] || "").toString().toLowerCase() ||
        ""
    );
}

/**
 * Verifica que el usuario puede acceder al tenant solicitado.
 * Retorna { ok: true } si pasa, { ok: false, error: "..." } si falla.
 *
 * Reglas:
 *   1. Sin email + sin tenantId valido = 403
 *   2. tenantId no es UUID = 400
 *   3. Email VIP (whitelist) = siempre OK
 *   4. Usuario normal = debe estar en tenant_users para ese tenant
 */
async function authorizeTenantAccess({ userEmail, tenantId, headers, supabaseUrl }) {
    if (!isValidUuid(tenantId)) {
        return { ok: false, status: 400, error: "tenantId invalido (debe ser UUID)" };
    }
    if (!userEmail) {
        return { ok: false, status: 401, error: "Sesion requerida (sin email)" };
    }

    // ★ VIP bypass - emails en whitelist tienen acceso a cualquier tenant
    if (VIP_EMAILS.has(userEmail)) {
        console.log(`[auth] ✓ VIP bypass para ${userEmail} → tenant ${tenantId}`);
        return { ok: true, vip: true };
    }

    // ★ Usuario normal: verificar tenant_users
    try {
        const url = `${supabaseUrl}/rest/v1/tenant_users?user_email=eq.${encodeURIComponent(userEmail)}&tenant_id=eq.${tenantId}&select=id&limit=1`;
        const r = await fetchWithTimeout(url, { headers }, 5000);
        if (r && r.ok) {
            const arr = await r.json();
            if (Array.isArray(arr) && arr.length > 0) {
                console.log(`[auth] ✓ ${userEmail} autorizado para tenant ${tenantId}`);
                return { ok: true, vip: false };
            }
        }
    } catch (e) {
        console.warn("[auth] tenant_users lookup error:", e);
    }

    // ★ Tambien verificar si es owner del tenant (campo owner_id en tenants)
    try {
        const url = `${supabaseUrl}/rest/v1/tenants?id=eq.${tenantId}&select=owner_email,contact_email&limit=1`;
        const r = await fetchWithTimeout(url, { headers }, 5000);
        if (r && r.ok) {
            const arr = await r.json();
            if (Array.isArray(arr) && arr.length > 0) {
                const t = arr[0];
                if (t.owner_email?.toLowerCase() === userEmail
                    || t.contact_email?.toLowerCase() === userEmail) {
                    console.log(`[auth] ✓ ${userEmail} es owner/contact de tenant ${tenantId}`);
                    return { ok: true, vip: false };
                }
            }
        }
    } catch (e) {
        console.warn("[auth] tenant owner lookup error:", e);
    }

    return {
        ok: false,
        status: 403,
        error: "No tienes acceso a este tenant. Inicia sesion con la cuenta correcta.",
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(tid);
        return r;
    } catch (e) {
        clearTimeout(tid);
        return { ok: false, status: 0, error: e };
    }
}

module.exports = async (req, res) => {
    const sec = getSecurity();
    try { if (sec) sec.applySecurityHeaders(res); } catch (_) {}

    // CORS
    try {
        const origin = (req.headers && req.headers.origin) || "";
        const allowed = [
            "https://mozonatpv.site", "https://www.mozonatpv.site",
            "https://mozonatpv.vercel.app", "http://localhost:5173", "http://localhost:4173"
        ];
        if (allowed.indexOf(origin) !== -1) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-tenant-id");
        if (req.method === "OPTIONS") return res.status(200).end();
    } catch (_) {}

    const safeJson = (status, payload) => {
        try { return res.status(status).json(payload); } catch (_) {}
    };

    try {
        const action = (req.query?.action || req.body?.action || "").toString();
        if (!action) return safeJson(200, { ok: false, error: "action requerido" });

        const supabaseUrl = (ENV.SUPABASE_URL || ENV.SUPABASE_URL || "").replace(/\/$/, "");
        const serviceKey = ENV.SUPABASE_SERVICE_ROLE_KEY || "";
        // ★ v3.6.0: IA CENTRALIZADA — apunta a NUESTRO servidor
        const AI_BACKEND_URL = (ENV.AI_BACKEND_URL || "https://ai.mozonatpv.com").replace(/\/$/, "");

        if (!supabaseUrl || !serviceKey) {
            return safeJson(200, { ok: false, error: "Sistema no configurado" });
        }

        // ★ v4.0.7-secure: Validar sesion y tenant ANTES de procesar
        //   Cualquier action (excepto las publicas) requiere autorizacion
        const userEmail = extractUserEmail(req);
        const requestedTenantId = (req.body?.tenantId || req.query?.tenantId || "").toString();

        // Actions publicas (no requieren tenant)
        const PUBLIC_ACTIONS = new Set(["health", "ping"]);
        if (!PUBLIC_ACTIONS.has(action) && requestedTenantId) {
            const auth = await authorizeTenantAccess({
                userEmail,
                tenantId: requestedTenantId,
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                },
                supabaseUrl,
            });
            if (!auth.ok) {
                console.warn(`[biz] ❌ Acceso denegado: ${userEmail || "(sin email)"} → ${requestedTenantId}`);
                return safeJson(auth.status || 403, {
                    ok: false,
                    error: auth.error,
                    hint: "Verifica tu sesion. Si acabas de crear el tenant, espera unos segundos.",
                });
            }
        }

        const headers = {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        };

        // ═════════════════════════════════════════════════════════════
        // 1. 🌌 BARISTA FANTASMA — SQL puro (instantáneo)
        // ═════════════════════════════════════════════════════════════
        if (action === "restock-drafts") {
            const tenantId = (req.body?.tenantId || req.query?.tenantId || "").toString();
            if (!tenantId) return safeJson(200, { ok: false, error: "tenantId requerido" });

            try {
                const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/get_restock_drafts`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ p_tenant_id: tenantId }),
                }, 8000);

                if (!r || !r.ok) {
                    const errText = r ? await r.text() : "no response";
                    return safeJson(200, { ok: false, error: `SQL error: ${errText.slice(0, 200)}`, hint: "Aplica database/39_native_business_logic.sql" });
                }

                const data = await r.json();
                // Guardar borradores en supplier_orders para auditoría
                if (data.orders && data.orders.length > 0) {
                    const inserts = data.orders.map((o) => ({
                        tenant_id: tenantId,
                        supplier_id: o.supplier_id,
                        status: "draft",
                        lines: o.lines,
                        subtotal: parseFloat(o.subtotal),
                        whatsapp_url: o.whatsapp_url,
                        notes: o.message_preview,
                    }));
                    try {
                        await fetchWithTimeout(`${supabaseUrl}/rest/v1/supplier_orders`, {
                            method: "POST",
                            headers,
                            body: JSON.stringify(inserts),
                        }, 5000);
                    } catch (_) {}
                }
                return safeJson(200, { ok: true, ...data, source: "sql_native" });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 2. 👥 SOCIO OCULTO — SQL puro (instantáneo)
        // ═════════════════════════════════════════════════════════════
        if (action === "profit-insights") {
            const tenantId = (req.body?.tenantId || req.query?.tenantId || "").toString();
            if (!tenantId) return safeJson(200, { ok: false, error: "tenantId requerido" });

            try {
                const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/get_profit_insights`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ p_tenant_id: tenantId }),
                }, 8000);

                if (!r || !r.ok) {
                    const errText = r ? await r.text() : "no response";
                    return safeJson(200, { ok: false, error: `SQL error: ${errText.slice(0, 200)}`, hint: "Aplica database/39_native_business_logic.sql" });
                }

                const data = await r.json();
                return safeJson(200, { ok: true, ...data, source: "sql_native" });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 3. 📸 ESCANER FACTURAS — IA CENTRALIZADA (nuestra infra)
        // ═════════════════════════════════════════════════════════════
        if (action === "invoice-scan") {
            if (req.method !== "POST") return safeJson(200, { ok: false, error: "POST requerido" });
            const body = req.body || {};
            const imageBase64 = body.imageBase64 || body.image;
            if (!imageBase64) return safeJson(200, { ok: false, error: "imageBase64 requerido" });

            try {
                // ★ Delegar a NUESTRO backend IA centralizado (sin Ollama local del cliente)
                const r = await fetchWithTimeout(`${AI_BACKEND_URL}/api/vision/invoice`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        image: imageBase64,
                        tenant_id: req.body.tenantId,
                        customer: "mozona",
                    }),
                }, 60000);

                if (!r || !r.ok) {
                    return safeJson(200, {
                        ok: false,
                        error: `IA centralizada no responde (${r?.status || 0}). Contacta soporte.`,
                        ai_backend: AI_BACKEND_URL,
                    });
                }

                const data = await r.json();

                // Log en ai_logs
                try {
                    await fetchWithTimeout(`${supabaseUrl}/rest/v1/ai_logs`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            tenant_id: req.body.tenantId || null,
                            action: "invoice_scan",
                            model: "centralized_llama3.2_vision",
                            latency_ms: data.latency_ms || 0,
                            output_json: data.result || null,
                            status: "ok",
                        }),
                    }, 5000);
                } catch (_) {}

                return safeJson(200, { ok: true, data: data.result || data, model: "centralized_llama3.2_vision" });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 4. 🎙️ VOZ — IA CENTRALIZADA (Whisper nuestro + LLM nuestro)
        // ═════════════════════════════════════════════════════════════
        if (action === "voice-order") {
            if (req.method !== "POST") return safeJson(200, { ok: false, error: "POST requerido" });
            const body = req.body || {};
            const audioBase64 = body.audioBase64 || body.audio;
            if (!audioBase64 && !body.manualText) return safeJson(200, { ok: false, error: "audioBase64 o manualText requerido" });

            try {
                const r = await fetchWithTimeout(`${AI_BACKEND_URL}/api/voice/order`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        audio: audioBase64,
                        manual_text: body.manualText,
                        menu_context: body.menuContext,
                        tenant_id: req.body.tenantId,
                    }),
                }, 60000);

                if (!r || !r.ok) {
                    return safeJson(200, { ok: false, error: `IA voz no responde (${r?.status || 0})` });
                }
                const data = await r.json();

                try {
                    await fetchWithTimeout(`${supabaseUrl}/rest/v1/ai_logs`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            tenant_id: req.body.tenantId || null,
                            action: "voice_order",
                            model: "centralized_whisper+llama",
                            output_json: data,
                            status: "ok",
                        }),
                    }, 5000);
                } catch (_) {}

                return safeJson(200, { ok: true, data, model: "centralized_whisper+llama" });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 5. 📧 OTP — verificacion de email
        //    action=send-otp: genera codigo
        //    action=verify-otp: valida codigo introducido
        // ═════════════════════════════════════════════════════════════
        if (action === "send-otp" || action === "verify-otp") {
            const email = (req.body?.email || req.query?.email || "").toString().trim().toLowerCase();
            if (!email) return safeJson(200, { ok: false, friendly_message: "Necesitamos tu correo electronico" });

            try {
                if (action === "send-otp") {
                    const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/create_otp`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ p_email: email, p_purpose: "signup" }),
                    }, 10000);
                    if (!r || !r.ok) {
                        const errText = r ? await r.text() : "no response";
                        return safeJson(200, { ok: false, friendly_message: "No pudimos enviar el codigo. Reintenta en unos segundos." });
                    }
                    const data = await r.json();
                    // ★ TRADUCIR errores tecnicos a mensajes humanos
                    if (!data.ok) {
                        const friendly = translateOtpError(data.error);
                        return safeJson(200, { ok: false, ...data, friendly_message: friendly });
                    }

                    // ★★ Zero-Tech: enviar email corporativo automáticamente ★★
                    const isVip = data.vip_bypass === true;
                    try {
                        const origin = (req.headers && req.headers.origin) || "https://app.mozonatpv.com";
                        await fetchWithTimeout(`${origin}/api/send-notification`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                type: "email_otp",
                                to: email,
                                code: data.code,
                                subject: "Tu codigo de verificacion - Mozona TPV",
                            }),
                        }, 10000);
                    } catch (_) {
                        // Email no se envio pero OTP esta generado; el frontend puede mostrar el codigo en dev
                    }

                    return safeJson(200, {
                        ok: true,
                        message: isVip
                            ? "Acceso VIP concedido. Entrando..."
                            : `Te enviamos un codigo de 6 digitos a ${email.replace(/(.{2}).*(@.*)/, "$1***$2")}. Revisa tu bandeja.`,
                        code: data.code,
                        vip_bypass: isVip,
                    });
                }

                if (action === "verify-otp") {
                    const code = (req.body?.code || "").toString().trim();
                    if (!code) return safeJson(200, { ok: false, error: "codigo requerido" });
                    const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/verify_otp`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ p_email: email, p_code: code, p_purpose: "signup" }),
                    }, 10000);
                    if (!r || !r.ok) {
                        const errText = r ? await r.text() : "no response";
                        return safeJson(200, { ok: false, error: `SQL error: ${errText.slice(0, 200)}` });
                    }
                    return safeJson(200, await r.json());
                }
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 6. 🌱 SEED MENU — inyectar carta según tipo de negocio
        // ═════════════════════════════════════════════════════════════
        if (action === "seed-menu") {
            const tenantId = (req.body?.tenantId || req.query?.tenantId || "").toString();
            const businessType = (req.body?.businessType || req.query?.businessType || "").toString();
            if (!tenantId) return safeJson(200, { ok: false, error: "tenantId requerido" });
            if (!businessType) return safeJson(200, { ok: false, error: "businessType requerido" });

            try {
                const r = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/seed_menu_for_tenant`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ p_tenant_id: tenantId, p_business_type: businessType }),
                }, 15000);
                if (!r || !r.ok) {
                    const errText = r ? await r.text() : "no response";
                    return safeJson(200, { ok: false, error: `SQL: ${errText.slice(0, 200)}` });
                }
                return safeJson(200, await r.json());
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        // ═════════════════════════════════════════════════════════════
        // 7. 🧠 CHAT CONVERSACIONAL — "Habla con Riyad"
        // ═════════════════════════════════════════════════════════════
        if (action === "chat") {
            const tenantId = (req.body?.tenantId || "").toString();
            const text = (req.body?.text || req.query?.text || "").toString();
            if (!text) return safeJson(200, { ok: false, error: "text requerido" });
            if (!tenantId) return safeJson(200, { ok: false, error: "tenantId requerido" });

            try {
                // 1) Detectar intención via SQL pattern matching
                const intentRes = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/parse_user_intent`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ p_text: text, p_tenant_id: tenantId }),
                }, 5000);
                let intent = null;
                if (intentRes && intentRes.ok) {
                    intent = await intentRes.json();
                }
                if (!intent || intent.intent === "unknown") {
                    return safeJson(200, {
                        ok: true,
                        intent: "unknown",
                        response: "🤔 No estoy seguro de qué quieres decir. Puedo ayudarte con ventas, stock, comandas, mesas y márgenes. ¿Qué necesitas?",
                    });
                }

                // 2) Resolver cada intención con SQL puro
                let responseData = {};
                if (intent.intent === "query_sales") {
                    const period = intent.params?.period || "today";
                    let date_from = NULL;
                    let date_label = "hoy";
                    if (period === "yesterday") { date_from = new Date(Date.now() - 86400000).toISOString(); date_label = "ayer"; }
                    else if (period === "week") { date_from = new Date(Date.now() - 7*86400000).toISOString(); date_label = "esta semana"; }
                    else if (period === "month") { date_from = new Date(Date.now() - 30*86400000).toISOString(); date_label = "este mes"; }
                    else { date_from = new Date(new Date().setHours(0,0,0,0)).toISOString(); }

                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/rest/v1/orders?tenant_id=eq.${tenantId}&created_at=gte.${date_from}&select=total&limit=1000`,
                        { headers }, 5000
                    );
                    if (r && r.ok) {
                        const arr = await r.json();
                        const total = (arr || []).reduce((s, o) => s + Number(o.total || 0), 0);
                        const count = (arr || []).length;
                        responseData = {
                            total_ventas: total.toFixed(2),
                            num_tickets: count,
                            promedio_por_ticket: count > 0 ? (total / count).toFixed(2) : "0.00",
                        };
                    }
                    return safeJson(200, {
                        ok: true,
                        intent: "query_sales",
                        response: `📊 Ventas de ${date_label}: ${count} tickets, total ${total.toFixed(2)}€, promedio por ticket ${count > 0 ? (total/count).toFixed(2) : 0}€.`,
                        data: responseData,
                    });
                }

                if (intent.intent === "query_low_stock") {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/rest/v1/products?tenant_id=eq.${tenantId}&select=id,name,current_stock,min_stock&current_stock=lte.5&limit=20`,
                        { headers }, 5000
                    );
                    if (r && r.ok) {
                        const arr = await r.json();
                        responseData = { low_stock: arr };
                    }
                    return safeJson(200, {
                        ok: true,
                        intent: "query_low_stock",
                        response: (responseData.low_stock?.length || 0) > 0
                            ? `📦 Tienes ${responseData.low_stock.length} productos con stock bajo. Te he preparado pedidos automaticos: revisa Barista Fantasma.`
                            : "✅ No tienes productos por debajo del minimo. Todo en orden.",
                        data: responseData,
                    });
                }

                if (intent.intent === "query_top_products") {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/rest/v1/order_items?tenant_id=eq.${tenantId}&select=product_name,quantity&limit=5000`,
                        { headers }, 5000
                    );
                    if (r && r.ok) {
                        const arr = await r.json();
                        const counts = {};
                        for (const it of arr) {
                            counts[it.product_name] = (counts[it.product_name] || 0) + Number(it.quantity || 0);
                        }
                        const top = Object.entries(counts)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([name, qty]) => ({ name, qty }));
                        responseData = { top };
                        return safeJson(200, {
                            ok: true,
                            intent: "query_top_products",
                            response: top.length > 0
                                ? `🏆 Top ${top.length} productos mas vendidos: ${top.map(t => `${t.name} (${t.qty}u)`).join(", ")}.`
                                : "Aun no hay ventas registradas.",
                            data: responseData,
                        });
                    }
                }

                if (intent.intent === "query_table_stats") {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/rest/v1/dining_tables?tenant_id=eq.${tenantId}&select=status`,
                        { headers }, 5000
                    );
                    if (r && r.ok) {
                        const arr = await r.json();
                        const total = (arr || []).length;
                        const open = (arr || []).filter((t) => t.status === "open" || t.status === "occupied").length;
                        const free = total - open;
                        responseData = { total, open, free };
                        return safeJson(200, {
                            ok: true,
                            intent: "query_table_stats",
                            response: `🪑 ${total} mesas en total: ${open} abiertas, ${free} libres.`,
                            data: responseData,
                        });
                    }
                }

                if (intent.intent === "create_order") {
                    return safeJson(200, {
                        ok: true,
                        intent: "create_order",
                        response: "📝 Tomo nota. Para registrar la comanda, dime: mesa, productos y cantidades. O usa el TPV.",
                        data: { raw_text: text },
                    });
                }

                if (intent.intent === "query_profit") {
                    const r = await fetchWithTimeout(
                        `${supabaseUrl}/rest/v1/rpc/get_profit_insights`,
                        { method: "POST", headers, body: JSON.stringify({ p_tenant_id: tenantId }) },
                        8000
                    );
                    if (r && r.ok) {
                        const data = await r.json();
                        const insights = data?.insights || [];
                        return safeJson(200, {
                            ok: true,
                            intent: "query_profit",
                            response: insights.length > 0
                                ? `📈 Margen medio: ${data.avg_margin_pct}%. ${insights.length} platos necesitan atencion. Revisa Socio Oculto.`
                                : `📈 Margen medio: ${data.avg_margin_pct}%. Todos tus platos tienen margen saludable.`,
                            data: { ...data, top_insights: insights.slice(0, 3) },
                        });
                    }
                }

                return safeJson(200, {
                    ok: true,
                    intent: intent.intent,
                    response: intent.params?.response_text || "Procesado.",
                });
            } catch (e) {
                return safeJson(200, { ok: false, error: e?.message });
            }
        }

        return safeJson(200, { ok: false, error: `action desconocida: ${action}` });
    } catch (e) {
        return safeJson(200, { ok: false, error: e?.message || "Error" });
    }
};

// ★★ Zero-Tech: traducir errores tecnicos a mensajes humanos ★★
function translateOtpError(code) {
    const map = {
        "email_no_valido":      "El formato del correo no es correcto. Revisa que esté bien escrito.",
        "email_no_permitido":   "Por favor, usa un correo electronico real. No aceptamos correos temporales.",
        "codigo_incorrecto":    "El codigo no coincide. Revisa el email y escribelo otra vez.",
        "codigo_invalido_o_expirado": "El codigo ha caducado o ya lo usaste. Te enviamos uno nuevo.",
        "demasiados_intentos":  "Has agotado los intentos. Por seguridad, solicita un codigo nuevo.",
    };
    return map[code] || "Algo no ha salido bien. Vuelve a intentarlo.";
}
