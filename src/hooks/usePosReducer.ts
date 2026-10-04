// =====================================================================
// MOZONA TPV — usePosReducer: estado central del terminal
// =====================================================================
// Maneja el pedido activo, el importe en el numpad, los flags de UI
// y los resultados VeriFactu. Diseñado para que las acciones se puedan
// despachar desde cualquier componente sin prop-drilling.
// =====================================================================

import { useReducer, useCallback, useMemo } from "react";
import type {
    OrderItem, Product, PaymentMethod, VeriFactuResult, VeriFactuStatus,
} from "../lib/types";
import { round2 } from "../lib/format";

export interface PosState {
    selectedCategoryId: string | null;
    selectedTableId:    string | null;
    selectedTableLabel: string | null;
    orderItems:         OrderItem[];
    draftsByTable:      Record<string, OrderItem[]>;
    paymentAmount:      string;
    paymentMethod:      PaymentMethod | null;
    isProcessing:       boolean;
    verifactuStatus:    VeriFactuStatus;
    lastError:          string | null;
    verifactuResult:    VeriFactuResult | null;
    isCustomerDisplayOpen: boolean;
    isMenuScannerOpen:  boolean;
    highlightItemId:    string | null;
}

export type PosAction =
    | { type: "SELECT_CATEGORY"; categoryId: string | null }
    | { type: "SELECT_TABLE"; tableId: string | null; tableLabel: string | null }
    | { type: "ADD_PRODUCT"; product: Product }
    | { type: "INCREMENT_ITEM"; itemId: string }
    | { type: "DECREMENT_ITEM"; itemId: string }
    | { type: "REMOVE_ITEM"; itemId: string }
    | { type: "UPDATE_NOTES"; itemId: string; notes: string }
    | { type: "CLEAR_ORDER" }
    | { type: "RESTORE_DRAFTS"; drafts: Record<string, OrderItem[]> }
    | { type: "NUMPAD_KEY"; key: string }
    | { type: "NUMPAD_RESET" }
    | { type: "SET_PAYMENT_METHOD"; method: PaymentMethod | null }
    | { type: "SET_PROCESSING"; processing: boolean }
    | { type: "SET_VERIFACTU_STATUS"; status: VeriFactuStatus; result?: VeriFactuResult | null; error?: string | null }
    | { type: "SET_ERROR"; error: string | null }
    | { type: "TOGGLE_CUSTOMER_DISPLAY"; open?: boolean }
    | { type: "TOGGLE_MENU_SCANNER"; open?: boolean }
    | { type: "HIGHLIGHT_ITEM"; itemId: string | null };

const initialState: PosState = {
    selectedCategoryId: null,
    selectedTableId: null,
    selectedTableLabel: null,
    orderItems: [],
    draftsByTable: {},
    paymentAmount: "",
    paymentMethod: null,
    isProcessing: false,
    verifactuStatus: "IDLE",
    lastError: null,
    verifactuResult: null,
    isCustomerDisplayOpen: false,
    isMenuScannerOpen: false,
    highlightItemId: null,
};

function withOrderItems(
    state: PosState,
    orderItems: OrderItem[],
    highlightItemId = state.highlightItemId,
): PosState {
    if (!state.selectedTableId) return { ...state, orderItems, highlightItemId };
    return {
        ...state,
        orderItems,
        highlightItemId,
        draftsByTable: { ...state.draftsByTable, [state.selectedTableId]: orderItems },
    };
}

function reducer(state: PosState, action: PosAction): PosState {
    switch (action.type) {
        case "SELECT_CATEGORY":
            return { ...state, selectedCategoryId: action.categoryId };
        case "SELECT_TABLE": {
            const draftsByTable = { ...state.draftsByTable };
            if (state.selectedTableId) draftsByTable[state.selectedTableId] = state.orderItems;
            return {
                ...state,
                selectedTableId: action.tableId,
                selectedTableLabel: action.tableLabel,
                orderItems: action.tableId ? draftsByTable[action.tableId] ?? [] : [],
                draftsByTable,
                highlightItemId: null,
            };
        }
        case "ADD_PRODUCT": {
            const existing = state.orderItems.find(i => i.product_id === action.product.id);
            let items: OrderItem[];
            let newId: string;
            if (existing) {
                items = state.orderItems.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i);
                newId = existing.id;
            } else {
                const newItem: OrderItem = {
                    id: crypto.randomUUID(), product_id: action.product.id, name: action.product.name,
                    unit_price: action.product.price, tax_rate: action.product.tax_rate, quantity: 1,
                    notes: "", added_at: new Date().toISOString(),
                };
                items = [...state.orderItems, newItem];
                newId = newItem.id;
            }
            return withOrderItems(state, items, newId);
        }
        case "INCREMENT_ITEM":
            return withOrderItems(state, state.orderItems.map(i =>
                i.id === action.itemId ? { ...i, quantity: i.quantity + 1 } : i
            ), action.itemId);
        case "DECREMENT_ITEM": {
            const items = state.orderItems
                .map(i => i.id === action.itemId ? { ...i, quantity: i.quantity - 1 } : i)
                .filter(i => i.quantity > 0);
            return withOrderItems(state, items);
        }
        case "REMOVE_ITEM":
            return withOrderItems(state, state.orderItems.filter(i => i.id !== action.itemId));
        case "UPDATE_NOTES":
            return withOrderItems(state, state.orderItems.map(i =>
                i.id === action.itemId ? { ...i, notes: action.notes } : i
            ));
        case "CLEAR_ORDER": {
            const draftsByTable = { ...state.draftsByTable };
            if (state.selectedTableId) delete draftsByTable[state.selectedTableId];
            return {
                ...state, orderItems: [], draftsByTable, paymentAmount: "", paymentMethod: null,
                verifactuStatus: "IDLE", verifactuResult: null, lastError: null,
            };
        }
        case "RESTORE_DRAFTS": {
            // Fusionar borradores persistidos con los que ya estén en memoria
            // y cargar el de la mesa actualmente seleccionada
            const draftsByTable = { ...state.draftsByTable, ...action.drafts };
            const orderItems = state.selectedTableId
                ? (draftsByTable[state.selectedTableId] ?? state.orderItems)
                : state.orderItems;
            return { ...state, draftsByTable, orderItems };
        }
        case "NUMPAD_KEY": {
            const k = action.key;
            let amount = state.paymentAmount;
            if (k === "C") amount = "";
            else if (k === "⌫") amount = amount.slice(0, -1);
            else if (k === "," || k === ".") {
                if (!amount.includes(",") && !amount.includes(".")) amount = (amount || "0") + ",";
            } else {
                amount = amount === "0" ? k : amount + k;
                const parts = amount.split(/[,\.]/);
                if (parts[1] && parts[1].length > 2) amount = parts[0] + "," + parts[1].slice(0, 2);
            }
            return { ...state, paymentAmount: amount };
        }
        case "NUMPAD_RESET": {
            return { ...state, paymentAmount: "" };
        }
        case "SET_PAYMENT_METHOD": return { ...state, paymentMethod: action.method };
        case "SET_PROCESSING": return { ...state, isProcessing: action.processing };
        case "SET_VERIFACTU_STATUS":
            return {
                ...state, verifactuStatus: action.status,
                verifactuResult: action.result !== undefined ? action.result : state.verifactuResult,
                lastError: action.error !== undefined ? action.error : state.lastError,
            };
        case "SET_ERROR": return { ...state, lastError: action.error };
        case "TOGGLE_CUSTOMER_DISPLAY":
            return { ...state, isCustomerDisplayOpen: action.open !== undefined ? action.open : !state.isCustomerDisplayOpen };
        case "TOGGLE_MENU_SCANNER":
            return { ...state, isMenuScannerOpen: action.open !== undefined ? action.open : !state.isMenuScannerOpen };
        case "HIGHLIGHT_ITEM": return { ...state, highlightItemId: action.itemId };
        default: return state;
    }
}

export interface UsePosResult {
    state: PosState;
    dispatch: React.Dispatch<PosAction>;
    subtotal: number;
    taxByRate: Array<{ rate: number; base: number; tax: number; label: string }>;
    total: number;
    itemCount: number;
    cashReceived: number;
    change: number;
    addProduct: (p: Product) => void;
    clearOrder: () => void;
}

export function usePosReducer(): UsePosResult {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { subtotal, taxByRate, total, itemCount } = useMemo(() => {
        // Los precios de la carta YA TIENEN el IVA incluido (hostelería España).
        // El cliente paga exactamente la suma de los precios.
        // El desglose fiscal es: base = total / (1 + rate/100), iva = total - base.
        let total = 0;  // total a pagar (= suma de precios de carta)
        const byRate = new Map<number, { base: number; tax: number }>();
        for (const it of state.orderItems) {
            const unit = Number(it.unit_price ?? 0);
            const qty  = Number(it.quantity   ?? 0);
            const rate = Number(it.tax_rate  ?? 10);
            const lineSub = unit * qty;  // precio total de la línea (con IVA)
            total += lineSub;
            // Desglose: precio CON IVA → base imponible
            const base = lineSub / (1 + rate / 100);
            const tax  = lineSub - base;
            const cur = byRate.get(rate) ?? { base: 0, tax: 0 };
            cur.base += base;
            cur.tax  += tax;
            byRate.set(rate, cur);
        }
        const arr = Array.from(byRate.entries()).sort((a, b) => b[0] - a[0]).map(([rate, value]) => ({
            rate, base: round2(value.base), tax: round2(value.tax),
            label: rate === 10 ? "Restauración" : rate === 21 ? "Bebidas alcohólicas" : `IVA ${rate}%`,
        }));
        const totalBase = arr.reduce((acc, v) => acc + v.base, 0);
        return {
            subtotal:  round2(totalBase),   // base imponible (lo que se muestra en comanda)
            taxByRate: arr,
            total:     round2(total),        // total = base + iva (igual a suma de precios)
            itemCount: state.orderItems.reduce((acc, item) => acc + item.quantity, 0),
        };
    }, [state.orderItems]);
    const cashReceived = useMemo(() => {
        if (!state.paymentAmount) return 0;
        return round2(parseFloat(state.paymentAmount.replace(",", ".")));
    }, [state.paymentAmount]);
    const change = round2(Math.max(0, cashReceived - total));
    const addProduct = useCallback((p: Product) => dispatch({ type: "ADD_PRODUCT", product: p }), []);
    const clearOrder = useCallback(() => dispatch({ type: "CLEAR_ORDER" }), []);
    return { state, dispatch, subtotal, taxByRate, total, itemCount, cashReceived, change, addProduct, clearOrder };
}
