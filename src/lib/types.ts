// =====================================================================
// MOZONA TPV — Tipos compartidos (cliente)
// =====================================================================
// Estricto. Cada tipo refleja la forma del JSON que devuelve el
// backend (Rust o Supabase) o que el frontend manipula en estado.
// =====================================================================

// ---------------------------------------------------------------------
// Datos del backend
// ---------------------------------------------------------------------

export interface Restaurant {
    id: string;
    slug: string;
    business_name: string;
    cif_nif: string;
    address: string;
    phone: string | null;
    primary_color: string;
    ticket_footer_msg: string;
    created_at: string;
}

export interface Category {
    id: string;
    restaurant_id: string;
    name: string;
    sort_order: number;
}

export interface Product {
    id: string;
    restaurant_id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    price: number;
    /** 10 = restauración, 21 = bebidas alcohólicas, 4 = otros */
    tax_rate: number;
    is_available: boolean;
    /** URL de imagen del producto (tema, alta calidad).  Opcional. */
    image_url?: string | null;
}

export type TableStatus = "FREE" | "OCCUPIED" | "BILL_REQUESTED" | "RESERVED" | "DIRTY";

export interface RestaurantTable {
    id: string;
    restaurant_id: string;
    zone_id: string | null;
    zone: string | null;
    table_number: string;
    status: TableStatus;
}

export interface Zone {
    id: string;
    restaurant_id: string;
    name: string;
}

// ---------------------------------------------------------------------
// Camareros
// ---------------------------------------------------------------------

export type WaiterRole = "owner" | "manager" | "waiter" | "kitchen";

/** Camarero de un restaurante (PIN, rol, activo). */
export interface Waiter {
    id: string;
    name: string;
    pin?: string;
    role?: WaiterRole;
    restaurant_id?: string;
    /** ISO timestamp del inicio de sesión (opcional) */
    loggedInAt?: string;
}

/**
 * Línea de pedido lista para enviar al backend.  Es la forma que
 * usa el push a Supabase (`order_items`).
 */
export interface OrderItemPayload {
    id?: string;
    article_id: string;
    name: string;
    price: number;
    quantity: number;
    notes?: string;
    tax_rate?: number;
}

// ---------------------------------------------------------------------
// Estado del pedido (cliente)
// ---------------------------------------------------------------------

export interface OrderItem {
    /** UUID generado en cliente */
    id: string;
    product_id: string;
    name: string;
    /** Precio unitario en el momento de añadir (puede cambiar si edita) */
    unit_price: number;
    tax_rate: number;
    quantity: number;
    notes: string;
    /** ISO o epoch ms — el cliente lo rellena al añadir, el WS lo reenvía */
    added_at: string | number;
}

export type PaymentMethod = "CASH" | "CARD" | "BIZUM" | "TRANSFER" | "OTHER";

export type VeriFactuStatus = "IDLE" | "PROCESSING" | "ISSUED" | "ERROR";

export interface VeriFactuResult {
    invoice_id: string;
    series: string;
    number: number;
    total: number;
    qr_svg: string;
    qr_url: string;
    current_hash: string;
    created_at: string;
}

// ---------------------------------------------------------------------
// Estado del modal de scanner
// ---------------------------------------------------------------------

export interface ExtractedProduct {
    /** ID temporal del cliente, no de la DB */
    tempId: string;
    name: string;
    description: string;
    price: number;
    tax_rate: number;
    categoryName: string;
    selected: boolean;
}

export interface ExtractedCategory {
    name: string;
    products: ExtractedProduct[];
}

// ---------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------

/** Eventos realtime que llegan del WebSocket del servidor LAN. */
export type RealtimeEvent =
    | { type: "order_created";  order_id: string; table: string }
    | { type: "order_updated";  order_id: string; status: string }
    | { type: "invoice_issued"; invoice_id: string; total: number }
    | { type: "menu_updated";   version: number }
    | { type: "printer_status"; connected: boolean; info?: string };

/** Conexión reportada por el backend. */
export interface ConnectionStatus {
    printer:  boolean;
    network:  boolean;
    supabase: boolean;
}
