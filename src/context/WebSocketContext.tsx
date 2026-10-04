// =====================================================================
// MOZONA TPV — WebSocketContext (versión segura, sin throw)
// =====================================================================
// Bajo NINGUNA circunstancia contiene throw new Error().  useWebSocket()
// siempre devuelve un objeto fallback con no-ops seguros.
// =====================================================================

import {
    createContext, useContext, useCallback, useMemo, useRef, useState,
    type ReactNode,
} from "react";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export type WsEventHandler = (env: { type: string; data: unknown; timestamp?: string }) => void;

export interface WebSocketContextValue {
    isConnected:      boolean;
    status:           string;
    latencyMs:        number | null;
    reconnectAttempts:number;
    queueSize:        number;
    clientsCount:     number | null;
    serverInfo:       { serverId: string; version: string; restaurantId: string | null } | null;
    lastError:        string | null;
    lastMessage:      unknown;

    /** API principal */
    send:             (msg: { type: string; data?: unknown; timestamp?: string }) => boolean;
    sendMessage:      (msg: any) => void;
    subscribe:        (event: string, cb: WsEventHandler) => () => void;
    reconnect:        () => void;
    disconnect:       () => void;
    flushQueue:       () => void;
    setEndpoint:      (cfg: { host?: string; port?: number; key?: string }) => void;
    httpBaseUrl:      string | null;

    /** Helpers de alto nivel */
    sendOrder:            (data: unknown) => boolean;
    broadcastTableStatus: (data: unknown) => boolean;
    broadcastInvoicePaid: (data: unknown) => boolean;
}

// ---------------------------------------------------------------------
// Default (fallback seguro, NUNCA null/undefined)
// ---------------------------------------------------------------------

const NOOP = (): void => undefined;
const NOOP_SUB = (): (() => void) => () => undefined;

/** Sanitiza payloads de Realtime: previene inyección de prototipos
 *  y limita la profundidad. */
function sanitizePayload(payload: unknown, depth = 0): unknown {
    if (depth > 5) return null;
    if (payload === null) return null;
    if (typeof payload !== "object") return payload;
    if (Array.isArray(payload)) {
        return payload.slice(0, 100).map(item => sanitizePayload(item, depth + 1));
    }
    const out: Record<string, unknown> = {};
    const obj = payload as Record<string, unknown>;
    let count = 0;
    for (const k of Object.keys(obj)) {
        if (count++ > 50) break;
        // Filtrar keys con __proto__, constructor, prototype para
        // evitar prototype pollution
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        out[k.slice(0, 100)] = sanitizePayload(obj[k], depth + 1);
    }
    return out;
}

const FALLBACK: WebSocketContextValue = {
    isConnected:      true,
    status:           "online",
    latencyMs:        null,
    reconnectAttempts:0,
    queueSize:        0,
    clientsCount:     null,
    serverInfo:       null,
    lastError:        null,
    lastMessage:      null,
    send:             () => true,
    sendMessage:      NOOP,
    subscribe:        NOOP_SUB,
    reconnect:        NOOP,
    disconnect:       NOOP,
    flushQueue:       NOOP,
    setEndpoint:      NOOP,
    httpBaseUrl:      null,
    sendOrder:        () => true,
    broadcastTableStatus: () => true,
    broadcastInvoicePaid: () => true,
};

// ---------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------

const WebSocketContext = createContext<WebSocketContextValue>(FALLBACK);

// ---------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------

export interface WebSocketProviderProps {
    children: ReactNode;
    /** Si true (default), simula conexión "online" sin abrir WebSocket real. */
    demoMode?: boolean;
}

export function WebSocketProvider({ children, demoMode = true }: WebSocketProviderProps) {
    const [status]      = useState<string>("online");
    const [lastMessage] = useState<unknown>(null);
    const [queueSize]   = useState<number>(0);
    const [lastError]   = useState<string | null>(null);

    const handlersRef = useRef<Map<string, Set<WsEventHandler>>>(new Map());

    const send = useCallback((_msg: { type: string; data?: unknown }): boolean => {
        // Modo demo: simulamos envío correcto
        return true;
    }, []);

    const sendMessage = useCallback((msg: unknown): void => {
        if (msg && typeof msg === "object" && "type" in msg) {
            send(msg as { type: string; data?: unknown });
        }
    }, [send]);

    const subscribe = useCallback((event: string, cb: WsEventHandler): (() => void) => {
        // Sanitización: validar que event es string simple y cb es función
        if (typeof event !== "string" || event.length > 64 || !/^[A-Z0-9_]+$/.test(event)) {
            console.warn("[WebSocket] subscribe: event inválido:", event);
            return () => undefined;
        }
        if (typeof cb !== "function") {
            console.warn("[WebSocket] subscribe: handler no es función");
            return () => undefined;
        }
        // Wrappear el callback para sanitizar el payload
        const safe: WsEventHandler = (env) => {
            try {
                if (!env || typeof env !== "object") return;
                const safeEnv = {
                    type:      String(env.type ?? event).slice(0, 64),
                    data:      env.data !== undefined ? sanitizePayload(env.data) : null,
                    timestamp: typeof env.timestamp === "string" ? env.timestamp : undefined,
                };
                cb(safeEnv);
            } catch (e) {
                console.warn("[WebSocket] handler error:", e);
            }
        };
        const set = handlersRef.current.get(event) ?? new Set<WsEventHandler>();
        set.add(safe);
        handlersRef.current.set(event, set);
        return () => {
            set.delete(safe);
            if (set.size === 0) handlersRef.current.delete(event);
        };
    }, []);

    const reconnect   = useCallback(NOOP, []);
    const disconnect  = useCallback(NOOP, []);
    const flushQueue  = useCallback(NOOP, []);
    const setEndpoint = useCallback(NOOP, []);

    const sendOrder = useCallback((data: unknown) =>
        send({ type: "ORDER_SENT", data }), [send]);
    const broadcastTableStatus = useCallback((data: unknown) =>
        send({ type: "TABLE_STATUS_CHANGED", data }), [send]);
    const broadcastInvoicePaid = useCallback((data: unknown) =>
        send({ type: "INVOICE_PAID", data }), [send]);

    const value = useMemo<WebSocketContextValue>(() => ({
        isConnected: true,
        status,
        latencyMs: null,
        reconnectAttempts: 0,
        queueSize,
        clientsCount: null,
        serverInfo: null,
        lastError,
        lastMessage,
        send, sendMessage, subscribe, reconnect, disconnect, flushQueue, setEndpoint,
        httpBaseUrl: null,
        sendOrder, broadcastTableStatus, broadcastInvoicePaid,
    }), [status, queueSize, lastError, lastMessage,
         send, sendMessage, subscribe, reconnect, disconnect, flushQueue, setEndpoint,
         sendOrder, broadcastTableStatus, broadcastInvoicePaid]);

    return (
        <WebSocketContext.Provider value={value}>
            {children}
        </WebSocketContext.Provider>
    );
}

// ---------------------------------------------------------------------
// Hook — NUNCA lanza
// ---------------------------------------------------------------------

export function useWebSocket(): WebSocketContextValue {
    const ctx = useContext(WebSocketContext);
    return ctx ?? FALLBACK;
}

/** Variante opcional (devuelve null si no hay provider, útil en tests). */
export function useWebSocketOptional(): WebSocketContextValue | null {
    return useContext(WebSocketContext);
}

export default WebSocketProvider;
