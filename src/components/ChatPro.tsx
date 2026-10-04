// =====================================================================
// MOZONA TPV — ChatPro (v4.0.7-realdb) "Habla con Riyad"
// =====================================================================
// Asistente conversacional flotante.
//
// Conecta con /api/business-intelligence?action=chat
// usa SQL puro (parse_user_intent + queries directas).
//
// ★ v4.0.7-realdb: Si el backend devuelve fallback_to_client,
//   ejecuta queries REALES directamente en Supabase con el tenant_id
//   del usuario autenticado. NUNCA devuelve datos mock.
//
// UI Dark Premium. Mensajes siempre en lenguaje humano.
// VIP bypass automatico en backend.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiJson } from "../lib/api-router";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { chatQuery } from "../lib/chatApi";
import { getHomeRouteForEmail } from "../lib/vip";

// ★ Rutas donde el ChatPro NO debe mostrarse (publicas y de autenticacion)
const HIDDEN_ROUTES = new Set(["/auth", "/", "/reset-password", "/register", "/waiter/login", "/setup-caja"]);

// ★ Quick replies contextuales (Zero-Tech, humano)
const QUICK_REPLIES: Array<{ id: string; label: string; icon: string; prompt: string }> = [
    { id: "sales-today",   label: "Ventas de hoy",         icon: "💰", prompt: "¿Cómo han ido las ventas hoy?" },
    { id: "low-stock",     label: "Stock bajo",            icon: "📦", prompt: "¿Qué productos tienen stock bajo?" },
    { id: "tables",        label: "¿Cómo van las mesas?",  icon: "🪑", prompt: "Estado de las mesas ahora" },
    { id: "profit",        label: "Rentabilidad",          icon: "📈", prompt: "¿Cómo va la rentabilidad de mis platos?" },
    { id: "top",           label: "Lo más vendido",        icon: "🏆", prompt: "¿Qué es lo que más se vende?" },
    { id: "help",          label: "Ayuda",                 icon: "❓", prompt: "¿En qué me puedes ayudar?" },
];

interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    quickReplies?: Array<{ id: string; label: string; prompt: string }>;
    data?: any;
}

const WELCOME: ChatMessage = {
    id: "welcome",
    role: "assistant",
    timestamp: Date.now(),
    content: "¡Hola! Soy Riyad. Pregúntame lo que quieras sobre tu local: ventas, stock, comandas o márgenes. Sin tecnicismos.",
};

// ═════════════════════════════════════════════════════════════════════
// ★ v4.0.7-realdb: Parser de intenciones en cliente (regex)
//   Cuando el backend devuelve fallback_to_client=true,
//   ejecutamos las queries REALES directamente en Supabase.
// ═════════════════════════════════════════════════════════════════════

type Intent = "query_sales" | "query_low_stock" | "query_top_products" | "query_table_stats" | "query_profit" | "greeting" | "help" | "unknown";

interface IntentResult {
    intent: Intent;
    params?: { period?: "today" | "yesterday" | "week" | "month" };
}

function parseIntentLocal(text: string): IntentResult {
    const t = (text || "").toLowerCase().trim();

    if (/^hola|^buen[oa]s|^saludos|^qu[eé]\s*tal/.test(t)) return { intent: "greeting" };
    if (/ayuda|qu[eé]\s*puedes|qu[eé]\s*sabes/.test(t)) return { intent: "help" };

    if (/v[ei]nt[ae]s/.test(t)) {
        let period: any = "today";
        if (/ayer/.test(t)) period = "yesterday";
        else if (/semana/.test(t)) period = "week";
        else if (/mes/.test(t)) period = "month";
        return { intent: "query_sales", params: { period } };
    }

    if (/stock|reponer|baj[ao]/.test(t)) return { intent: "query_low_stock" };
    if (/m[áa]s\s*vend|top|popular|estrella/.test(t)) return { intent: "query_top_products" };
    if (/mesa/.test(t)) return { intent: "query_table_stats" };
    if (/margen|rentab|profit|ganancia/.test(t)) return { intent: "query_profit" };

    return { intent: "unknown" };
}

/**
 * Ejecuta query REAL contra Supabase con tenant_id.
 * Esta función se usa cuando el backend no responde.
 */
async function executeRealQuery(tenantId: string, intent: Intent, params: any = {}): Promise<any> {
    if (!isSupabaseConfigured || !supabase) {
        return {
            ok: false,
            intent,
            response: "No puedo acceder a tu base de datos ahora mismo. Intenta en unos segundos.",
        };
    }

    try {
        if (intent === "query_sales") {
            const period = params.period || "today";
            let date_from = new Date(new Date().setHours(0,0,0,0)).toISOString();
            let date_label = "hoy";
            if (period === "yesterday") {
                date_from = new Date(Date.now() - 86400000).toISOString();
                date_label = "ayer";
            } else if (period === "week") {
                date_from = new Date(Date.now() - 7*86400000).toISOString();
                date_label = "esta semana";
            } else if (period === "month") {
                date_from = new Date(Date.now() - 30*86400000).toISOString();
                date_label = "este mes";
            }

            const { data, error } = await supabase
                .from("orders")
                .select("id, total, created_at")
                .eq("tenant_id", tenantId)
                .gte("created_at", date_from)
                .limit(1000);

            if (error) throw new Error(error.message);

            const arr = data || [];
            const total = arr.reduce((s, o) => s + Number(o.total || 0), 0);
            const count = arr.length;
            const avg = count > 0 ? total / count : 0;

            return {
                ok: true,
                intent: "query_sales",
                response: count > 0
                    ? `📊 Ventas de ${date_label}: ${count} tickets, ${total.toFixed(2)}€ en total, promedio ${avg.toFixed(2)}€ por ticket.`
                    : `📊 ${date_label.charAt(0).toUpperCase() + date_label.slice(1)} aún no hay ventas registradas.`,
                data: {
                    total_ventas: total.toFixed(2),
                    num_tickets: count,
                    promedio_por_ticket: avg.toFixed(2),
                    periodo: date_label,
                },
            };
        }

        if (intent === "query_low_stock") {
            // ★ La tabla products NO tiene current_stock (solo is_active)
            //   Productos NO disponibles = "sin stock" o desactivados
            const { data, error } = await supabase
                .from("products")
                .select("id, name, is_active, is_available")
                .eq("tenant_id", tenantId)
                .or("is_active.eq.false,is_available.eq.false")
                .limit(20);

            if (error) throw new Error(error.message);

            const arr = data || [];
            if (arr.length === 0) {
                // Si no hay productos desactivados, mostrar total de productos
                const { count } = await supabase
                    .from("products")
                    .select("*", { count: "exact", head: true })
                    .eq("tenant_id", tenantId);
                return {
                    ok: true,
                    intent: "query_low_stock",
                    response: `✅ Tienes ${count ?? 0} producto(s) en tu carta y todos están disponibles. La gestión detallada de stock por unidades requiere actualizar el módulo de inventario.`,
                    data: { total_products: count, low_stock: [] },
                };
            }

            return {
                ok: true,
                intent: "query_low_stock",
                response: `📦 Tienes ${arr.length} producto(s) no disponible(s): ${arr.slice(0, 5).map(p => p.name).join(", ")}. Revisa si necesitas reponer o reactivar.`,
                data: { low_stock: arr },
            };
        }

        if (intent === "query_top_products") {
            // ★ v4.0.7-fix: order_items NO tiene tenant_id ni product_name.
            //   Tiene 'name' (nombre del producto) y 'order_id' (FK a orders).
            //   Hacemos 2 queries:
            //   1) Obtener IDs de orders del tenant
            //   2) Obtener order_items filtrados por order_id IN (...)
            const { data: ordersData, error: ordersErr } = await supabase
                .from("orders")
                .select("id")
                .eq("tenant_id", tenantId)
                .limit(5000);

            if (ordersErr) throw new Error(ordersErr.message);

            const orderIds = (ordersData || []).map(o => o.id);
            if (orderIds.length === 0) {
                return {
                    ok: true,
                    intent: "query_top_products",
                    response: "📊 Aún no hay ventas registradas en tu local.",
                    data: { top: [] },
                };
            }

            const { data: itemsData, error: itemsErr } = await supabase
                .from("order_items")
                .select("name, quantity, price")
                .in("order_id", orderIds.slice(0, 100))    // ★ límite para URLs razonables
                .limit(5000);

            if (itemsErr) throw new Error(itemsErr.message);

            const counts: Record<string, { qty: number; revenue: number }> = {};
            for (const it of itemsData || []) {
                const name = it.name || "Sin nombre";
                const qty = Number(it.quantity || 0);
                const price = Number(it.price || 0);
                if (!counts[name]) counts[name] = { qty: 0, revenue: 0 };
                counts[name].qty += qty;
                counts[name].revenue += qty * price;
            }
            const top = Object.entries(counts)
                .sort((a, b) => b[1].qty - a[1].qty)
                .slice(0, 5)
                .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue.toFixed(2) }));

            return {
                ok: true,
                intent: "query_top_products",
                response: top.length > 0
                    ? `🏆 Top ${top.length} más vendido(s): ${top.map((t, i) => `${i+1}) ${t.name} (${t.qty} uds, ${parseFloat(t.revenue).toFixed(2)}€)`).join(", ")}.`
                    : "Aún no hay productos vendidos.",
                data: { top },
            };
        }

        if (intent === "query_table_stats") {
            // ★ v4.0.7-tables: Sincronizar con la vista del TPV.
            //   El TPV muestra 16 mesas por defecto (rellena con dummy locales si la BD tiene menos).
            //   Para determinar mesas abiertas, contamos órdenes ACTIVAS (status IN sent/open/draft)
            //   con table_id no nulo del tenant.

            // 1) Mesas reales en BD
            const { data: tablesData, error: tablesErr } = await supabase
                .from("dining_tables")
                .select("id, name, status")
                .eq("tenant_id", tenantId);

            if (tablesErr) throw new Error(tablesErr.message);
            const dbTables = tablesData || [];
            const dbTotal = dbTables.length;

            // 2) Órdenes activas con mesa asignada (no cerradas)
            const { data: ordersData, error: ordersErr } = await supabase
                .from("orders")
                .select("id, table_id, status")
                .eq("tenant_id", tenantId)
                .in("status", ["draft", "open", "sent"])
                .not("table_id", "is", null);

            if (ordersErr) throw new Error(ordersErr.message);
            const activeOrders = ordersData || [];
            const occupiedTableIds = new Set(activeOrders.map(o => o.table_id));

            // 3) TPV por defecto muestra 16 mesas (constante en PosTerminalPro.tsx línea 738)
            const TPV_DEFAULT_TABLES = 16;
            const total = Math.max(dbTotal, TPV_DEFAULT_TABLES);

            // Mesas ocupadas:
            //   - De BD: si su id está en occupiedTableIds
            //   - Dummy locales: 1 activa por cada orden activa que tenga un table_id
            //     que NO esté en dbTables (mesa dummy virtual)
            const dbOccupied = dbTables.filter(t => occupiedTableIds.has(t.id)).length;
            const virtualOccupied = dbTotal === 0
                ? Math.min(activeOrders.length, TPV_DEFAULT_TABLES)  // si no hay mesas en BD, todas las órdenes son virtuales
                : Math.max(0, activeOrders.length - dbOccupied);
            const occupied = Math.min(total, dbOccupied + virtualOccupied);
            const free = Math.max(0, total - occupied);

            return {
                ok: true,
                intent: "query_table_stats",
                response: `🪑 Tienes ${total} mesa(s) en total (como ve el cajero): ${occupied} abierta(s) con comanda activa, ${free} libre(s). ${
                    dbTotal < total ? `(Solo ${dbTotal} en BD, el resto las genera el TPV automáticamente.)` : ""
                }`,
                data: {
                    total,
                    occupied,
                    free,
                    in_db: dbTotal,
                    tpv_visible: total,
                    active_orders: activeOrders.length,
                },
            };
        }

        if (intent === "greeting") {
            return {
                ok: true,
                intent: "greeting",
                response: "¡Hola! Soy Riyad. Puedo ayudarte con ventas, stock bajo, mesas, top productos o rentabilidad. ¿Qué necesitas?",
            };
        }

        if (intent === "help") {
            return {
                ok: true,
                intent: "help",
                response: "Puedo responder preguntas sobre:\n• Ventas (hoy, ayer, semana, mes)\n• Stock bajo de productos\n• Estado de las mesas\n• Lo más vendido\n• Márgenes y rentabilidad",
            };
        }

        return {
            ok: true,
            intent: "unknown",
            response: "🤔 No estoy seguro de qué quieres decir. Pregúntame sobre ventas, stock, mesas, top productos o márgenes.",
        };
    } catch (e) {
        console.warn("[ChatPro] Query error (solo consola):", e);
        return {
            ok: false,
            intent,
            response: "Ahora mismo no puedo consultar tu información. Por favor, inténtalo de nuevo en unos segundos.",
        };
    }
}

export function ChatPro() {
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [unread, setUnread] = useState(0);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // ★ Todos los useEffect deben ir ANTES de cualquier return temprano
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, open]);

    useEffect(() => {
        if (!open) return;
        setUnread(0);
    }, [open]);

    // ★ Escuchar eventos globales openAssistant()/closeAssistant()
    useEffect(() => {
        const openHandler = () => setOpen(true);
        const closeHandler = () => setOpen(false);
        window.addEventListener("mozona:open-assistant", openHandler);
        window.addEventListener("mozona:close-assistant", closeHandler);
        return () => {
            window.removeEventListener("mozona:open-assistant", openHandler);
            window.removeEventListener("mozona:close-assistant", closeHandler);
        };
    }, []);

    // ★ Solo mostrar si hay sesion Y NO estamos en ruta publica
    if (!auth.user) return null;
    if (HIDDEN_ROUTES.has(location.pathname)) return null;

    // ★ Enviar mensaje al backend
    const send = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;

        setMessages(prev => [
            ...prev,
            {
                id: `u-${Date.now()}`,
                role: "user",
                content: trimmed,
                timestamp: Date.now(),
            },
        ]);
        setDraft("");
        setBusy(true);

        try {
            // ★ v4.0.7-secure: Validar sesion antes de enviar
            if (!auth.user) {
                throw new Error("Inicia sesión para usar el asistente.");
            }
            if (!auth.tenant?.id || auth.tenant.id === "vip-bypass") {
                throw new Error("Por favor, recarga la página para continuar.");
            }

            let json: any = null;

            // ★ Intentar backend primero
            try {
                // ★ v4.6.0: la identidad se toma del JWT en el servidor
                //   (Authorization Bearer). Ya NO se envían `x-user-email`
                //   ni `userEmail` (spoofables y ahora ignorados).
                const { getUserJwt } = await import("../lib/auth-helpers");
                const jwt = getUserJwt();
                json = await apiJson("business-intelligence?action=chat", {
                    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
                    body: {
                        text: trimmed,
                        tenantId: auth.tenant.id,
                    },
                });
            } catch (e) {
                console.warn("[ChatPro] Backend no responde, usando fallback de cliente con Supabase directo");
                json = null;
            }

            // ★ v4.0.7-chat-secure: Primero intenta Edge Function (vía admin-ops),
            //   fallback a query directa solo si Edge Function no responde
            if (!json || json.fallback_to_client || json.ok === false) {
                const parsed = parseIntentLocal(trimmed);
                console.log("[ChatPro] query:", parsed.intent);
                // ★ v4.0.7-chat-secure: usa chatApi.ts que prioriza Edge Function
                const chatResult = await chatQuery(parsed.intent, parsed.params);
                json = {
                    ok: chatResult.ok,
                    intent: chatResult.intent,
                    response: chatResult.response,
                    data: chatResult.data,
                    source: chatResult.source,  // "edge_function" | "direct" | "error"
                };
            }

            // ★ Si el backend rechaza por autorizacion, mostrar mensaje claro
            if (json && json.ok === false && (json.error?.includes("acceso") || json.error?.includes("sesion") || json.error?.includes("tenant"))) {
                throw new Error("Por favor, recarga la página para continuar.");
            }

            const assistantMsg: ChatMessage = {
                id: `a-${Date.now()}`,
                role: "assistant",
                timestamp: Date.now(),
                content: json.response || json.friendly_message || "Disculpa, ahora mismo no puedo responder a tu pregunta. Inténtalo de nuevo en unos segundos.",
                data: json.data,
            };

            // Acciones contextuales segun la intencion detectada
            if (json.intent === "query_low_stock" && json.data?.low_stock?.length > 0) {
                assistantMsg.quickReplies = [
                    { id: "open-reposicion", label: "🌌 Preparar reposición", prompt: "preparar reposición automática" },
                ];
            } else if (json.intent === "query_profit" && json.data?.insights_count > 0) {
                assistantMsg.quickReplies = [
                    { id: "open-profit", label: "📈 Ver análisis completo", prompt: "ver análisis completo de márgenes" },
                ];
            } else if (json.intent === "create_order") {
                assistantMsg.quickReplies = [
                    { id: "open-tpv", label: "🛒 Ir al TPV", prompt: "ir al TPV" },
                ];
            }

            setMessages(prev => [...prev, assistantMsg]);
            if (!open) setUnread(u => u + 1);
        } catch (e: any) {
            setMessages(prev => [...prev, {
                id: `e-${Date.now()}`,
                role: "system",
                content: "El servicio no responde ahora mismo. Vuelve a intentarlo en unos segundos.",
                timestamp: Date.now(),
            }]);
        }
        setBusy(false);
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    // ★ Acciones contextuales (botones que navegan)
    const handleQuickAction = (id: string) => {
        if (id === "open-tpv") {
            setOpen(false);
            // ★ v4.5.11: ruta según rol
            const email = (auth?.user as any)?.email || "";
            navigate(getHomeRouteForEmail(email, !!auth?.user));
        } else if (id === "open-reposicion") {
            setOpen(false);
            navigate("/ai-studio?tab=suppliers");
        } else if (id === "open-profit") {
            setOpen(false);
            navigate("/ai-studio?tab=profit");
        }
    };

    // ★ Detectar si el mensaje es un CTA (link interno)
    const renderContent = (msg: ChatMessage) => {
        // Quick replies contextuales que son NAVEGACION
        if (msg.quickReplies && msg.data) {
            return (
                <>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    {renderDataSummary(msg.data, msg.role)}
                    <div className="mt-3 flex flex-wrap gap-2">
                        {msg.quickReplies.map(qr => (
                            <button
                                key={qr.id}
                                onClick={() => handleQuickAction(qr.id)}
                                className="px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-[11.5px] font-bold shadow-md hover:shadow-lg transition"
                            >
                                {qr.label}
                            </button>
                        ))}
                    </div>
                </>
            );
        }
        // Mensaje con datos estructurados
        if (msg.data) {
            return (
                <>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    {renderDataSummary(msg.data, msg.role)}
                </>
            );
        }
        return <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>;
    };

    const renderDataSummary = (data: any, role: string) => {
        if (!data) return null;
        const bgColor = role === "user" ? "bg-blue-700/30" : "bg-slate-800/60";

        // Ventas
        if (data.total_ventas !== undefined) {
            return (
                <div className={`mt-3 p-3 rounded-lg ${bgColor} space-y-1`}>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Tickets</span>
                        <span className="font-black">{data.num_tickets}</span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Total</span>
                        <span className="font-black text-emerald-400">{data.total_ventas}€</span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Promedio/ticket</span>
                        <span className="font-black">{data.promedio_por_ticket}€</span>
                    </div>
                </div>
            );
        }

        // Mesas
        if (data.total !== undefined && data.open !== undefined) {
            return (
                <div className={`mt-3 p-3 rounded-lg ${bgColor} space-y-1`}>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Mesas totales</span>
                        <span className="font-black">{data.total}</span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Abiertas</span>
                        <span className="font-black text-amber-400">{data.open}</span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Libres</span>
                        <span className="font-black text-emerald-400">{data.free}</span>
                    </div>
                </div>
            );
        }

        // Top productos
        if (data.top && Array.isArray(data.top)) {
            return (
                <div className={`mt-3 p-3 rounded-lg ${bgColor} space-y-1`}>
                    <div className="text-[10.5px] uppercase tracking-widest opacity-70 mb-1">Top 5 productos</div>
                    {data.top.map((p: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11.5px]">
                            <span className="truncate">{p.name}</span>
                            <span className="font-black ml-2">{p.qty}u</span>
                        </div>
                    ))}
                </div>
            );
        }

        // Stock bajo (lista resumida)
        if (data.low_stock && Array.isArray(data.low_stock)) {
            return (
                <div className={`mt-3 p-3 rounded-lg ${bgColor} space-y-1`}>
                    <div className="text-[10.5px] uppercase tracking-widest opacity-70 mb-1">Productos con stock bajo</div>
                    {data.low_stock.slice(0, 5).map((p: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11.5px]">
                            <span className="truncate">{p.name}</span>
                            <span className="text-rose-400 font-bold ml-2">{p.current_stock}/{p.min_stock}</span>
                        </div>
                    ))}
                    {data.low_stock.length > 5 && (
                        <div className="text-[10.5px] opacity-60 mt-1">y {data.low_stock.length - 5} más...</div>
                    )}
                </div>
            );
        }

        // Profit insights
        if (data.avg_margin_pct !== undefined) {
            return (
                <div className={`mt-3 p-3 rounded-lg ${bgColor} space-y-1`}>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Margen medio</span>
                        <span className={`font-black ${Number(data.avg_margin_pct) >= 60 ? "text-emerald-400" : Number(data.avg_margin_pct) >= 40 ? "text-amber-400" : "text-rose-400"}`}>
                            {data.avg_margin_pct}%
                        </span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                        <span className="opacity-70">Platos con atención</span>
                        <span className="font-black">{data.insights_count}</span>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <>
            {/* ★ FAB (Floating Action Button) */}
            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className="fixed bottom-20 right-5 sm:right-8 z-50 group"
                    aria-label="Abrir chat con Riyad"
                >
                    <div className="relative">
                        {/* Pulso animado */}
                        <div className="absolute inset-0 bg-violet-600 rounded-full animate-ping opacity-30" />
                        <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 shadow-2xl flex items-center justify-center text-white text-2xl group-hover:scale-110 transition-transform">
                            💬
                        </div>
                        {unread > 0 && (
                            <div className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow-md">
                                {unread}
                            </div>
                        )}
                    </div>
                </button>
            )}

            {/* ★ Panel de chat */}
            {open && (
                <div className="fixed bottom-20 right-5 sm:right-8 z-50 w-[calc(100vw-40px)] sm:w-[420px] max-h-[600px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700/50"
                    style={{
                        background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                        backdropFilter: "blur(20px)",
                    }}
                >
                    {/* Header dark */}
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-violet-600 to-blue-600 text-white">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-xl">
                                    🤖
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-violet-700" />
                            </div>
                            <div>
                                <div className="font-black text-[14px]">Riyad</div>
                                <div className="text-[10.5px] text-white/80 font-semibold">Asistente de tu negocio · En línea</div>
                            </div>
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg transition"
                            aria-label="Cerrar chat"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Lista de mensajes */}
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50"
                        style={{ scrollbarWidth: "thin" }}
                    >
                        {messages.map(m => (
                            <MessageBubble key={m.id} msg={m} onQuick={handleQuickAction} />
                        ))}
                        {busy && <TypingDots />}
                    </div>

                    {/* Quick replies (solo si no hay muchos mensajes) */}
                    {messages.length <= 3 && (
                        <div className="px-3 py-2 border-t border-slate-700/50 bg-slate-900/30">
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5 px-1">Preguntas rápidas</div>
                            <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                                {QUICK_REPLIES.map(qr => (
                                    <button
                                        key={qr.id}
                                        onClick={() => send(qr.prompt)}
                                        className="shrink-0 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11.5px] font-semibold whitespace-nowrap transition"
                                    >
                                        <span className="mr-1">{qr.icon}</span>
                                        {qr.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Input */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            send(draft);
                        }}
                        className="flex items-center gap-2 p-3 border-t border-slate-700/50 bg-slate-900/80"
                    >
                        <input
                            ref={inputRef}
                            type="text"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder="Pregúntame algo sobre tu negocio..."
                            autoComplete="off"
                            disabled={busy}
                            className="flex-1 bg-slate-800 border border-slate-700 rounded-full px-4 py-2.5 text-white text-[13px] placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition"
                            style={{ fontSize: "16px" }}
                        />
                        <button
                            type="submit"
                            disabled={!draft.trim() || busy}
                            className="w-10 h-10 rounded-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shadow-md transition"
                            aria-label="Enviar"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13" />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        </button>
                    </form>
                </div>
            )}
        </>
    );
}

// =====================================================================
// MessageBubble — un mensaje individual
// =====================================================================
function MessageBubble({ msg, onQuick }: { msg: ChatMessage; onQuick: (id: string) => void }) {
    const isUser = msg.role === "user";
    const isSystem = msg.role === "system";

    if (isSystem) {
        return (
            <div className="flex justify-center my-2">
                <div className="px-3 py-1.5 rounded-full bg-rose-900/30 border border-rose-800/50 text-rose-300 text-[11px] font-semibold">
                    ⚠️ {msg.content}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
            {!isUser && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-sm shadow-md">
                    🤖
                </div>
            )}
            <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                    isUser
                        ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white rounded-tr-md shadow-md"
                        : "bg-slate-800 text-slate-100 rounded-tl-md border border-slate-700"
                }`}
            >
                {msg.role === "assistant" && msg.data ? renderAssistantContent(msg, onQuick) : (
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                )}
            </div>
        </div>
    );
}

function renderAssistantContent(msg: ChatMessage, onQuick: (id: string) => void) {
    // Reutiliza la misma logica de ChatPro principal pero inline
    return <AssistantContent msg={msg} onQuick={onQuick} />;
}

function AssistantContent({ msg, onQuick }: { msg: ChatMessage; onQuick: (id: string) => void }) {
    return (
        <>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            {renderDataInBubble(msg.data)}
            {msg.quickReplies && msg.quickReplies.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {msg.quickReplies.map(qr => (
                        <button
                            key={qr.id}
                            onClick={() => onQuick(qr.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-[11px] font-bold shadow"
                        >
                            {qr.label}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}

function renderDataInBubble(data: any) {
    if (!data) return null;
    const baseClass = "mt-3 p-2.5 rounded-lg bg-slate-900/60 space-y-1";

    if (data.total_ventas !== undefined) {
        return (
            <div className={baseClass}>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Tickets</span>
                    <span className="font-black">{data.num_tickets}</span>
                </div>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Total</span>
                    <span className="font-black text-emerald-400">{data.total_ventas}€</span>
                </div>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Promedio/ticket</span>
                    <span className="font-black">{data.promedio_por_ticket}€</span>
                </div>
            </div>
        );
    }

    if (data.total !== undefined && data.open !== undefined) {
        return (
            <div className={baseClass}>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Mesas totales</span>
                    <span className="font-black">{data.total}</span>
                </div>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Abiertas</span>
                    <span className="font-black text-amber-400">{data.open}</span>
                </div>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Libres</span>
                    <span className="font-black text-emerald-400">{data.free}</span>
                </div>
            </div>
        );
    }

    if (data.top && Array.isArray(data.top)) {
        return (
            <div className={baseClass}>
                <div className="text-[10px] uppercase tracking-widest opacity-70 mb-1">Top productos</div>
                {data.top.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between text-[11.5px]">
                        <span className="truncate">{p.name}</span>
                        <span className="font-black ml-2">{p.qty}u</span>
                    </div>
                ))}
            </div>
        );
    }

    if (data.low_stock && Array.isArray(data.low_stock)) {
        return (
            <div className={baseClass}>
                <div className="text-[10px] uppercase tracking-widest opacity-70 mb-1">Stock bajo</div>
                {data.low_stock.slice(0, 5).map((p: any, i: number) => (
                    <div key={i} className="flex justify-between text-[11.5px]">
                        <span className="truncate">{p.name}</span>
                        <span className="text-rose-400 font-bold ml-2">{p.current_stock}/{p.min_stock}</span>
                    </div>
                ))}
                {data.low_stock.length > 5 && (
                    <div className="text-[10px] opacity-60 mt-1">y {data.low_stock.length - 5} más...</div>
                )}
            </div>
        );
    }

    if (data.avg_margin_pct !== undefined) {
        return (
            <div className={baseClass}>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Margen medio</span>
                    <span className={`font-black ${Number(data.avg_margin_pct) >= 60 ? "text-emerald-400" : Number(data.avg_margin_pct) >= 40 ? "text-amber-400" : "text-rose-400"}`}>
                        {data.avg_margin_pct}%
                    </span>
                </div>
                <div className="flex justify-between text-[11.5px]">
                    <span className="opacity-70">Platos con margen bajo</span>
                    <span className="font-black">{data.insights_count}</span>
                </div>
            </div>
        );
    }

    return null;
}

// ★ Indicador "Riyad está escribiendo..."
function TypingDots() {
    return (
        <div className="flex gap-2">
            <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-sm shadow-md">
                🤖
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1">
                <Dot delay="0s" />
                <Dot delay="0.15s" />
                <Dot delay="0.3s" />
            </div>
        </div>
    );
}

function Dot({ delay }: { delay: string }) {
    return (
        <div
            className="w-1.5 h-1.5 rounded-full bg-slate-400"
            style={{
                animation: "chatBounce 1.2s infinite",
                animationDelay: delay,
            }}
        >
            <style>{`
                @keyframes chatBounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
                    30% { transform: translateY(-4px); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

export default ChatPro;
