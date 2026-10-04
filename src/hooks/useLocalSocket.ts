// =====================================================================
// MOZONA TPV — useLocalSocket
// =====================================================================
// Hook React sobre la API WebSocket nativa con:
//   • Auto-reconnect con backoff exponencial (1s → 30s)
//   • Cola de mensajes salientes mientras está desconectado
//   • Heartbeat (PING cada 25s) para detectar red caída
//   • Suscripción tipada por tipo de evento
//   • Estado de conexión expuesto (connecting | connected | reconnecting | closed)
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type {
    WsEnvelope, ClientEventType, ServerEventType,
    ClientToServerMap, ServerToClientMap,
} from "../../shared/ws-events";

// ---------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------

export type ConnectionState =
    | "connecting"   // primera conexión, sin reintentos
    | "connected"    // ws abierto y welcome recibido
    | "reconnecting" // cayó la conexión, reintentando con backoff
    | "closed";      // cerrado voluntariamente (desmontaje o error fatal)

export interface UseLocalSocketOptions {
    /**
     * URL completa del WS. Si cambia, se cierra y reconecta.
     * Si es `null`, el socket NO se conecta y queda en estado
     * `closed` (útil cuando no hay caja central configurada).
     */
    url:            string | null;
    /** Reconectar al montar (default true) */
    autoConnect?:   boolean;
    /** Intervalo de PING en ms (default 25_000) */
    heartbeatMs?:   number;
    /** Backoff inicial en ms (default 1_000) */
    backoffStartMs?: number;
    /** Backoff máximo en ms (default 30_000) */
    backoffMaxMs?:  number;
    /** Habilitar logs en consola */
    debug?:         boolean;
}

export interface UseLocalSocketReturn {
    state:            ConnectionState;
    isConnected:      boolean;
    /** Latencia del último PING (ms) */
    latencyMs:        number | null;
    /** Número de reintentos consecutivos (se resetea al conectar) */
    reconnectAttempts: number;
    /** Mensajes encolados (no enviados aún) */
    queueSize:        number;
    /** Clientes conectados (reporte del server) */
    clientsCount:     number | null;
    /** Info del servidor (versión + ID) tras WELCOME */
    serverInfo:       { serverId: string; version: string; restaurantId: string | null } | null;
    /** Error de validación del último mensaje del server (si lo hubo) */
    lastError:        string | null;

    /** Envía un evento tipado. Si no hay conexión, lo encola. */
    send: <T extends ClientEventType>(type: T, data: ClientToServerMap[T]) => boolean;
    /** Suscribe a un evento del server. Devuelve función de cleanup. */
    subscribe: <T extends ServerEventType>(
        type: T,
        handler: (env: WsEnvelope<ServerToClientMap[T]>) => void,
    ) => () => void;
    /** Fuerza un reconnect inmediato. */
    reconnect: () => void;
    /** Cierra la conexión voluntariamente. */
    disconnect: () => void;
    /** Vacía la cola de salida. */
    flushQueue: () => void;
}

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------

export function useLocalSocket(opts: UseLocalSocketOptions): UseLocalSocketReturn {
    const {
        url, autoConnect = true,
        heartbeatMs = 25_000,
        backoffStartMs = 1_000,
        backoffMaxMs = 30_000,
        debug = false,
    } = opts;

    // Estado React expuesto a la UI --------------------------------
    const [state, setState]             = useState<ConnectionState>("closed");
    const [latencyMs, setLatencyMs]     = useState<number | null>(null);
    const [reconnectAttempts, setRA]    = useState(0);
    const [queueSize, setQueueSize]     = useState(0);
    const [clientsCount, setCC]         = useState<number | null>(null);
    const [serverInfo, setServerInfo]   = useState<UseLocalSocketReturn["serverInfo"]>(null);
    const [lastError, setLastError]     = useState<string | null>(null);

    // Refs para datos que NO deben triggerear re-renders -------------
    const wsRef             = useRef<WebSocket | null>(null);
    const handlersRef       = useRef<Map<string, Set<(env: WsEnvelope) => void>>>(new Map());
    const queueRef          = useRef<Array<{ type: string; data: unknown }>>([]);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const manualCloseRef    = useRef(false);
    const lastPingSentRef   = useRef<number>(0);

    // Log helper -----------------------------------------------------
    const log = useCallback((...args: unknown[]) => {
        if (debug) console.log("[useLocalSocket]", ...args);
    }, [debug]);

    // -----------------------------------------------------------------
    // Envío
    // -----------------------------------------------------------------

    const send = useCallback(<T extends ClientEventType>(type: T, data: ClientToServerMap[T]): boolean => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            const env: WsEnvelope = { type, data, timestamp: new Date().toISOString() };
            try {
                ws.send(JSON.stringify(env));
                return true;
            } catch (e) {
                log("send error:", e);
            }
        }
        // Encolar
        queueRef.current.push({ type, data });
        setQueueSize(queueRef.current.length);
        log("queued", type, "(queue=", queueRef.current.length, ")");
        return false;
    }, [log]);

    const flushQueue = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const drained = queueRef.current.splice(0);
        for (const msg of drained) {
            try {
                ws.send(JSON.stringify({
                    type:      msg.type,
                    data:      msg.data,
                    timestamp: new Date().toISOString(),
                }));
            } catch (e) {
                log("flush error:", e);
            }
        }
        setQueueSize(0);
        if (drained.length > 0) log("flushed", drained.length, "messages");
    }, [log]);

    // -----------------------------------------------------------------
    // Suscripción
    // -----------------------------------------------------------------

    const subscribe = useCallback(<T extends ServerEventType>(
        type: T,
        handler: (env: WsEnvelope<ServerToClientMap[T]>) => void,
    ): (() => void) => {
        const set = handlersRef.current.get(type) ?? new Set();
        set.add(handler as (env: WsEnvelope) => void);
        handlersRef.current.set(type, set);
        log("subscribe", type, "(total:", set.size, ")");
        return () => {
            set.delete(handler as (env: WsEnvelope) => void);
            log("unsubscribe", type, "(remaining:", set.size, ")");
        };
    }, [log]);

    // -----------------------------------------------------------------
    // Conexión
    // -----------------------------------------------------------------

    const connect = useCallback(() => {
        if (typeof WebSocket === "undefined") {
            log("WebSocket no disponible (¿SSR?)");
            return;
        }
        if (!url) {
            log("sin URL, no se intenta conectar (no hay caja central configurada)");
            setState("closed");
            return;
        }
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
            log("ya hay un socket abierto, skip");
            return;
        }
        manualCloseRef.current = false;
        setState(prev => prev === "reconnecting" ? "reconnecting" : "connecting");
        setLastError(null);

        log("connecting →", url);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
            log("open");
            setRA(0);
            setState("connected");
            // Enviar PING inmediato para tener latencia
            lastPingSentRef.current = Date.now();
            ws.send(JSON.stringify({ type: "PING", data: { timestamp: lastPingSentRef.current }, timestamp: new Date().toISOString() }));
            // Reenviar cola
            flushQueue();
            // Programar heartbeats
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    lastPingSentRef.current = Date.now();
                    wsRef.current.send(JSON.stringify({
                        type: "PING",
                        data: { timestamp: lastPingSentRef.current },
                        timestamp: new Date().toISOString(),
                    }));
                }
            }, heartbeatMs);
        });

        ws.addEventListener("message", (e) => {
            let env: WsEnvelope;
            try {
                env = JSON.parse(typeof e.data === "string" ? e.data : "");
            } catch {
                return;
            }
            if (!env?.type) return;

            // Manejo de mensajes internos
            if (env.type === "PONG") {
                const d = env.data as { latencyMs?: number };
                if (typeof d.latencyMs === "number") setLatencyMs(d.latencyMs);
            } else if (env.type === "WELCOME") {
                const d = env.data as { serverId: string; version: string; clients: number; restaurantId: string | null };
                setServerInfo({
                    serverId: d.serverId, version: d.version,
                    restaurantId: d.restaurantId,
                });
                setCC(d.clients);
            } else if (env.type === "CLIENTS_CHANGED") {
                setCC((env.data as { count: number }).count);
            } else if (env.type === "ERROR") {
                const d = env.data as { message: string };
                setLastError(d.message);
            }

            // Despachar a suscriptores
            const handlers = handlersRef.current.get(env.type);
            if (handlers) {
                for (const h of handlers) {
                    try { h(env); }
                    catch (err) { log("handler error:", err); }
                }
            }
        });

        ws.addEventListener("close", (e) => {
            log("close", e.code, e.reason);
            wsRef.current = null;
            if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current);
                heartbeatTimerRef.current = null;
            }
            if (manualCloseRef.current) {
                setState("closed");
                return;
            }
            // Programar reconexión
            setState("reconnecting");
            setRA(prev => {
                const next = prev + 1;
                const backoff = Math.min(backoffMaxMs, backoffStartMs * Math.pow(2, prev));
                const jitter  = backoff * 0.2 * Math.random();
                const delay   = Math.round(backoff + jitter);
                log(`reconnect in ${delay}ms (attempt ${next})`);
                if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = setTimeout(() => {
                    setRA(0); // reset visual; connect() reintenta y bump-ea si falla
                    connect();
                }, delay);
                return next;
            });
        });

        ws.addEventListener("error", (e) => {
            log("error", e);
            setLastError("Error de red");
            // close() se invocará a continuación
        });
    }, [url, heartbeatMs, backoffStartMs, backoffMaxMs, flushQueue, log]);

    const disconnect = useCallback(() => {
        manualCloseRef.current = true;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (heartbeatTimerRef.current) {
            clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = null;
        }
        if (wsRef.current) {
            try { wsRef.current.close(1000, "Manual disconnect"); } catch { /* ignore */ }
            wsRef.current = null;
        }
        setState("closed");
    }, []);

    const reconnect = useCallback(() => {
        if (wsRef.current) {
            try { wsRef.current.close(1000, "Forced reconnect"); } catch { /* ignore */ }
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        setRA(0);
        connect();
    }, [connect]);

    // -----------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------

    useEffect(() => {
        if (autoConnect && url) connect();
        return () => {
            manualCloseRef.current = true;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
            if (wsRef.current) {
                try { wsRef.current.close(1000, "Unmount"); } catch { /* ignore */ }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    // -----------------------------------------------------------------
    // API expuesta
    // -----------------------------------------------------------------

    return {
        state,
        isConnected:      state === "connected",
        latencyMs,
        reconnectAttempts,
        queueSize,
        clientsCount,
        serverInfo,
        lastError,
        send,
        subscribe,
        reconnect,
        disconnect,
        flushQueue,
    };
}
