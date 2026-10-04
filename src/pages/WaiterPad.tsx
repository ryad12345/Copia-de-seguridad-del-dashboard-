// =====================================================================
// MOZONA TPV — WaiterPad (versión final)
// =====================================================================
// Comandero móvil optimizado para el camarero. Funcionalidades:
//   • Login por PIN (PinAuthModal) → useWaiterAuth
//   • Selector de mesa con estado en tiempo real (vía WebSocket)
//   • Carta con tabs por categoría + búsqueda
//   • Carrito con control de cantidad y notas
//   • Envío de comanda por WebSocket (ORDER_SENT)
//   • Logout y cambio de usuario
// =====================================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import { useWebSocket } from "../context/WebSocketContext";
import { useWaiterAuth, type Waiter } from "../hooks/useWaiterAuth";
import { useAuth } from "../lib/auth";
import { usePosData } from "../hooks/usePosData";
import { fetchCatalog } from "../lib/catalog";
import { PinAuthModal } from "../components/auth/PinAuthModal";
import { IconCheck, IconUser, IconX, IconPlus, IconMinus, IconSearch, IconLogout } from "../components/icons";
import { fmtEUR, round2 } from "../lib/format";
import { cn } from "../lib/cn";
import { createOrder, subscribeToOrders } from "../lib/orders";
import { isVipOrAdmin } from "../lib/vip";
import type { TableStatus, Product, RestaurantTable } from "../lib/types";
import type { OrderItemPayload } from "../../shared/ws-events";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

interface CartLine {
    productId: string;
    name:      string;
    unitPrice: number;
    taxRate:   number;
    quantity:  number;
    notes:     string;
}

// Lista de camareros de demo (en producción viene del backend)
const DEMO_WAITERS: Array<Waiter & { pin: string }> = [
    { id: "w-1", name: "Carlos",  pin: "1234", role: "waiter", loggedInAt: "" },
    { id: "w-2", name: "María",   pin: "5678", role: "waiter", loggedInAt: "" },
    { id: "w-3", name: "Admin",   pin: "9999", role: "owner",  loggedInAt: "" },
];

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function WaiterPad() {
    const ws     = useWebSocket();
    const auth   = useWaiterAuth();
    const saasAuth = useAuth();
    const { products, categories, tables, loading, restaurant, refresh: posDataRefresh } = usePosData();

    // ★ FALLBACK: si usePosData no devuelve productos, usar fetchCatalog
    //    que tiene 3 niveles de fallback (tenant → is_active → tenant dominante)
    useEffect(() => {
        if (products.length === 0 && !loading) {
            console.log("[WaiterPad] usePosData vacío, usando fetchCatalog()");
            void (async () => {
                const prods = await fetchCatalog();
                console.log("[WaiterPad] fetchCatalog devolvió", prods.length, "productos");
                if (prods.length > 0) {
                    // Forzar recarga de usePosData
                    posDataRefresh();
                }
            })();
        }
    }, [products.length, loading, posDataRefresh]);

    const [showAuth, setShowAuth]     = useState(false);
    const [tableId, setTableId]       = useState<string | null>(null);
    const [categoryId, setCategoryId] = useState<string | null>(null);
    const [search, setSearch]         = useState("");
    const [carts, setCarts]           = useState<Record<string, CartLine[]>>({});
    const [editingNotes, setEditingNotes] = useState<string | null>(null);
    const [lastSentAt, setLastSentAt] = useState<number | null>(null);
    const [tableStatuses, setTableStatuses] = useState<Record<string, TableStatus>>({});

    // -----------------------------------------------------------------
    // Si no hay sesión, mostrar modal de PIN.
    // También detecta sesión de camarero creada vía /waiter/login
    // (con username + password) y la propaga a useWaiterAuth.
    // -----------------------------------------------------------------
    useEffect(() => {
        console.log("[WaiterPad] mount, productos:", products.length, "mesas:", tables.length);
        // 1) Sesión vía username+password en localStorage
        try {
            const cached = localStorage.getItem("mozona.waiter_session");
            if (cached && !auth.isAuthenticated) {
                const parsed = JSON.parse(cached);
                if (parsed.ok && parsed.name) {
                    console.log("[WaiterPad] sesión camarero detectada:", parsed);
                    auth.login({
                        id:   parsed.user_id ?? parsed.tenant_id ?? "waiter",
                        name: parsed.name,
                        role: (parsed.role ?? "waiter") as "owner" | "manager" | "waiter" | "kitchen",
                    });
                }
            }
        } catch (e) { /* noop */ }

        // 2) Si sigue sin sesión, mostrar modal de PIN
        if (!auth.isAuthenticated) setShowAuth(true);
    }, [auth]);

    // -----------------------------------------------------------------
    // Suscripción a TABLE_STATUS_CHANGED para refrescar colores en vivo
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!ws.isConnected) return;
        const off = ws.subscribe("TABLE_STATUS_CHANGED", (env: any) => {
            const d = env.data;
            setTableStatuses(prev => ({ ...prev, [d.tableId]: d.newStatus }));
        });
        return off;
    }, [ws]);

    // -----------------------------------------------------------------
    // ★ Filtrado del catálogo: matching cruzado por UUID o nombre
    // -----------------------------------------------------------------
    const visibleProducts = useMemo(() => {
        let list = products;
        if (categoryId) {
            const norm = (s: any) => String(s ?? "").trim().toLowerCase();
            const cid = norm(categoryId);

            // Buscar la categoría seleccionada (por id o name)
            const currentCat = categories.find(
                (c: any) => norm(c.id) === cid || norm(c.name) === cid,
            );
            const targetId = norm(currentCat?.id) || cid;
            const targetName = norm(currentCat?.name) || cid;

            list = list.filter((p: any) => {
                const pCatId = norm(p.category_id);
                const pCatName = norm(p.category_name ?? p.category);
                // Match por UUID o por nombre
                const matchById = pCatId && (pCatId === targetId || pCatId === targetName);
                const matchByName = pCatName && (
                    pCatName === targetName ||
                    pCatName === norm(currentCat?.name) ||
                    pCatName === cid
                );
                return matchById || matchByName;
            });
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(p => p.name.toLowerCase().includes(q));
        }
        return list;
    }, [products, categories, categoryId, search]);

    const selectedTable = useMemo(
        () => tables.find(t => t.id === tableId) ?? null,
        [tables, tableId]
    );
    const cart = tableId ? carts[tableId] ?? [] : [];
    const tableStatus = (t: RestaurantTable): TableStatus =>
        tableStatuses[t.id] ?? t.status;

    const updateCart = useCallback((update: (lines: CartLine[]) => CartLine[]) => {
        if (!tableId) return;
        setCarts(prev => ({
            ...prev,
            [tableId]: update(prev[tableId] ?? []),
        }));
    }, [tableId]);

    useEffect(() => {
        setEditingNotes(null);
    }, [tableId]);

    // -----------------------------------------------------------------
    // Carrito
    // -----------------------------------------------------------------
    const addToCart = useCallback((p: Product) => {
        updateCart(prev => {
            const ex = prev.find(i => i.productId === p.id);
            if (ex) {
                return prev.map(i => i.productId === p.id
                    ? { ...i, quantity: i.quantity + 1 }
                    : i
                );
            }
            return [...prev, {
                productId: p.id,
                name:      p.name,
                unitPrice: p.price,
                taxRate:   p.tax_rate,
                quantity:  1,
                notes:     "",
            }];
        });
    }, [updateCart]);

    const inc = useCallback((productId: string) => {
        updateCart(prev => prev.map(i => i.productId === productId
            ? { ...i, quantity: i.quantity + 1 } : i
        ));
    }, [updateCart]);

    const dec = useCallback((productId: string) => {
        updateCart(prev => prev
            .map(i => i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i)
            .filter(i => i.quantity > 0)
        );
    }, [updateCart]);

    const remove = useCallback((productId: string) => {
        updateCart(prev => prev.filter(i => i.productId !== productId));
    }, [updateCart]);

    const setNotes = useCallback((productId: string, notes: string) => {
        updateCart(prev => prev.map(i => i.productId === productId
            ? { ...i, notes } : i
        ));
    }, [updateCart]);

    // -----------------------------------------------------------------
    // Cálculos de totales
    // -----------------------------------------------------------------
    const totals = useMemo(() => {
        let subtotal = 0, tax = 0;
        for (const it of cart) {
            const lineSub = it.unitPrice * it.quantity;
            subtotal += lineSub;
            tax += lineSub * (it.taxRate / 100);
        }
        return { subtotal: round2(subtotal), tax: round2(tax), total: round2(subtotal + tax) };
    }, [cart]);

    const itemCount = useMemo(
        () => cart.reduce((a, i) => a + i.quantity, 0),
        [cart]
    );

    // -----------------------------------------------------------------
    // Envío de comanda — ahora persiste en Supabase para que el TPV
    // la vea en tiempo real (además del WebSocket local)
    // -----------------------------------------------------------------
    const sendOrder = useCallback(async () => {
        // ★ v1.9.71: BLINDAJE - nunca crashear por estado de camarero
        if (!selectedTable || cart.length === 0) return;
        // Si activeWaiter es null pero hay sesión en localStorage, recuperarla
        let activeW = auth.activeWaiter;
        if (!activeW) {
            try {
                const ls = localStorage.getItem("mozona.waiter_session");
                if (ls) {
                    const parsed = JSON.parse(ls);
                    if (parsed && parsed.user_id && parsed.name) {
                        activeW = {
                            id: parsed.user_id,
                            name: parsed.name,
                            role: (parsed.role ?? "waiter") as "owner" | "manager" | "waiter" | "kitchen",
                            loggedInAt: parsed.loggedInAt ?? new Date().toISOString(),
                        };
                        console.log("[WaiterPad] activeWaiter recuperado de localStorage");
                    }
                }
            } catch (_) { /* ignore */ }
        }
        // Si sigue sin camarero, no bloquear la UI - usar fallback "Anónimo"
        const waiterName = activeW?.name ?? "Anónimo";

        const items: OrderItemPayload[] = cart.map(c => ({
            productId: c.productId,
            name:      c.name,
            quantity:  c.quantity,
            unitPrice: c.unitPrice,
            notes:     c.notes || undefined,
        }));

        // 1) Notificar vía WebSocket (fallback no-op en cloud)
        ws.sendOrder({
            orderId: `o-${Date.now()}`,
            tableId:     selectedTable.id,
            tableNumber: selectedTable.table_number,
            items,
            subtotal:    totals.subtotal,
            taxAmount:   totals.tax,
            total:       totals.total,
            waiter:      waiterName,
        });

        // 2) Persistir en Supabase (FUENTE DE VERDAD para el TPV)
        //    Usar resolveRealTenantId para bypasear vip-bypass y
        //    cualquier tenant sintético
        const { resolveRealTenantId } = await import("../lib/waiters");
        let tenantId: string | null = await resolveRealTenantId(restaurant?.id ?? null);
        if (!tenantId) {
            // 2a) Sesión camarero (login por username+password)
            try {
                const cached = localStorage.getItem("mozona.waiter_session");
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed.tenant_id) {
                        tenantId = await resolveRealTenantId(parsed.tenant_id);
                    }
                }
            } catch (e) { /* noop */ }
        }
        if (!tenantId && saasAuth.user) {
            // 2b) Admin logueado: el helper ya lo resuelve vía RPC
            try {
                tenantId = await resolveRealTenantId(saasAuth.user.id);
            } catch (e) { /* noop */ }
        }

        if (tenantId) {
            const result = await createOrder({
                tenant_id:   tenantId,
                table_id:    selectedTable.id,
                table_label: String(selectedTable.table_number ?? ""),
                waiter_name: waiterName,
                items: cart.map(c => ({
                    product_id: c.productId,
                    name:       c.name,
                    price:      c.unitPrice,
                    quantity:   c.quantity,
                    notes:      c.notes || null,
                })),
            });
            if (result) {
                console.log("[WaiterPad] comanda persistida en Supabase:", result.order.id);
            } else {
                console.warn("[WaiterPad] no se pudo persistir comanda en Supabase");
            }
        } else {
            console.warn("[WaiterPad] sin tenant_id, comanda sólo enviada por WebSocket");
        }

        // 3) Limpiar carrito
        setLastSentAt(Date.now());
        setCarts(prev => ({ ...prev, [selectedTable.id]: [] }));
        setEditingNotes(null);
    }, [cart, selectedTable, totals, ws, saasAuth.user, restaurant?.id]);

    // Auto-dismiss del toast de éxito
    useEffect(() => {
        if (!lastSentAt) return;
        const t = setTimeout(() => setLastSentAt(null), 3000);
        return () => clearTimeout(t);
    }, [lastSentAt]);

    // -----------------------------------------------------------------
    // Auth handler
    // -----------------------------------------------------------------
    const handlePinSubmit = useCallback((pin: string): Waiter | null => {
        const found = DEMO_WAITERS.find(w => w.pin === pin);
        if (!found) return null;
        const w: Waiter = {
            id: found.id, name: found.name, role: found.role,
            loggedInAt: new Date().toISOString(),
        };
        auth.login(w);
        setShowAuth(false);
        return w;
    }, [auth]);

    // -----------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------
    return (
        <div className="min-h-dvh bg-[#F0F2F5]">
            <Header
                waiter={auth.activeWaiter}
                isConnected={ws.isConnected}
                onLogout={() => { auth.logout(); setShowAuth(true); }}
            />

            {/* Toast flotante de comanda enviada */}
            {lastSentAt && (
                <div
                    key={lastSentAt}
                    className="
                        fixed top-[60px] inset-x-0 z-40
                        flex justify-center pointer-events-none
                    "
                >
                    <div className="
                        pointer-events-auto
                        max-w-md mx-3
                        bg-emerald-600 text-white
                        rounded-2xl shadow-lg shadow-emerald-600/30
                        px-3.5 py-2.5 flex items-center gap-2
                        animate-fade-in-down
                    ">
                        <div className="
                            w-7 h-7 rounded-full
                            bg-white/20 flex items-center justify-center
                        ">
                            <IconCheck size={14} strokeWidth={2.6} />
                        </div>
                        <div className="flex-1">
                            <div className="text-[12px] font-bold leading-tight">
                                Comanda enviada
                            </div>
                            <div className="text-[10.5px] opacity-90 leading-tight">
                                Mesa {selectedTable?.table_number ?? "—"} · Recibida por el TPV
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <main className="max-w-md mx-auto p-3 pb-[calc(env(safe-area-inset-bottom)+7rem)] space-y-3">
                {/* ① Mesa -------------------------------------------- */}
                <Section
                    step={1}
                    title="Mesa"
                    rightSlot={selectedTable && (
                        <span className="
                            text-[10.5px] font-bold text-blue-700
                            bg-blue-50 border border-blue-200/80
                            rounded-full px-2 py-0.5
                        ">
                            Mesa {selectedTable.table_number}
                        </span>
                    )}
                >
                    {loading ? (
                        <Skeleton />
                    ) : tables.length === 0 ? (
                        <div className="py-6 text-center space-y-2">
                            <div className="text-[12px] text-slate-400">
                                No hay mesas configuradas
                            </div>
                            <button
                                type="button"
                                onClick={posDataRefresh}
                                className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
                            >
                                ↻ Reintentar
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                            {tables.map(t => {
                                const status = tableStatus(t);
                                const isSelected = tableId === t.id;
                                return (
                                    <TableButton
                                        key={t.id}
                                        table={t}
                                        status={status}
                                        selected={isSelected}
                                        onClick={() => setTableId(isSelected ? null : t.id)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </Section>

                {/* ② Carta ------------------------------------------- */}
                <Section
                    step={2}
                    title="Carta"
                    rightSlot={categoryId && categories.find(c => c.id === categoryId) && (
                        <span className="
                            text-[10.5px] font-bold text-slate-500
                            bg-slate-100 rounded-full px-2 py-0.5
                        ">
                            {categories.find(c => c.id === categoryId)?.name}
                        </span>
                    )}
                >
                    {/* Categorías */}
                    <div className="-mx-1 mb-2 px-1 flex gap-1.5 overflow-x-auto pb-1">
                        <CategoryPill
                            active={categoryId === null}
                            onClick={() => setCategoryId(null)}
                        >
                            Todo
                        </CategoryPill>
                        {categories.map(c => {
                            // ★ Matching robusto por id O name
                            const cid = c.id ?? c.name;
                            return (
                                <CategoryPill
                                    key={cid}
                                    active={categoryId === cid}
                                    onClick={() => setCategoryId(cid)}
                                >
                                    {c.name}
                                </CategoryPill>
                            );
                        })}
                    </div>

                    {/* Buscador */}
                    <div className="relative mb-2">
                        <IconSearch
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="
                                    absolute right-2 top-1/2 -translate-y-1/2
                                    w-6 h-6 rounded-full
                                    text-slate-400 hover:text-slate-600 hover:bg-slate-100
                                    flex items-center justify-center
                                    active:scale-90 transition
                                "
                            >
                                <IconX size={12} strokeWidth={2.4} />
                            </button>
                        )}
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar plato…"
                            className="
                                w-full h-9 pl-9 pr-9
                                rounded-xl border border-slate-200
                                text-[13px]
                                focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                outline-none transition
                            "
                        />
                    </div>

                    {/* Lista de productos */}
                    <div className="-mx-3 divide-y divide-slate-100">
                        {visibleProducts.length === 0 ? (
                            <div className="px-3 py-8 text-center text-[12px] text-slate-400">
                                {search
                                    ? `No hay resultados para “${search}”`
                                    : "No hay productos en esta categoría"
                                }
                            </div>
                        ) : (
                            visibleProducts.map(p => {
                                const inCart = cart.find(i => i.productId === p.id);
                                return (
                                    <ProductRow
                                        key={p.id}
                                        product={p}
                                        inCart={inCart?.quantity ?? 0}
                                        onAdd={() => addToCart(p)}
                                        onInc={() => inc(p.id)}
                                        onDec={() => dec(p.id)}
                                    />
                                );
                            })
                        )}
                    </div>
                </Section>

                {/* ③ Comanda ----------------------------------------- */}
                {cart.length > 0 && (
                    <Section
                        step={3}
                        title={`Comanda · ${itemCount} ${itemCount === 1 ? "plato" : "platos"}`}
                        rightSlot={(
                            <button
                                onClick={() => {
                                    if (tableId) setCarts(prev => ({ ...prev, [tableId]: [] }));
                                }}
                                className="
                                    text-[10.5px] font-bold text-rose-600
                                    hover:bg-rose-50 rounded-full px-2 py-0.5
                                    active:scale-95 transition
                                "
                            >
                                Vaciar
                            </button>
                        )}
                    >
                        <ul className="-mx-3 divide-y divide-slate-100">
                            {cart.map(it => (
                                <CartLine
                                    key={it.productId}
                                    line={it}
                                    onInc={() => inc(it.productId)}
                                    onDec={() => dec(it.productId)}
                                    onRemove={() => remove(it.productId)}
                                    onEditNotes={() => setEditingNotes(it.productId)}
                                    onChangeNotes={(notes) => setNotes(it.productId, notes)}
                                    isEditing={editingNotes === it.productId}
                                />
                            ))}
                        </ul>

                        {/* Totales */}
                        <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                            <div className="flex justify-between text-[11.5px] text-slate-600">
                                <span>Subtotal</span>
                                <span className="tabular-nums">{fmtEUR(totals.subtotal)}</span>
                            </div>
                            <div className="flex justify-between text-[11.5px] text-slate-600">
                                <span>IVA incluido</span>
                                <span className="tabular-nums">{fmtEUR(totals.tax)}</span>
                            </div>
                            <div className="flex items-end justify-between pt-1.5 border-t border-slate-100">
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    Total
                                </span>
                                <span className="text-[22px] font-black text-slate-900 tabular-nums leading-none">
                                    {fmtEUR(totals.total)}
                                </span>
                            </div>
                        </div>
                    </Section>
                )}
            </main>

            {/* Bottom bar sticky -------------------------------------- */}
            <SendBar
                table={selectedTable}
                itemCount={itemCount}
                total={totals.total}
                disabled={!selectedTable || cart.length === 0}
                onSend={sendOrder}
            />

            {/* Modal de PIN ------------------------------------------- */}
            <PinAuthModal
                isOpen={showAuth}
                pinLength={4}
                title="Camarero · Acceso"
                subtitle="Introduce tu PIN de 4 dígitos"
                onSubmit={handlePinSubmit}
                onCancel={() => setShowAuth(false)}
            />
        </div>
    );
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------

function Header({
    waiter, isConnected, onLogout,
}: { waiter: Waiter | null; isConnected: boolean; onLogout: () => void }) {
    return (
        <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-200/80">
            <div className="max-w-md mx-auto px-3 py-2.5 flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white flex items-center justify-center shadow-sm shadow-blue-600/30">
                    <IconUser size={18} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-slate-900 truncate">
                        {waiter ? waiter.name : "Sin sesión"}
                    </div>
                    <div className="text-[10.5px] flex items-center gap-1.5">
                        <span className={
                            "w-1.5 h-1.5 rounded-full " +
                            (isConnected ? "bg-emerald-500" : "bg-rose-500")
                        } />
                        <span className={isConnected ? "text-emerald-700" : "text-rose-600"}>
                            {isConnected ? "En línea" : "Sin conexión"}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">{waiter ? waiter.role : "—"}</span>
                    </div>
                </div>
                {waiter && (
                    <button
                        onClick={onLogout}
                        className="
                            w-9 h-9 rounded-xl
                            text-slate-500 hover:bg-slate-100 hover:text-slate-700
                            active:scale-95 transition
                            flex items-center justify-center
                        "
                        title="Cerrar sesión"
                    >
                        <IconLogout size={16} strokeWidth={1.8} />
                    </button>
                )}
            </div>
        </div>
    );
}

function Section({
    title, step, children, rightSlot,
}: {
    title:        string;
    step?:        number;
    children:     React.ReactNode;
    rightSlot?:   React.ReactNode;
}) {
    return (
        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
                {step !== undefined && (
                    <span className="
                        w-5 h-5 rounded-full
                        bg-blue-600 text-white
                        text-[10px] font-black
                        flex items-center justify-center shrink-0
                    ">
                        {step}
                    </span>
                )}
                <h2 className="text-[11px] font-black tracking-[0.12em] text-slate-700 uppercase">
                    {title}
                </h2>
                <div className="flex-1" />
                {rightSlot}
            </header>
            <div className="p-3">
                {children}
            </div>
        </section>
    );
}

function SendBar({
    table, itemCount, total, disabled, onSend,
}: {
    table:     RestaurantTable | null;
    itemCount: number;
    total:     number;
    disabled:  boolean;
    onSend:    () => void;
}) {
    const hasItems = itemCount > 0;
    return (
        <div
            className="
                fixed bottom-0 inset-x-0 z-30
                bg-white/95 backdrop-blur-xl
                border-t border-slate-200/80
                shadow-[0_-4px_20px_-4px_rgb(0_0_0_/_0.08)]
                px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]
            "
        >
            <div className="max-w-md mx-auto flex items-center gap-2">
                {/* Resumen carrito (sólo si hay items) */}
                {hasItems && (
                    <div className="flex-1 min-w-0">
                        <div className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                            {itemCount} {itemCount === 1 ? "plato" : "platos"}
                            {table && ` · Mesa ${table.table_number}`}
                        </div>
                        <div className="text-[18px] font-black text-slate-900 tabular-nums leading-none mt-0.5">
                            {fmtEUR(total)}
                        </div>
                    </div>
                )}

                {/* Botón de envío */}
                <button
                    onClick={onSend}
                    disabled={disabled}
                    className={cn(
                        "h-14 rounded-2xl",
                        hasItems ? "px-5" : "flex-1 px-4",
                        "bg-blue-600 text-white",
                        "text-[14px] font-black tracking-wide",
                        "shadow-lg shadow-blue-600/30",
                        "disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
                        "active:scale-95 transition",
                    )}
                >
                    {!table
                        ? "Selecciona una mesa"
                        : !hasItems
                            ? `Mesa ${table.table_number} · añade productos`
                            : `Marchar Comanda`
                    }
                </button>
            </div>
        </div>
    );
}

function Skeleton() {
    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 rounded-xl bg-slate-100 animate-pulse" />
            ))}
        </div>
    );
}

function CategoryPill({
    active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`
                shrink-0 px-3 h-8 rounded-full
                text-[12.5px] font-semibold whitespace-nowrap
                transition active:scale-95
                ${active
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }
            `}
        >
            {children}
        </button>
    );
}

const STATUS_TONES: Record<TableStatus, { idle: string; active: string }> = {
    FREE:           { idle: "bg-emerald-100 text-emerald-800",   active: "bg-emerald-500 text-white" },
    OCCUPIED:       { idle: "bg-blue-100 text-blue-800",         active: "bg-blue-500 text-white" },
    BILL_REQUESTED: { idle: "bg-amber-100 text-amber-800",       active: "bg-amber-500 text-white" },
    RESERVED:       { idle: "bg-violet-100 text-violet-800",     active: "bg-violet-500 text-white" },
    DIRTY:          { idle: "bg-slate-200 text-slate-600",       active: "bg-slate-500 text-white" },
};

function TableButton({
    table, status, selected, onClick,
}: { table: RestaurantTable; status: TableStatus; selected: boolean; onClick: () => void }) {
    const t = STATUS_TONES[status];
    return (
        <button
            onClick={onClick}
            className={`
                h-12 rounded-xl
                text-[14px] font-black tabular-nums
                flex flex-col items-center justify-center
                transition active:scale-95
                border-2 border-transparent
                ${selected
                    ? `${t.active} ring-2 ring-blue-500`
                    : t.idle
                }
            `}
            title={`${table.zone} · ${status}`}
        >
            {table.table_number}
        </button>
    );
}

function ProductRow({
    product, inCart, onAdd, onInc, onDec,
}: {
    product: Product;
    inCart:  number;
    onAdd:   () => void;
    onInc:   () => void;
    onDec:   () => void;
}) {
    return (
        <div className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
            <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                    {product.name}
                </div>
                <div className="text-[10.5px] text-slate-500">
                    IVA {product.tax_rate}%
                </div>
            </div>
            <div className="text-[14px] font-black text-slate-900 tabular-nums shrink-0">
                {fmtEUR(product.price)}
            </div>
            {inCart > 0 ? (
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={onDec}
                        className="
                            w-7 h-7 rounded-lg
                            bg-slate-200 text-slate-700
                            flex items-center justify-center
                            active:scale-90 transition
                        "
                    >
                        <IconMinus size={14} strokeWidth={2.4} />
                    </button>
                    <span className="text-[14px] font-black tabular-nums text-slate-900 w-5 text-center">
                        {inCart}
                    </span>
                    <button
                        onClick={onInc}
                        className="
                            w-7 h-7 rounded-lg
                            bg-blue-600 text-white
                            flex items-center justify-center
                            active:scale-90 transition
                            shadow-sm shadow-blue-600/30
                        "
                    >
                        <IconPlus size={14} strokeWidth={2.4} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={onAdd}
                    className="
                        w-8 h-8 rounded-xl
                        bg-blue-600 text-white
                        flex items-center justify-center
                        active:scale-90 transition
                        shadow-sm shadow-blue-600/30
                    "
                >
                    <IconPlus size={16} strokeWidth={2.4} />
                </button>
            )}
        </div>
    );
}

function CartLine({
    line, onInc, onDec, onRemove, onEditNotes, onChangeNotes, isEditing,
}: {
    line:        CartLine;
    onInc:       () => void;
    onDec:       () => void;
    onRemove:    () => void;
    onEditNotes: () => void;
    onChangeNotes: (notes: string) => void;
    isEditing:   boolean;
}) {
    return (
        <li className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-slate-700 tabular-nums w-6 text-center shrink-0">
                    {line.quantity}×
                </span>
                <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                        {line.name}
                    </div>
                    {line.notes && (
                        <div className="text-[10.5px] text-slate-500 italic truncate">
                            &gt; {line.notes}
                        </div>
                    )}
                </div>
                <div className="text-[13px] font-bold text-slate-900 tabular-nums shrink-0">
                    {fmtEUR(line.unitPrice * line.quantity)}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={onDec}
                        className="w-6 h-6 rounded-md bg-slate-200 text-slate-700 flex items-center justify-center active:scale-90"
                    >
                        <IconMinus size={12} strokeWidth={2.4} />
                    </button>
                    <button
                        onClick={onInc}
                        className="w-6 h-6 rounded-md bg-slate-200 text-slate-700 flex items-center justify-center active:scale-90"
                    >
                        <IconPlus size={12} strokeWidth={2.4} />
                    </button>
                    <button
                        onClick={onRemove}
                        className="w-6 h-6 rounded-md text-slate-300 hover:text-rose-500 flex items-center justify-center active:scale-90"
                    >
                        <IconX size={12} strokeWidth={2.4} />
                    </button>
                </div>
            </div>
            {isEditing && (
                <input
                    type="text"
                    defaultValue={line.notes}
                    onBlur={e => onChangeNotes(e.target.value)}
                    placeholder="Notas para cocina (ej. sin cebolla)"
                    autoFocus
                    className="
                        mt-1.5 w-full h-8 px-2.5
                        rounded-lg border border-slate-200
                        text-[12px]
                        focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                        outline-none transition
                    "
                />
            )}
            {!isEditing && (
                <button
                    onClick={onEditNotes}
                    className="
                        mt-0.5 text-[10.5px] text-blue-600 font-semibold
                        hover:underline
                    "
                >
                    {line.notes ? "✎ Editar notas" : "+ Añadir notas"}
                </button>
            )}
        </li>
    );
}

// ---------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------
// (round2 viene de lib/format)
