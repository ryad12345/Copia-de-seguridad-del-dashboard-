// =====================================================================
// MOZONA TPV — PosTerminalPro (versión final)
// =====================================================================
// Layout 3 columnas:
//   IZQUIERDA  · CatalogPanel: salas, categorías, productos, búsqueda
//   CENTRAL    · OrderPanel:   comanda con líneas, totales, pre-cuenta
//   DERECHA    · PaymentPanel: display, numpad, botones de cobro
//
// Integración:
//   • WebSocketProvider → recibe ORDER_SENT, INVOICE_PAID, TABLE_STATUS_CHANGED
//   • Web Audio API → "ding" al entrar comanda desde WaiterPad
//   • useWaiterAuth → cajero activo (PIN)
//   • usePosReducer → estado del pedido
//   • VeriFactu RPC → emisión de factura (simulada aquí, ver onChargeVeriFactu)
// =====================================================================

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../context/WebSocketContext";
import { useWaiterAuth } from "../hooks/useWaiterAuth";
import { useAuth } from "../lib/auth";
import { usePosReducer, type PosState } from "../hooks/usePosReducer";
import { usePosData } from "../hooks/usePosData";
import { CatalogPanel } from "../components/pos/CatalogPanel";
import { OrderPanel }   from "../components/pos/OrderPanel";
import { PaymentPanel } from "../components/pos/PaymentPanel";
import { PinAuthModal } from "../components/auth/PinAuthModal";
import { PosTopBar } from "../components/PosTopBar";
import { IconBell, IconReceipt, IconCheck, IconUser, IconLogout, IconSparkles, IconStore, IconCash } from "../components/icons";
import { playOrderDing, playChargeSuccess, playError, unlockAudio } from "../lib/sounds";
import { cn } from "../lib/cn";
import { useLocalPrinter } from "../hooks/useLocalPrinter";
import { useLocalIP } from "../hooks/useLocalIP";
import { subscribeToOrders, listOpenOrders } from "../lib/orders";
import { upsertDraft, clearDraft, listOpenDrafts, getOpenDraft, type OpenOrder } from "../lib/drafts";
import { resolveRealTenantId } from "../lib/waiters";
import { useBusinessMode } from "../lib/business-mode";
import { occupyTable, freeTable, dirtyTable } from "../lib/tables";
import { printPreBill as printPreBillUnified } from "../lib/ticketPrinter";
import { isVip, isVipOrAdmin, isSuperAdminEmail } from "../lib/vip";
import { SubscriptionBanner, SubscriptionPaywall } from "../components/auth/SubscriptionGate";
import { supabase } from "../lib/supabase";
import { round2 } from "../lib/format";
import { fetchCatalog } from "../lib/catalog";
import { subscribeToPosChannels } from "../lib/realtime";
import type { OrderItem, Product, PaymentMethod, TableStatus, Waiter, Restaurant, RestaurantTable } from "../lib/types";
import type { OrderSentData, InvoicePaidData } from "../../shared/ws-events";

/** Detecta si estamos en Tauri (desktop) o en navegador web. */
const inTauri = typeof window !== "undefined" && "__TAURI__" in window;

type MobileTab = "catalog" | "order" | "payment";


// ---------------------------------------------------------------------
// Mock de camareros eliminado — ahora se usa useWaiterAuth.validatePin()
// que valida contra la tabla tenant_users en Supabase (caché IndexedDB).
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------

export function PosTerminalPro() {
    const ws   = useWebSocket();
    const auth = useWaiterAuth();
    const saasAuth = useAuth();
    const nav  = useNavigate();
    const printer = useLocalPrinter();
    const localIp = useLocalIP(3000);
    const { categories, products, tables, connection, loading, restaurant, refresh: posDataRefresh } = usePosData();
    const pos  = usePosReducer();

    // ★ v4.3.0: business_mode (retail|hospitality) — si retail, ocultar mesas
    const bm = useBusinessMode(saasAuth.tenant?.id);
    const showTables = !bm.isRetail;

    const [showAuth, setShowAuth]     = useState(false);
    const [tableStatuses, setTableStatuses] = useState<Record<string, TableStatus>>({});
    const [toast, setToast]           = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
    const [recentOrders, setRecentOrders] = useState<Array<{ id: string; tableNumber: string; waiter: string; receivedAt: string }>>([]);
    const [mobileTab, setMobileTab]   = useState<MobileTab>("catalog");
    const [showQR, setShowQR]         = useState(false);
    const [catalogSearch, setCatalogSearch] = useState("");

    // ★ v4.5.13: GUARD DE AISLAMIENTO — admin NUNCA puede estar en /app
    //   Si el admin (rofixinsta) entra a /app, redirigir a /admin
    //   Garantiza que el admin NUNCA vea datos de tenants.
    const navigate = useNavigate();
    useEffect(() => {
        const userEmail = saasAuth.user?.email;
        if (isSuperAdminEmail(userEmail)) {
            console.warn("[PosTerminalPro] ⚠️ ADMIN detectado en /app, redirigiendo a /admin");
            navigate("/admin", { replace: true });
        }
    }, [saasAuth.user?.email, navigate]);

    // Mostrar PIN al montar si no hay sesión de camarero
    // BYPASS para VIP: NO incluye admin (admin ya redirigido arriba)
    useEffect(() => {
        if (!auth.isAuthenticated) {
            const userEmail = saasAuth.user?.email;
            if (isVip(userEmail)) {
                console.log("[PosTerminalPro] bypass PIN para VIP:", userEmail);
                return;
            }
            setShowAuth(true);
        }
    }, [auth.isAuthenticated, saasAuth.user?.email]);

    // Toast auto-hide
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 3000);
        return () => clearTimeout(t);
    }, [toast]);

    // -----------------------------------------------------------------
    // Suscripción a eventos del WebSocket
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!ws.isConnected) return;

        const off1 = ws.subscribe("ORDER_SENT", (env: any) => {
            const d = env.data;
            handleOrderReceived(d);
        });
        const off2 = ws.subscribe("TABLE_STATUS_CHANGED", (env: any) => {
            setTableStatuses(prev => ({ ...prev, [env.data.tableId]: env.data.newStatus }));
        });
        const off3 = ws.subscribe("INVOICE_PAID", (env: any) => {
            setTableStatuses(prev => ({ ...prev, [env.data.tableId]: "DIRTY" }));
            // Si el cajero tenía cargada esa mesa, limpiarla
            const t = tables.find(tb => tb.table_number === env.data.tableNumber);
            if (t && pos.state.selectedTableId === t.id) {
                pos.dispatch({ type: "CLEAR_ORDER" });
            }
        });
        return () => { off1(); off2(); off3(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ws.isConnected, tables]);

    // -----------------------------------------------------------------
    // Realtime: escuchar INSERTs en `orders` desde Supabase
    // (para que las comandas de los camareros aparezcan en el TPV
    //  incluso si el WebSocket local no funciona en cloud)
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!restaurant?.id) return;
        const off = subscribeToOrders(restaurant.id, (order) => {
            console.log("[PosTerminalPro] nueva comanda vía Supabase:", order.id);
            // Marcar la mesa como ocupada
            if (order.table_id) {
                setTableStatuses(prev => ({ ...prev, [order.table_id!]: "OCCUPIED" }));
            }
            // Sonido
            void unlockAudio();
            playOrderDing();
        });
        return off;

    // ★ Suscripción GLOBAL a Supabase Realtime (singleton, sin bucle)
    //    Dependencias VACÍAS: solo se monta al cargar el componente.
    //    El cleanup se hace correctamente porque subscribeToPosChannels
    //    ahora tiene guard anti-bucle.
    useEffect(() => {
        // ★ v4.1.7: pasar tenantId para filtro multi-tenant
        const activeTenantId = restaurant?.id || null;
        const off = subscribeToPosChannels((payload) => {
            console.log("[PosTerminalPro] realtime:", payload.table, payload.eventType);
            const row = payload.new ?? payload.old;
            if (payload.table === "products") {
                posDataRefresh();
            } else if (payload.table === "dining_tables" && row) {
                const mapStatus = (s: string | null | undefined): "FREE" | "OCCUPIED" | "DIRTY" | "BILL_REQUESTED" | "RESERVED" => {
                    const sn = (s ?? "").toLowerCase();
                    if (sn === "free" || sn === "available") return "FREE";
                    if (sn === "occupied") return "OCCUPIED";
                    if (sn === "dirty") return "DIRTY";
                    if (sn === "bill_requested" || sn === "billed") return "BILL_REQUESTED";
                    if (sn === "reserved") return "RESERVED";
                    return "FREE";
                };
                const mapped = mapStatus(row.status);
                const tid = row.id;
                const tnumber = String(row.table_number ?? "");
                if (tid) setTableStatuses(prev => ({ ...prev, [tid]: mapped }));
                if (tnumber) setTableStatuses(prev => ({ ...prev, [`local-table-${tnumber}`]: mapped }));
            } else if (payload.table === "open_orders" && row) {
                const tableNumber = row.table_number;
                if (!tableNumber) return;
                if (payload.eventType === "DELETE") {
                    setTableStatuses(prev => {
                        const next = { ...prev };
                        delete next[row.table_id];
                        delete next[`local-table-${tableNumber}`];
                        return next;
                    });
                } else {
                    const items = Array.isArray(row.items) ? row.items : [];
                    if (items.length > 0) {
                        if (pos.state.selectedTableLabel === tableNumber && pos.state.selectedTableId) {
                            pos.dispatch({ type: "RESTORE_DRAFTS", drafts: { [pos.state.selectedTableId]: items as any } });
                        }
                        const tid = row.table_id || `local-table-${tableNumber}`;
                        setTableStatuses(prev => ({ ...prev, [tid]: "OCCUPIED" }));
                        void playOrderDing();
                    }
                }
            }
        });
        return off;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restaurant?.id]);

    // ★ v4.0.7-final: usePosData es la única fuente de productos.
    //    Si products.length === 0, mostrar mensaje claro (NO fallback a fetchCatalog).
    useEffect(() => {
        if (!loading && products.length === 0) {
            console.warn("[PosTerminalPro] usePosData sin productos tras carga completa");
        }
    }, [products.length, loading]);
    }, [restaurant?.id]);

    // -----------------------------------------------------------------
    // Restaurar borradores persistidos al cargar (F5)
    // Carga open_orders del tenant y rellena el state.draftsByTable
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!restaurant?.id) return;
        let cancelled = false;
        (async () => {
            try {
                const realId = await resolveRealTenantId(restaurant.id);
                if (!realId || cancelled) return;
                const drafts = await listOpenDrafts(realId);
                if (cancelled || drafts.length === 0) return;
                console.log("[PosTerminalPro] restaurando", drafts.length, "borradores");
                const draftsByTable: Record<string, OrderItem[]> = {};
                const tableStatusMap: Record<string, TableStatus> = {};
                for (const d of drafts) {
                    if (Array.isArray(d.items) && d.items.length > 0) {
                        draftsByTable[d.table_id] = d.items as OrderItem[];
                        tableStatusMap[d.table_id] = "OCCUPIED";
                    }
                }
                // Inyectar drafts en el reducer
                pos.dispatch({ type: "RESTORE_DRAFTS", drafts: draftsByTable });
                setTableStatuses(prev => ({ ...prev, ...tableStatusMap }));
            } catch (e) {
                console.warn("[PosTerminalPro] restaurar drafts error:", e);
            }
        })();
        return () => { cancelled = true; };
    }, [restaurant?.id]);

    // -----------------------------------------------------------------
    // ★ Realtime: los 3 canales (products, dining_tables, open_orders)
    //   se manejan ahora en el SINGLETON subscribeToPosChannels() arriba.
    //   No duplicamos canales aquí para evitar bucle removeChannel.
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    // Cuando entra una comanda desde un WaiterPad
    // -----------------------------------------------------------------
    const handleOrderReceived = useCallback((d: OrderSentData) => {
        // 1) Sonido
        void unlockAudio();
        playOrderDing();
        // 2) Marcar mesa como ocupada
        setTableStatuses(prev => ({ ...prev, [d.tableId]: "OCCUPIED" }));
        // 3) Si el cajero tiene esa mesa seleccionada, cargar líneas
        const table = tables.find(t => t.id === d.tableId);
        if (table && pos.state.selectedTableId === d.tableId) {
            const items: OrderItem[] = d.items.map(i => ({
                id:          `${d.orderId}-${i.productId}`,
                product_id:  i.productId,
                name:        i.name,
                unit_price:  i.unitPrice,
                tax_rate:    10,
                quantity:    i.quantity,
                notes:       i.notes ?? "",
                added_at:    d.timestamp ?? new Date().toISOString(),
            }));
            // Sumar al pedido existente
            for (const it of items) {
                pos.dispatch({ type: "ADD_PRODUCT" , product: { id: it.product_id, name: it.name, price: it.unit_price, tax_rate: it.tax_rate, restaurant_id: "", category_id: null, description: null, is_available: true } as Product });
            }
        }
        // 4) Notificación visual
        setRecentOrders(prev => [{
            id: d.orderId, tableNumber: d.tableNumber, waiter: d.waiter,
            receivedAt: new Date().toISOString(),
        }, ...prev].slice(0, 5));
        setToast({ kind: "ok", msg: `Comanda recibida · Mesa ${d.tableNumber}` });
    }, [tables, pos]);

    // -----------------------------------------------------------------
    // Selección de mesa (carga líneas vacías para empezar)
    // FIX: handler robusto que tolera mesas dummy (local-table-*) y
    // mesas reales, con try-catch y logging para diagnóstico
    // ★ v4.0.7-pos-safety: triple try-catch para NUNCA romper la UI
    // -----------------------------------------------------------------
    const handleSelectTable = useCallback((id: string | null) => {
        try {
            try {
                console.log("[PosTerminalPro] click mesa id=", id, " tablesCount=", tables?.length);
                if (id === null) {
                    pos.dispatch({ type: "SELECT_TABLE", tableId: null, tableLabel: null });
                    return;
                }
                // Búsqueda segura con fallback
                let tableLabel = String(id);
                const t = (tables || []).find(tb => tb?.id === id);
                if (t && t.table_number != null) {
                    tableLabel = String(t.table_number);
                } else {
                    // Mesa dummy (local-table-N)
                    const numMatch = /local-table-(\d+)/.exec(String(id));
                    if (numMatch) {
                        tableLabel = numMatch[1];
                    }
                }
                // Dispatch atómico (cada uno en su try-catch)
                try {
                    pos.dispatch({ type: "SELECT_TABLE", tableId: id, tableLabel });
                } catch (e) {
                    console.warn("[PosTerminalPro] dispatch SELECT_TABLE failed:", e);
                }
                try {
                    pos.dispatch({ type: "SELECT_CATEGORY", categoryId: null });
                } catch (e) {
                    console.warn("[PosTerminalPro] dispatch SELECT_CATEGORY failed:", e);
                }
                console.log("[PosTerminalPro] mesa seleccionada:", tableLabel);
            } catch (innerErr) {
                console.warn("[PosTerminalPro] handleSelectTable inner error:", innerErr);
            }
        } catch (e) {
            // Triple guard: nada debe romper la app
            console.error("[PosTerminalPro] handleSelectTable outer error:", e);
        }
    }, [tables, pos]);

    // -----------------------------------------------------------------
    // Persistencia automática de drafts (cada vez que cambia la comanda)
    // -----------------------------------------------------------------
    const persistDraft = useCallback(async (
        tableId:     string,
        tableNumber: string,
        items:       OrderItem[],
    ) => {
        if (!restaurant?.id) return;
        const waiterName = auth.activeWaiter?.name ?? null;
        try {
            // El clearDraft ahora toma tableNumber, no tableId
            const tableNumberStr = String(tableNumber ?? "");
            if (items.length === 0) {
                await clearDraft(restaurant.id, tableNumberStr);
            } else {
                await upsertDraft({
                    tenantId:    restaurant.id,
                    tableId,
                    tableNumber: tableNumberStr,
                    waiterName,
                    items,
                });
            }
        } catch (e) {
            console.warn("[PosTerminalPro] persistDraft error:", e);
        }
    }, [restaurant?.id, auth.activeWaiter?.name]);

    // -----------------------------------------------------------------
    // Persistencia REACTIVA: cada vez que cambian los items de la mesa
    // seleccionada, guardar en open_orders automáticamente
    // ★ v4.0.7-pos-safety: blindado con try-catch para no romper UI
    // -----------------------------------------------------------------
    const lastPersistedJsonRef = useRef<string>("");
    useEffect(() => {
        try {
            const tid = pos.state.selectedTableId;
            const tlabel = pos.state.selectedTableLabel;
            if (!tid || !tlabel) return;
            // Solo persistir si hay cambios reales
            const itemsJson = JSON.stringify(pos.state.orderItems);
            if (itemsJson === lastPersistedJsonRef.current) return;
            lastPersistedJsonRef.current = itemsJson;
            console.log("[PosTerminalPro] auto-persist:", pos.state.orderItems.length, "items, mesa", tlabel);
            // Persistir en background con catch completo
            persistDraft(tid, tlabel, pos.state.orderItems).catch(err => {
                console.warn("[PosTerminalPro] persistDraft failed (silent):", err);
            });
            // ★ v4.2.8: marcar mesa como ocupada EN BD (no solo local)
            occupyTable(
                saasAuth.tenant?.id ?? null,
                tid,
                tlabel,
                undefined
            ).catch(err => console.warn("[PosTerminalPro] occupyTable BD failed:", err?.message));
            // Marcar mesa como ocupada local
            try {
                setTableStatuses(prev => prev[tid] ? prev : { ...prev, [tid]: "OCCUPIED" });
            } catch (e) {
                console.warn("[PosTerminalPro] setTableStatuses failed:", e);
            }
        } catch (err) {
            // ★ Nunca debe romper el componente
            console.warn("[PosTerminalPro] useEffect auto-persist outer error:", err);
        }
    }, [pos.state.selectedTableId, pos.state.selectedTableLabel, pos.state.orderItems, persistDraft]);

    // -----------------------------------------------------------------
    // Wrapper de dispatch que persiste en BD después de cada cambio
    // -----------------------------------------------------------------
    const dispatchAndPersist = useCallback((action: any) => {
        pos.dispatch(action);
        // Después del dispatch, si es una acción que modifica orderItems,
        // persistir.  Usamos setTimeout 0 para que el state se haya actualizado.
        setTimeout(() => {
            const tid = pos.state.selectedTableId;
            const tlabel = pos.state.selectedTableLabel;
            if (!tid || !tlabel) return;
            if (
                action.type === "ADD_PRODUCT"     ||
                action.type === "INCREMENT_ITEM"  ||
                action.type === "DECREMENT_ITEM"  ||
                action.type === "REMOVE_ITEM"     ||
                action.type === "UPDATE_NOTES"    ||
                action.type === "CLEAR_ORDER"
            ) {
                void persistDraft(tid, tlabel, pos.state.orderItems);
            }
        }, 0);
    }, [pos, persistDraft]);

    // -----------------------------------------------------------------
    // Selección de mesa desde el array real (sobrescribe estado en vivo)
    // -----------------------------------------------------------------
    const tablesWithStatus = useMemo(() => {
        const real = tables.map(t => ({ ...t, status: tableStatuses[t.id] ?? t.status }));
        console.log("[PosTerminalPro] tablesWithStatus:", {
            totalMesas: real.length,
            conStatusOcupado: real.filter(t => t.status === "OCCUPIED").length,
            ids: real.map(t => ({ id: t.id, number: t.table_number, status: t.status })),
        });
        // Si hay menos de 16 mesas, rellenamos con mesas dummy 1..16
        if (real.length >= 16) return real;
        const seen = new Set(real.map(t => String(t.table_number)));
        const filler: typeof real = [];
        for (let i = 1; i <= 16; i++) {
            if (!seen.has(String(i))) {
                filler.push({
                    id: `local-table-${i}`,
                    restaurant_id: real[0]?.restaurant_id ?? "local",
                    zone_id: null,
                    zone: null,
                    table_number: String(i),
                    status: "FREE",
                } as typeof real[number]);
            }
        }
        return [...real, ...filler].slice(0, 16);
    }, [tables, tableStatuses]);

    // -----------------------------------------------------------------
    // Acciones de cobro
    // -----------------------------------------------------------------
    const performCharge = useCallback(async (
        method: PaymentMethod,
        withVeriFactu: boolean
    ) => {
        console.log("★", "★", "★ ¡¡COBRANDO!! ★", "★", "★", new Date().toISOString());
        console.log("[performCharge] inicio, selectedTableId=", pos.state.selectedTableId, "total=", pos.total);

        if (!pos.state.selectedTableId || pos.total <= 0 || pos.state.isProcessing) {
            console.warn("[performCharge] cancelado: sin mesa, sin total, o ya procesando");
            return;
        }

        pos.dispatch({ type: "SET_PROCESSING", processing: true });

        // ★★★ PASO 0: CAPTURAR MESA Y TOTALES ANTES DE NADA ★★★
        const tableIdSelected = pos.state.selectedTableId;

        // ★ v4.0.7-fix: Buscar la mesa en tablesWithStatus (incluye dummy locales)
        //   Fallback: si no se encuentra, crear mesa sintética para mesas locales
        let table = tablesWithStatus.find(t => t.id === tableIdSelected);
        if (!table) {
            // ★ Mesa dummy local (ej: local-table-2) que no existe en BD
            const isLocalDummy = tableIdSelected?.startsWith("local-table-");
            const tableNumFallback = isLocalDummy
                ? tableIdSelected.replace("local-table-", "")
                : (pos.state.selectedTableLabel?.replace(/\D/g, "") || "0");

            if (!isLocalDummy || !tableNumFallback) {
                console.warn("[performCharge] Mesa no identificada:", tableIdSelected);
                setToast({ kind: "err", msg: "No pudimos identificar la mesa. Selecciónala de nuevo desde el mapa para continuar." });
                pos.dispatch({ type: "SET_PROCESSING", processing: false });
                return;
            }

            // ★ Crear mesa sintética para mesas locales (NO existen en BD)
            table = {
                id: tableIdSelected,
                restaurant_id: restaurant?.id ?? "local",
                zone_id: null,
                zone: null,
                table_number: tableNumFallback,
                status: "FREE",
            };
            console.log("[performCharge] mesa dummy local detectada:", tableNumFallback);
        }
        const tableNum = String(table.table_number ?? "");
        const items    = pos.state.orderItems;
        const sub      = items.reduce((a, it) => a + Number(it.unit_price ?? 0) * Number(it.quantity ?? 0), 0);
        const tax      = items.reduce((a, it) => {
            const lineSub = Number(it.unit_price ?? 0) * Number(it.quantity ?? 0);
            return a + (lineSub - lineSub / (1 + Number(it.tax_rate ?? 10) / 100));
        }, 0);

        console.log("[performCharge] mesa=", tableNum, "items=", items.length, "subtotal=", round2(sub - tax), "iva=", round2(tax), "total=", round2(sub));

        const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const series    = "T26";
        const number    = Math.floor(Math.random() * 99999) + 1;
        const invoice: InvoicePaidData = {
            invoiceId,
            orderId:      tableIdSelected,
            series,
            number,
            total:        pos.total,
            paymentMethod: method,
            tableId:      table.id,
            tableNumber:  table.table_number,
            qrUrl:        `https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/...?nif=B12345678&numserie=${series}${String(number).padStart(8,"0")}&fecha=26-08-2026&importe=${pos.total.toFixed(2)}`,
            verifactuHash:"0".repeat(64),
        };

        // ★★★ PASO 1: LIBERAR MESA LOCALMENTE PRIMERO (SIEMPRE) ★★★
        //    Independientemente de si el INSERT funciona, la mesa
        //    se libera localmente para que el usuario pueda continuar.
        console.log("[performCharge] ★ paso 1: LIBERAR MESA LOCALMENTE ★");
        setTableStatuses(prev => {
            const next = { ...prev };
            next[table.id]               = "FREE";
            next[`local-table-${tableNum}`] = "FREE";
            next[tableNum]               = "FREE";
            return next;
        });
        // ★ v4.2.8: PATCH dining_tables → status='free' en BD
        freeTable(
            saasAuth.tenant?.id ?? null,
            table.id,
            tableNum
        ).catch(err => console.warn("[performCharge] freeTable BD failed:", err?.message));
        pos.dispatch({ type: "CLEAR_ORDER" });
        pos.dispatch({ type: "SELECT_TABLE", tableId: null, tableLabel: null });
        pos.dispatch({ type: "NUMPAD_RESET" });
        playChargeSuccess();
        console.log("[performCharge] ✓ mesa liberada y carrito vaciado");

        // ★★★ PASO 2: WS broadcast (no bloquea) ★★★
        try { ws.broadcastInvoicePaid(invoice); } catch {}

        // ★★★ PASO 3: PERSISTIR EN BD (3 estrategias) ★★★
        let persistOk = false;
        let orderIdCreated: string | null = null;
        let persistError: string | null = null;
        try {
            const { executeCheckout } = await import("../lib/checkout");
            const result = await executeCheckout({
                tenantId:      restaurant?.id ?? null,
                tableId:       table.id,
                tableNumber:   table.table_number,
                items:         items,
                subtotal:      round2(sub - tax),
                taxTotal:      round2(tax),
                total:         round2(sub),
                paymentMethod: method ?? "cash",
                waiterName:    auth.activeWaiter?.name ?? null,
                series:        series,
            });
            if (result.ok) {
                persistOk = true;
                orderIdCreated = result.orderId ?? null;
                console.log("[performCharge] ✓ executeCheckout OK, orderId=", orderIdCreated);
            } else {
                persistError = `${result.error}${result.errorCode ? ` (code ${result.errorCode})` : ""} [step: ${result.step}]`;
                console.error("[performCharge] ✗ executeCheckout FAILED:", persistError);
            }
        } catch (e) {
            console.error("[performCharge] ✗ executeCheckout exception:", e);
            persistError = e instanceof Error ? e.message : String(e);
        }

        // ★★★ PASO 4: TOAST FINAL (visible) ★★★
        const verb = withVeriFactu ? "Factura VeriFactu emitida" : "Cobro realizado";
        const seriesStr = `${invoice.series}-${String(invoice.number).padStart(8, "0")}`;
        if (persistOk) {
            setToast({
                kind: "ok",
                msg: `✅ Venta registrada · Mesa ${tableNum} · ${round2(sub)} €`,
            });

            // ★ v4.5.10: IMPRIMIR TICKET FINAL tras cobrar exitoso
            //   Usa datos del restaurant + BD para que salga con la
            //   cabecera/pie personalizados guardados en Configuración.
            try {
                const { printFinalTicket } = await import("../lib/ticketPrinter");
                const restaurantOverride = (restaurant && (restaurant.business_name || restaurant.cif_nif)) ? {
                    business_name: restaurant.business_name || "",
                    cif_nif:       restaurant.cif_nif || "",
                    nif:           restaurant.cif_nif || "",
                    address:       restaurant.address || "",
                    phone:         restaurant.phone || "",
                    contact_email: (restaurant as any).contact_email || "",
                } : null;
                await printFinalTicket({
                    tenantId:        restaurant?.id ?? null,
                    tableNumber:     tableNum,
                    waiterName:      auth.activeWaiter?.name,
                    paymentMethod:   method,
                    orderId:         orderIdCreated || undefined,
                    invoiceNumber:   invoice.number,
                    companyOverride: restaurantOverride,
                    lines:           items.map((it: any) => ({
                        name:       it.name,
                        quantity:   it.quantity,
                        unit_price: it.unit_price,
                        tax_rate:   it.tax_rate ?? 10,
                    })),
                });
            } catch (printErr) {
                console.warn("[performCharge] print ticket fallo:", printErr);
                // No bloqueamos el éxito del cobro
            }
        } else if (persistError) {
            // ★ v4.0.7-clean: Mensajes 100% comerciales, sin tecnicismos
            console.error("[performCharge] Detalle técnico (solo consola):", persistError);
            setToast({
                kind: "err",
                msg: `${verb} Mesa ${tableNum} · ${round2(sub)}€. No se pudo registrar la venta. Por favor, inténtalo de nuevo o contacta con soporte si el problema continúa. La mesa ya está libre.`,
            });
        } else {
            setToast({
                kind: "ok",
                msg: `✅ ${verb} · Mesa ${tableNum} · ${round2(sub)} € · Venta registrada`,
            });
        }
        console.log("[performCharge] FIN. persistOk=", persistOk, "orderId=", orderIdCreated);
        pos.dispatch({ type: "SET_PROCESSING", processing: false });
    }, [pos, tables, ws, restaurant, auth]);

    // -----------------------------------------------------------------
    // Acciones del numpad
    // -----------------------------------------------------------------
    const handleNumpadKey = useCallback((key: string) => {
        pos.dispatch({ type: "NUMPAD_KEY", key });
    }, [pos]);

    const handleSetMethod = useCallback((m: PaymentMethod | null) => {
        pos.dispatch({ type: "SET_PAYMENT_METHOD", method: m });
    }, [pos]);

    // -----------------------------------------------------------------
    // Pre-cuenta
    // -----------------------------------------------------------------
    const handlePrintPreBill = useCallback(async () => {
        if (pos.state.orderItems.length === 0) {
            setToast({ kind: "err", msg: "No hay productos en la comanda" });
            return;
        }
        const table = tables.find(t => t.id === pos.state.selectedTableId);
        const lines = pos.state.orderItems.map(it => ({
            name:       it.name,
            quantity:   it.quantity,
            unit_price: it.unit_price,
            tax_rate:   it.tax_rate ?? 10,
            notes:      it.notes,
        }));
        try {
            if (inTauri) {
                // 1) Tauri → ESC/POS al driver nativo (mantiene formato legacy de impresora local)
                await printer.printPreBill({
                    businessName: restaurant?.business_name ?? "MOZONA TPV",
                    cifNif:       restaurant?.cif_nif ?? "—",
                    address:      restaurant?.address ?? "",
                    tableNumber:  table ? String(table.table_number) : undefined,
                    waiterName:   auth.activeWaiter?.name,
                    lines: lines.map(l => ({
                        name:  l.name,
                        qty:   l.quantity,
                        price: l.unit_price,
                        tax_rate: l.tax_rate,
                        notes: l.notes ?? undefined,
                    })),
                });
                setToast({ kind: "ok", msg: "Pre-cuenta impresa en la impresora local" });
            } else {
                // 2) Web → MISMO MOTOR que printTicket (58mm, BD, datos reales)
                // ★ v4.5.9: pasar restaurant completo como companyOverride
                //   para garantizar datos en el ticket.
                let localCompany: any = null;
                try {
                    // Prioridad 1: restaurant del TPV (datos frescos de BD)
                    if (restaurant && (restaurant.business_name || restaurant.cif_nif)) {
                        localCompany = {
                            business_name: restaurant.business_name || "",
                            cif_nif:       restaurant.cif_nif || "",
                            nif:           restaurant.cif_nif || "",
                            address:       restaurant.address || "",
                            phone:         restaurant.phone || "",
                            contact_email: (restaurant as any).contact_email || "",
                        };
                    } else {
                        // Prioridad 2: localStorage
                        const raw = localStorage.getItem("mozona.empresa")
                                 || localStorage.getItem("business_info")
                                 || localStorage.getItem("mozona.ticket_config");
                        if (raw) localCompany = JSON.parse(raw);
                    }
                } catch (e) { /* silenciado */ }

                const result = await printPreBillUnified({
                    // ★ v4.5.9: usar restaurant.id (no tenant_id que no existe)
                    tenantId:        restaurant?.id ?? null,
                    tableNumber:     table ? String(table.table_number) : undefined,
                    waiterName:      auth.activeWaiter?.name,
                    lines,
                    companyOverride: localCompany,
                });
                if (!result.ok) {
                    console.warn("[printPreBill] fallo:", result.error);
                    setToast({ kind: "err", msg: "No se pudo imprimir la pre-cuenta. Revisa que la impresora esté encendida y con papel." });
                } else {
                    setToast({ kind: "ok", msg: "Pre-cuenta enviada a impresión" });
                }
            }
        } catch (e) {
            console.warn("[printPreBill] error:", e);
            setToast({ kind: "err", msg: "No se pudo imprimir la pre-cuenta. Revisa que la impresora esté encendida y con papel." });
        }
    }, [pos, tables, restaurant, auth, printer]);

    // -----------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------
    const handlePinSubmit = useCallback(async (pin: string): Promise<Waiter | null> => {
        const w = await auth.validatePin(pin);
        if (w) {
            setShowAuth(false);
            playOrderDing();
        } else {
            playError();
        }
        return w;
    }, [auth]);

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------
    if (loading) {
        return (
            <div className="min-h-dvh bg-[#F0F2F5] flex items-center justify-center text-slate-500 text-[13px]">
                Cargando TPV…
            </div>
        );
    }

    return (
        <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100 dark:bg-slate-900">
            <SubscriptionBanner
                tenant={restaurant as any}
                userEmail={saasAuth.user?.email ?? null}
            />
            <PosTopBar
                restaurant={restaurant ?? {
                    id: "rest-demo", slug: "demo", business_name: "MOZONA TPV",
                    cif_nif: "—", address: "",
                    phone: null, primary_color: "#2563EB",
                    ticket_footer_msg: "Gracias por su visita",
                    created_at: new Date().toISOString(),
                }}
                connection={connection}
                cashier={{
                    name: auth.activeWaiter?.name ?? "Cajero",
                    role: auth.activeWaiter?.role ?? "—",
                }}
                onOpenSettings={() => nav("/settings")}
                onOpenCashRegister={() => nav("/cash-register")}
                onLogout={async () => {
                    await saasAuth.signOut();
                    nav("/auth");
                }}
                isAuthenticated={!!saasAuth.user}
            />

            {/* Banner de conexión + acciones rápidas (sm+) */}
            <div className="hidden sm:flex px-5 py-2 bg-white/80 backdrop-blur-md border-b border-slate-200/80 items-center gap-3 text-[11.5px]">
                <span className={`
                    w-2 h-2 rounded-full
                    ${ws.isConnected ? "bg-emerald-500" : "bg-rose-500"}
                `} />
                <span className="text-slate-700 font-semibold">
                    {ws.isConnected ? "Conectado a la nube" : "Sin conexión"}
                </span>
                {ws.latencyMs !== null && (
                    <span className="text-slate-500">· {ws.latencyMs} ms</span>
                )}
                {ws.queueSize > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-mono text-[10px]">
                        {ws.queueSize} en cola
                    </span>
                )}
                <div className="flex-1" />
                {auth.activeWaiter && (
                    <button
                        onClick={() => setShowAuth(true)}
                        className="
                            inline-flex items-center gap-1.5
                            px-2.5 h-7 rounded-lg
                            bg-slate-100 hover:bg-slate-200
                            text-[11px] font-semibold text-slate-700
                            active:scale-95 transition
                        "
                    >
                        <IconUser size={12} strokeWidth={2} />
                        Cambiar
                    </button>
                )}
                {/* ★ v3.4.5: Botón "Personalizar" MOVIDO a /settings (SettingsPage) */}
                {auth.activeWaiter && (
                    <button
                        onClick={() => { auth.logout(); setShowAuth(true); }}
                        className="
                            inline-flex items-center gap-1.5
                            px-2.5 h-7 rounded-lg
                            text-rose-600 hover:bg-rose-50
                            text-[11px] font-semibold
                            active:scale-95 transition
                        "
                    >
                        <IconLogout size={12} strokeWidth={2} />
                    </button>
                )}
            </div>

            {/* Contenido principal: layout 70/30 (izquierda/derecha) */}
            <main className="hidden sm:flex flex-1 min-h-0 w-full p-2.5 gap-2.5 overflow-hidden">
              
              {/* COLUMNA IZQUIERDA (70% de ancho total) */}
              <div className="w-[70%] h-full flex flex-col gap-2.5 overflow-hidden">
                {/* ★ v4.3.0: Si business_type=retail, NO mostrar mesas (oculto totalmente) */}
                {showTables ? (
                <section className="h-44 shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mesas (1–16)</span>
                  <div className="grid grid-cols-8 gap-2 my-auto">
                    {tablesWithStatus.slice(0, 16).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTable(t.id === pos.state.selectedTableId ? null : t.id)}
                        className={cn(
                          "h-10 text-sm font-bold rounded-lg flex items-center justify-center transition-colors",
                          pos.state.selectedTableId === t.id
                            ? "bg-blue-500 text-white ring-2 ring-offset-1 ring-blue-600"
                            : t.status === "FREE"
                            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                            : t.status === "OCCUPIED"
                            ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                            : t.status === "BILL_REQUESTED"
                            ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                            : t.status === "RESERVED"
                            ? "bg-violet-100 text-violet-800 hover:bg-violet-200"
                            : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        )}
                      >
                        <span className="tabular-nums">{t.table_number}</span>
                      </button>
                    ))}
                  </div>
                </section>
                ) : (
                  /* ★ v4.3.0 retail: header indicando "Modo Tienda" */
                  <section className="h-12 shrink-0 bg-blue-50 dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-slate-700 p-2 shadow-sm flex items-center justify-center">
                    <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                      🛍️ Modo Tienda — Venta directa (sin mesas)
                    </span>
                  </section>
                )}

                {/* Inferior Izquierda: Menú y Categorías (resto del alto) */}
                <section className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 shadow-sm flex flex-col overflow-hidden">
                  <CatalogPanel
                    categories={categories}
                    products={products}
                    tables={tablesWithStatus}
                    selectedCategoryId={pos.state.selectedCategoryId}
                    onSelectCategory={(id: any) => pos.dispatch({ type: "SELECT_CATEGORY", categoryId: id })}
                    selectedTableId={pos.state.selectedTableId}
                    onSelectTable={handleSelectTable}
                    onAddProduct={(p: any) => pos.dispatch({ type: "ADD_PRODUCT", product: p })}
                    variant="full"
                    search={catalogSearch}
                    onSearchChange={setCatalogSearch}
                  />
                </section>
              </div>

              {/* COLUMNA DERECHA (30% de ancho total, dividida 50% / 50% de alto) */}
              <div className="w-[30%] h-full flex flex-col gap-2.5 overflow-hidden">
                {/* Superior Derecha: Comanda (50% de alto) */}
                <section className="h-1/2 min-h-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
                  <OrderPanel
                    items={pos.state.orderItems}
                    tableLabel={pos.state.selectedTableLabel}
                    waiterName={auth.activeWaiter?.name ?? null}
                    taxByRate={pos.taxByRate}
                    total={pos.total}
                    itemCount={pos.itemCount}
                    onIncrement={id => pos.dispatch({ type: "INCREMENT_ITEM", itemId: id })}
                    onDecrement={id => pos.dispatch({ type: "DECREMENT_ITEM", itemId: id })}
                    onRemove={id => pos.dispatch({ type: "REMOVE_ITEM", itemId: id })}
                    onClear={() => pos.dispatch({ type: "CLEAR_ORDER" })}
                    onPrintPreBill={handlePrintPreBill}
                  />
                </section>

                {/* Inferior Derecha: Cobro y Teclado (50% de alto) */}
                <section className="h-1/2 min-h-0 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 shadow-sm flex flex-col justify-between overflow-hidden">
                  <PaymentPanel
                    total={pos.total}
                    paymentAmount={pos.state.paymentAmount}
                    paymentMethod={pos.state.paymentMethod}
                    canCharge={pos.state.orderItems.length > 0 && pos.state.selectedTableId !== null}
                    isProcessing={pos.state.isProcessing}
                    onNumpadKey={handleNumpadKey}
                    onSetMethod={handleSetMethod}
                    onCharge={() => performCharge(pos.state.paymentMethod ?? "CASH", false)}
                    onChargeVeriFactu={() => performCharge(pos.state.paymentMethod ?? "CARD", true)}
                  />
                </section>
              </div>
            </main>

            {/* Vista móvil: un solo panel visible, controlado por tabs */}
            <main className="flex sm:hidden flex-1 min-h-0 w-full overflow-hidden">

                <div className="flex-1 min-h-0">
                    <MobileTabPanel value={mobileTab}>
                        {mobileTab === "catalog" && (
                            <CatalogPanel
                                categories={categories}
                                products={products}
                                tables={tablesWithStatus}
                                selectedCategoryId={pos.state.selectedCategoryId}
                                onSelectCategory={(id: any) => pos.dispatch({ type: "SELECT_CATEGORY", categoryId: id })}
                                selectedTableId={pos.state.selectedTableId}
                                onSelectTable={handleSelectTable}
                                onAddProduct={(p: any) => pos.dispatch({ type: "ADD_PRODUCT", product: p })}
                            />
                        )}
                        {mobileTab === "order" && (
                            <OrderPanel
                                items={pos.state.orderItems}
                                tableLabel={pos.state.selectedTableLabel}
                                waiterName={auth.activeWaiter?.name ?? null}
                                taxByRate={pos.taxByRate}
                                total={pos.total}
                                itemCount={pos.itemCount}
                                onIncrement={id => pos.dispatch({ type: "INCREMENT_ITEM", itemId: id })}
                                onDecrement={id => pos.dispatch({ type: "DECREMENT_ITEM", itemId: id })}
                                onRemove={id => pos.dispatch({ type: "REMOVE_ITEM", itemId: id })}
                                onClear={() => pos.dispatch({ type: "CLEAR_ORDER" })}
                                onPrintPreBill={handlePrintPreBill}
                            />
                        )}
                        {mobileTab === "payment" && (
                            <PaymentPanel
                                total={pos.total}
                                paymentAmount={pos.state.paymentAmount}
                                paymentMethod={pos.state.paymentMethod}
                                canCharge={pos.state.orderItems.length > 0 && pos.state.selectedTableId !== null}
                                isProcessing={pos.state.isProcessing}
                                onNumpadKey={handleNumpadKey}
                                onSetMethod={handleSetMethod}
                                onCharge={() => performCharge(pos.state.paymentMethod ?? "CASH", false)}
                                onChargeVeriFactu={() => performCharge(pos.state.paymentMethod ?? "CARD", true)}
                            />
                        )}
                    </MobileTabPanel>
                </div>
            </main>

            {/* Tab bar móvil (<sm) =================================== */}
            <MobileTabBar
                value={mobileTab}
                itemCount={pos.itemCount}
                onChange={setMobileTab}
            />

            {/* Toast de notificación */}
            {toast && (
                <div
                    className={`
                        fixed top-20 left-1/2 -translate-x-1/2 z-50
                        px-4 py-2.5 rounded-2xl shadow-lg
                        flex items-center gap-2
                        text-[13px] font-semibold
                        animate-[fadeInDown_0.2s_ease-out]
                        ${toast.kind === "ok"
                            ? "bg-emerald-600 text-white"
                            : "bg-rose-600 text-white"
                        }
                    `}
                >
                    {toast.kind === "ok"
                        ? <IconCheck size={16} strokeWidth={2.4} />
                        : <IconBell  size={16} strokeWidth={2.4} />}
                    {toast.msg}
                </div>
            )}

            {/* Panel de comandas recientes (overlay compacto, sm+) === */}
            {recentOrders.length > 0 && (
                <aside
                    className="
                        hidden sm:block
                        fixed bottom-3 left-1/2 -translate-x-1/2 z-30
                        max-w-2xl w-[min(100%-1.5rem,42rem)]
                        bg-white rounded-2xl border border-slate-200/80 shadow-lg
                        px-3 py-2
                    "
                >
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.15em] text-slate-500 uppercase mb-1.5">
                        <IconSparkles size={12} strokeWidth={2} />
                        Comandas recientes
                    </div>
                    <div className="flex gap-2 overflow-x-auto">
                        {recentOrders.map(o => (
                            <div
                                key={o.id}
                                className="
                                    shrink-0 inline-flex items-center gap-2
                                    px-2.5 py-1 rounded-lg
                                    bg-emerald-50 text-emerald-800
                                    text-[11.5px] font-semibold
                                    border border-emerald-200/80
                                "
                            >
                                <IconReceipt size={12} strokeWidth={2} />
                                Mesa {o.tableNumber} · {o.waiter}
                            </div>
                        ))}
                    </div>
                </aside>
            )}

            {/* Modal de PIN */}
            <PinAuthModal
                isOpen={showAuth}
                pinLength={4}
                title="Cajero · Acceso"
                subtitle="Introduce tu PIN para operar el TPV"
                onSubmit={handlePinSubmit}
                onCancel={() => setShowAuth(false)}
            />

            {/* Modal QR camareros */}
            {showQR && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm
                                flex items-center justify-center p-5"
                     onClick={() => setShowQR(false)}>
                    <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6
                                    text-center"
                         onClick={e => e.stopPropagation()}>
                        <div className="text-[18px] font-black tracking-tight text-slate-900">
                            Conectar comandero
                        </div>
                        <div className="mt-1 text-[12px] text-slate-500">
                            Escanea con la cámara del móvil del camarero
                        </div>
                        {localIp.baseUrl ? (
                            <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=1&data=${encodeURIComponent(`${localIp.baseUrl}/waiter`)}`}
                                    alt="QR"
                                    width={240} height={240}
                                    className="rounded-xl mx-auto"
                                />
                                <div className="mt-3 font-mono text-[13px] font-bold text-slate-900 break-all">
                                    {localIp.baseUrl}/waiter
                                </div>
                                <div className="mt-1 text-[10.5px] text-slate-400">
                                    Fuente: {localIp.source}
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
                                No se ha detectado la IP local.  Configúrala en Ajustes.
                            </div>
                        )}
                        <button onClick={() => setShowQR(false)}
                                className="mt-4 h-11 w-full rounded-xl bg-slate-100 hover:bg-slate-200
                                           text-[13px] font-bold text-slate-700 active:scale-95 transition">
                            Cerrar
                        </button>
                    </div>
                </div>
            )}

            {/* Estado del pedido para debugging visual (sólo en dev) */}
            {import.meta.env.DEV && (
                <DebugPanel
                    state={pos.state}
                    pos={pos}
                    wsState={ws.status}
                    wsQueue={ws.queueSize}
                />
            )}

            {/* ★ Bloqueo por suscripción vencida (paywall) */}
            <SubscriptionPaywall
                tenant={restaurant as any}
                userEmail={saasAuth.user?.email ?? null}
            />
        </div>
    );
}

// ---------------------------------------------------------------------
// MobileTabBar: barra de pestañas inferior en <sm
// ---------------------------------------------------------------------

function MobileTabBar({
    value, itemCount, onChange,
}: {
    value:     MobileTab;
    itemCount: number;
    onChange:  (tab: MobileTab) => void;
}) {
    return (
        <nav
            className="
                sm:hidden
                fixed bottom-0 inset-x-0 z-30
                bg-white/95 backdrop-blur-xl
                border-t border-slate-200/80
                shadow-[0_-4px_20px_-4px_rgb(0_0_0_/_0.08)]
                pb-[max(0.5rem,env(safe-area-inset-bottom))]
            "
            role="tablist"
        >
            <div className="grid grid-cols-3 h-16">
                <TabButton
                    active={value === "catalog"}
                    onClick={() => onChange("catalog")}
                    icon={<IconStore size={20} strokeWidth={1.8} />}
                    label="Carta"
                />
                <TabButton
                    active={value === "order"}
                    onClick={() => onChange("order")}
                    icon={<IconReceipt size={20} strokeWidth={1.8} />}
                    label="Comanda"
                    badge={itemCount > 0 ? itemCount : undefined}
                />
                <TabButton
                    active={value === "payment"}
                    onClick={() => onChange("payment")}
                    icon={<IconCash size={20} strokeWidth={1.8} />}
                    label="Cobro"
                />
            </div>
        </nav>
    );
}

function TabButton({
    active, onClick, icon, label, badge,
}: {
    active:  boolean;
    onClick: () => void;
    icon:    React.ReactNode;
    label:   string;
    badge?:  number;
}) {
    return (
        <button
            onClick={onClick}
            role="tab"
            aria-selected={active}
            className={cn(
                "relative flex flex-col items-center justify-center gap-0.5",
                "transition active:scale-95",
                active
                    ? "text-blue-600"
                    : "text-slate-500 hover:text-slate-700"
            )}
        >
            {active && (
                <span className="
                    absolute top-0 inset-x-3 h-0.5
                    bg-blue-600 rounded-b-full
                " />
            )}
            <div className="relative">
                {icon}
                {badge !== undefined && (
                    <span className="
                        absolute -top-1 -right-2
                        min-w-[16px] h-4 px-1
                        rounded-full
                        bg-rose-500 text-white
                        text-[9px] font-black
                        flex items-center justify-center
                        ring-2 ring-white
                    ">
                        {badge}
                    </span>
                )}
            </div>
            <span className={cn(
                "text-[10.5px] font-bold tracking-wide",
                active ? "text-blue-600" : "text-slate-500"
            )}>
                {label}
            </span>
        </button>
    );
}

function MobileTabPanel({ value, children }: { value: MobileTab; children: React.ReactNode }) {
    return (
        <div
            key={value}
            className="
                h-full
                animate-slide-up
            "
        >
            {children}
        </div>
    );
}

// ---------------------------------------------------------------------
// Debug panel (sólo en desarrollo)
// ---------------------------------------------------------------------

function DebugPanel({
    state, pos, wsState, wsQueue,
}: {
    state:    PosState;
    pos:      ReturnType<typeof usePosReducer>;
    wsState:  string;
    wsQueue:  number;
}) {
    return (
        <details className="fixed top-2 right-2 z-40 max-w-xs bg-amber-50 border border-amber-300 rounded-lg text-[10px] font-mono p-2 shadow">
            <summary className="cursor-pointer font-bold">Debug</summary>
            <div className="mt-1 space-y-0.5">
                <div>WS: {wsState} (queue={wsQueue})</div>
                <div>Items: {state.orderItems.length}</div>
                <div>Total: {pos.total.toFixed(2)} €</div>
                <div>Table: {state.selectedTableLabel ?? "—"}</div>
                <div>Method: {state.paymentMethod ?? "—"}</div>
            </div>
        </details>
    );
}
