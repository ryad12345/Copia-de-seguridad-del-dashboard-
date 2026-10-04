// =====================================================================
// MOZONA TPV — Protocolo de eventos WebSocket (compartido cliente+servidor)
// =====================================================================
// Formato del envelope (idéntico en ambas direcciones):
//   { type: "EVENT_NAME", data: {...}, timestamp: ISO8601, sender?: "..." }
//
// Cliente → Servidor:
//   • PING                       — heartbeat
//   • ORDER_SENT                 — comanda enviada desde un móvil
//   • TABLE_STATUS_CHANGED       — cambio de estado de mesa
//   • INVOICE_PAID               — factura VeriFactu cobrada
//
// Servidor → Cliente:
//   • WELCOME                    — info inicial al conectar
//   • PONG                       — respuesta a PING
//   • CLIENTS_CHANGED            — número de clientes conectados
//   • ERROR                      — error de validación
//   • + todos los eventos de cliente re-emitidos con campo `sender`
// =====================================================================

// ---------------------------------------------------------------------
// Estado de mesa (extendido con BILL_REQUESTED que la UI puede usar)
// ---------------------------------------------------------------------
export type TableStatus =
    | "FREE"
    | "OCCUPIED"
    | "BILL_REQUESTED"
    | "RESERVED"
    | "DIRTY";

// ---------------------------------------------------------------------
// Payloads por evento
// ---------------------------------------------------------------------

export interface OrderItemPayload {
    productId:  string;
    name:       string;
    quantity:   number;
    unitPrice:  number;
    notes?:     string;
}

export interface OrderSentData {
    orderId:      string;
    tableId:      string;
    tableNumber:  string;
    items:        OrderItemPayload[];
    subtotal:     number;
    taxAmount:    number;
    total:        number;
    waiter:       string;
    notes?:       string;
    /** ISO8601 o ms epoch — cuándo se emitió la comanda */
    timestamp?:   number | string;
}

export interface TableStatusChangedData {
    tableId:      string;
    tableNumber:  string;
    zone?:        string;
    previousStatus: TableStatus;
    newStatus:    TableStatus;
    changedBy:    string;          // nombre del camarero o "TPV"
}

export interface InvoicePaidData {
    invoiceId:    string;
    orderId:      string;
    series:       string;
    number:       number;
    total:        number;
    paymentMethod: "CASH" | "CARD" | "BIZUM" | "TRANSFER" | "OTHER";
    tableId:      string;
    tableNumber:  string;
    qrUrl:        string;
    verifactuHash: string;
}

export interface WelcomeData {
    serverId:     string;
    version:      string;
    clients:      number;
    restaurantId: string | null;
}

export interface PongData {
    /** Latencia en ms (se completa con timestamp del PING) */
    latencyMs:    number;
    serverTime:   string;
}

export interface ClientsChangedData {
    count:        number;
}

export interface ErrorData {
    code:         string;
    message:      string;
    details?:     unknown;
}

// ---------------------------------------------------------------------
// Envelope genérico
// ---------------------------------------------------------------------

export interface WsEnvelope<T = unknown> {
    type:      string;
    data:      T;
    timestamp: string;
    /** Identificador del cliente que originó el mensaje (server lo añade) */
    sender?:   string;
}

// ---------------------------------------------------------------------
// Mapa de tipos a payloads
// ---------------------------------------------------------------------

export interface ClientToServerMap {
    PING:                  { timestamp: number };
    ORDER_SENT:            OrderSentData;
    TABLE_STATUS_CHANGED:  TableStatusChangedData;
    INVOICE_PAID:          InvoicePaidData;
}

export interface ServerToClientMap {
    WELCOME:               WelcomeData;
    PONG:                  PongData;
    CLIENTS_CHANGED:       ClientsChangedData;
    ERROR:                 ErrorData;
    // Eco de los eventos del cliente
    ORDER_SENT:            OrderSentData;
    TABLE_STATUS_CHANGED:  TableStatusChangedData;
    INVOICE_PAID:          InvoicePaidData;
}

export type ClientEventType = keyof ClientToServerMap;
export type ServerEventType = keyof ServerToClientMap;

// ---------------------------------------------------------------------
// Helpers para construir envelopes tipados
// ---------------------------------------------------------------------

export function makeEvent<T extends ServerEventType>(
    type: T,
    data: ServerToClientMap[T],
    sender?: string,
): WsEnvelope<ServerToClientMap[T]> {
    return { type, data, timestamp: new Date().toISOString(), sender };
}

export function makeClientEvent<T extends ClientEventType>(
    type: T,
    data: ClientToServerMap[T],
): WsEnvelope<ClientToServerMap[T]> {
    return { type, data, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Type guards (útiles en tiempo de ejecución)
// ---------------------------------------------------------------------

export function isServerEvent<K extends ServerEventType>(
    env: WsEnvelope,
    type: K,
): env is WsEnvelope<ServerToClientMap[K]> {
    return env.type === type;
}

export function isClientEvent<K extends ClientEventType>(
    env: WsEnvelope,
    type: K,
): env is WsEnvelope<ClientToServerMap[K]> {
    return env.type === type;
}
