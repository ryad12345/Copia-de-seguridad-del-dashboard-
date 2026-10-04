// =====================================================================
// MOZONA TPV — server/ws-manager.ts
// =====================================================================
// Gestor de conexiones WebSocket:
//   • Autenticación por API key en query string
//   • Heartbeat cada 30s para detectar clientes muertos
//   • Broadcast tipado a todos / a uno / a todos excepto el emisor
//   • Metadata por cliente (id, role, remoteAddress)
// =====================================================================

import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type {
    WsEnvelope, ClientToServerMap, ServerToClientMap,
    ServerEventType, ClientsChangedData,
} from "../shared/ws-events.js";
import { isClientEvent, makeEvent } from "../shared/ws-events.js";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export interface WsClientMeta {
    id:           string;
    role:         "tpv" | "waiter" | "kitchen" | "unknown";
    displayName:  string;
    remoteAddress: string;
    connectedAt:  string;
    lastPingAt:   number;
    alive:        boolean;
}

interface WsClient extends WsClientMeta {
    socket: WebSocket;
}

export type ClientEventHandler = (
    client: WsClient,
    env: WsEnvelope,
) => void | Promise<void>;

export interface WsManagerOptions {
    apiKey:          string;
    heartbeatMs?:    number;
    serverVersion:   string;
    restaurantId?:   string | null;
}

// ---------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------

export class WsManager {
    private clients = new Map<string, WsClient>();
    private handlers = new Map<string, Set<ClientEventHandler>>();
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly wss: WebSocketServer,
        private readonly opts: WsManagerOptions,
    ) {
        const hb = opts.heartbeatMs ?? 30_000;
        this.heartbeatTimer = setInterval(() => this.heartbeat(), hb);
        this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    }

    // -----------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------

    private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
        // 1) Autenticación por query string
        const url = new URL(req.url ?? "/", "http://localhost");
        const key = url.searchParams.get("key");
        if (!this.checkKey(key)) {
            ws.close(4401, "Invalid API key");
            return;
        }

        // 2) Metadata
        const role = (url.searchParams.get("role") ?? "unknown") as WsClientMeta["role"];
        const name = url.searchParams.get("name") ?? "Cliente";
        const id   = randomUUID();
        const client: WsClient = {
            id, socket: ws, role, displayName: name,
            remoteAddress: req.socket.remoteAddress ?? "?",
            connectedAt:   new Date().toISOString(),
            lastPingAt:    Date.now(),
            alive:         true,
        };
        this.clients.set(id, client);

        console.log(
            `[WS] + ${client.id.slice(0, 8)} ${client.role} "${client.displayName}"` +
            ` from ${client.remoteAddress} (${this.clients.size} total)`,
        );

        // 3) Mensaje de bienvenida
        this.sendTo<"WELCOME">(client, "WELCOME", {
            serverId:     id,
            version:      this.opts.serverVersion,
            clients:      this.clients.size,
            restaurantId: this.opts.restaurantId ?? null,
        });

        // 4) Notificar a los demás
        this.broadcastClientsChanged();

        // 5) Handlers
        ws.on("message", (raw) => this.onMessage(client, raw.toString()));
        ws.on("pong",    () => { client.alive = true; client.lastPingAt = Date.now(); });
        ws.on("close",   (code, reason) => this.onClose(client, code, reason.toString()));
        ws.on("error",   (err) => console.error(`[WS] ! ${client.id.slice(0, 8)}:`, err.message));
    }

    private onMessage(client: WsClient, raw: string): void {
        let env: WsEnvelope;
        try {
            env = JSON.parse(raw);
        } catch {
            this.sendError(client, "INVALID_JSON", "Mensaje no es JSON válido");
            return;
        }
        if (typeof env?.type !== "string") {
            this.sendError(client, "INVALID_ENVELOPE", "Falta campo 'type'");
            return;
        }

        // PING → PONG con cálculo de latencia
        if (isClientEvent(env, "PING")) {
            const sent = env.data?.timestamp ?? Date.now();
            this.sendTo<"PONG">(client, "PONG", {
                latencyMs:  Date.now() - sent,
                serverTime: new Date().toISOString(),
            });
            return;
        }

        // Despacho tipado a handlers registrados
        const handlers = this.handlers.get(env.type);
        if (!handlers || handlers.size === 0) {
            // Eco por defecto: broadcast a todos los demás
            this.broadcastRaw(env, client.id);
            return;
        }
        for (const h of handlers) {
            Promise.resolve(h(client, env)).catch((err) => {
                console.error(`[WS] ! handler error en ${env.type}:`, err);
            });
        }
    }

    private onClose(client: WsClient, code: number, reason: string): void {
        this.clients.delete(client.id);
        console.log(
            `[WS] - ${client.id.slice(0, 8)} ${client.role} ` +
            `(code=${code} reason=${reason || "—"}; ${this.clients.size} total)`,
        );
        this.broadcastClientsChanged();
    }

    // -----------------------------------------------------------------
    // API pública
    // -----------------------------------------------------------------

    /** Registra un handler para un tipo de evento concreto. */
    on<T extends keyof ClientToServerMap>(
        type: T,
        handler: (
            client: WsClient,
            env: WsEnvelope<ClientToServerMap[T]>,
        ) => void | Promise<void>,
    ): () => void {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set());
        this.handlers.get(type)!.add(handler as ClientEventHandler);
        return () => this.handlers.get(type)?.delete(handler as ClientEventHandler);
    }

    /** Broadcast a todos los clientes. */
    broadcast<T extends ServerEventType>(
        type: T,
        data: ServerToClientMap[T],
        exceptId?: string,
    ): void {
        const env = makeEvent(type, data);
        this.broadcastRaw(env, exceptId);
    }

    /** Envío a un cliente concreto. */
    sendTo<T extends ServerEventType>(
        client: WsClientMeta,
        type: T,
        data: ServerToClientMap[T],
    ): void {
        const env = makeEvent(type, data);
        this.sendRaw(client.id, env);
    }

    /** Lista de clientes conectados (snapshots sin socket). */
    listClients(): WsClientMeta[] {
        return Array.from(this.clients.values()).map(c => ({
            id: c.id, role: c.role, displayName: c.displayName,
            remoteAddress: c.remoteAddress, connectedAt: c.connectedAt,
            lastPingAt: c.lastPingAt, alive: c.alive,
        }));
    }

    /** Apagado limpio. */
    async close(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        for (const c of this.clients.values()) {
            try { c.socket.close(1001, "Server shutting down"); } catch { /* ignore */ }
        }
        this.clients.clear();
    }

    // -----------------------------------------------------------------
    // Internos
    // -----------------------------------------------------------------

    private checkKey(key: string | null): boolean {
        if (!key) return false;
        // Comparación constant-time para evitar timing attacks
        const a = Buffer.from(key);
        const b = Buffer.from(this.opts.apiKey);
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff === 0;
    }

    private sendRaw(id: string, env: WsEnvelope): void {
        const c = this.clients.get(id);
        if (!c || c.socket.readyState !== WebSocket.OPEN) return;
        c.socket.send(JSON.stringify(env));
    }

    private broadcastRaw(env: WsEnvelope, exceptId?: string): void {
        const json = JSON.stringify(env);
        for (const c of this.clients.values()) {
            if (c.id === exceptId) continue;
            if (c.socket.readyState !== WebSocket.OPEN) continue;
            c.socket.send(json);
        }
    }

    private sendError(client: WsClient, code: string, message: string): void {
        this.sendTo<"ERROR">(client, "ERROR", { code, message });
    }

    private broadcastClientsChanged(): void {
        const data: ClientsChangedData = { count: this.clients.size };
        this.broadcast("CLIENTS_CHANGED", data);
    }

    /**
     * Envía pings a todos los clientes y mata los que no respondan.
     * Implementa el patrón estándar de "keepalive" de la librería `ws`.
     */
    private heartbeat(): void {
        for (const c of this.clients.values()) {
            if (!c.alive) {
                console.log(`[WS] × ${c.id.slice(0, 8)} timeout, cerrando`);
                try { c.socket.terminate(); } catch { /* ignore */ }
                this.clients.delete(c.id);
                continue;
            }
            c.alive = false;
            try { c.socket.ping(); } catch { /* ignore */ }
        }
    }
}
