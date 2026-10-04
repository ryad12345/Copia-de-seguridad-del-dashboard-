// =====================================================================
// MOZONA TPV — server/local-server.ts
// =====================================================================
// Entry point del servidor LAN. Combina:
//   • HTTP (Express) sirviendo la API REST + bundle de React estático
//   • WebSocket nativo (ws) en /ws para eventos en tiempo real
//   • Pool PostgreSQL con reconexión automática
//
// Arranque:  PORT=3000 LAN_API_KEY=... tsx server/local-server.ts
// =====================================================================

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";

import { WebSocketServer } from "ws";
import { WsManager } from "./ws-manager.js";
import { buildRouter } from "./routes.js";
import { query, closeDb } from "./db.js";
import type {
    OrderSentData, TableStatusChangedData, InvoicePaidData,
} from "../shared/ws-events.js";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const PORT       = parseInt(process.env.PORT ?? "3000", 10);
const HOST       = process.env.HOST ?? "0.0.0.0";
const VERSION    = "0.1.0";
const IS_PROD    = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------
// API key (fail-closed)
// ---------------------------------------------------------------------
// ★ v4.6.0: antes se usaba el valor por defecto "mozona-dev-key" (conocido
//   públicamente) y se IMPRIMÍA en el banner. Eso permitía a cualquiera en
//   la LAN autenticarse contra la API. Ahora:
//     - producción exige LAN_API_KEY fuerte (>= 16 chars) o NO arranca;
//     - en dev, si falta o es débil, se genera una clave aleatoria por sesión;
//     - la clave nunca se imprime completa (salvo la generada efímera).
const WEAK_KEYS = new Set(["mozona-dev-key", "changeme", "secret", "password", "dev", "test"]);

function resolveApiKey(): { apiKey: string; generated: boolean } {
    const provided = (process.env.LAN_API_KEY ?? "").trim();
    const weak = provided.length < 16 || WEAK_KEYS.has(provided.toLowerCase());
    if (!weak) return { apiKey: provided, generated: false };
    if (IS_PROD) {
        throw new Error(
            "LAN_API_KEY es obligatoria y debe tener >= 16 caracteres (no por defecto) " +
            "en producción. Arranque abortado por seguridad.",
        );
    }
    const generated = randomBytes(24).toString("base64url");
    console.warn(
        "[SECURITY] LAN_API_KEY ausente o débil. Se generó una clave aleatoria para " +
        "esta sesión. Configura LAN_API_KEY=<32+ chars> de forma persistente.",
    );
    return { apiKey: generated, generated: true };
}

const { apiKey: API_KEY, generated: API_KEY_GENERATED } = resolveApiKey();

/** Máscara para logs: nunca imprime el secreto completo. */
function maskKey(k: string): string {
    if (k.length <= 8) return "•".repeat(k.length);
    return `${k.slice(0, 4)}…${k.slice(-2)} (len=${k.length})`;
}

// Raíz del proyecto = 2 niveles arriba de server/
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const DIST_DIR   = path.join(ROOT, "dist");

// ---------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------

const app = express();

// CORS de LAN: se refleja el origen, pero SIN credenciales (la auth va por
// cabecera X-Mozona-Key). Al no aceptar cookies, la reflexión de origen no
// permite robar sesiones de la app principal (que vive en el dominio web).
app.use(cors({
    origin:        true,
    credentials:   false,
    exposedHeaders: ["X-Mozona-Key"],
}));
app.use(express.json({ limit: "10mb" }));

// Logger minimalista
app.use((req, _res, next) => {
    const t = new Date().toISOString().slice(11, 19);
    console.log(`[${t}] ${req.method} ${req.url}`);
    next();
});

// ---------------------------------------------------------------------
// Detección del restaurante "default" para mandar a los clientes
// ---------------------------------------------------------------------

let cachedRestaurantId: string | null = null;
async function getDefaultRestaurantId(): Promise<string | null> {
    if (cachedRestaurantId !== null) return cachedRestaurantId;
    try {
        const r = await query<{ id: string }>(
            `SELECT id FROM restaurants ORDER BY created_at ASC LIMIT 1`,
        );
        cachedRestaurantId = r.rows[0]?.id ?? null;
    } catch {
        cachedRestaurantId = null;
    }
    return cachedRestaurantId;
}

// ---------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------

const httpServer = createServer(app);
const wss        = new WebSocketServer({ noServer: true });     // handshake manual

const wsManager  = new WsManager(wss, {
    apiKey:        API_KEY,
    serverVersion: VERSION,
    restaurantId:  undefined,                                  // se actualiza tras startup
});

(async () => {
    const restId = await getDefaultRestaurantId();
    (wsManager as unknown as { opts: { restaurantId: string | null } }).opts.restaurantId = restId;
    if (restId) console.log(`[BOOT] Restaurante por defecto: ${restId}`);
})();

// Rutas REST (se montan después para que `wsManager` esté listo)
app.use(buildRouter({ apiKey: API_KEY, ws: wsManager, version: VERSION }));

// Sirve el bundle de React compilado si existe
import { existsSync, statSync } from "node:fs";
if (existsSync(DIST_DIR) && statSync(DIST_DIR).isDirectory()) {
    app.use(express.static(DIST_DIR));
    // SPA fallback: cualquier ruta no-API devuelve index.html
    app.get(/^\/(?!api\/|ws$).*/, (_req, res) => {
        res.sendFile(path.join(DIST_DIR, "index.html"));
    });
    console.log(`[BOOT] Sirviendo bundle React desde ${DIST_DIR}`);
} else {
    console.warn(`[BOOT] dist/ no existe — sólo API. ` +
        `Ejecuta "npm run build" para generar el bundle.`);
}

// Handshake de WS en /ws
httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    } else {
        socket.destroy();
    }
});

// ---------------------------------------------------------------------
// Bridge HTTP → WS: persistir cambios que llegan por REST también
// dispara broadcasts ya cubiertos en routes.ts. Aquí dejamos hooks
// de alto nivel para que el server Tauri Rust u otros procesos
// puedan publicar eventos sin pasar por HTTP.
// ---------------------------------------------------------------------

export function publishOrderSent(data: OrderSentData): void {
    wsManager.broadcast("ORDER_SENT", data);
}
export function publishTableStatus(data: TableStatusChangedData): void {
    wsManager.broadcast("TABLE_STATUS_CHANGED", data);
}
export function publishInvoicePaid(data: InvoicePaidData): void {
    wsManager.broadcast("INVOICE_PAID", data);
}

// ---------------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[ERR]", err?.message);
    // ★ v4.6.0: no filtrar detalles internos (stack/SQL) al cliente en prod.
    res.status(500).json({
        error: "internal",
        ...(IS_PROD ? {} : { message: err?.message }),
    });
});

// ---------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
    console.log(`\n[${signal}] Cerrando…`);
    try {
        await wsManager.close();
        await closeDb();
        httpServer.close(() => process.exit(0));
        // Si tarda mucho, salimos igual a los 5s
        setTimeout(() => process.exit(1), 5000).unref();
    } catch (e) {
        console.error("Error durante shutdown:", e);
        process.exit(1);
    }
}
process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
    console.error("[UNCAUGHT]", err);
    void shutdown("uncaughtException");
});

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

httpServer.listen(PORT, HOST, () => {
    const ips = getLocalIPs();
    console.log(`
╔══════════════════════════════════════════════════════════╗
║           MOZONA TPV — LAN Server v${VERSION}              ║
╠══════════════════════════════════════════════════════════╣
║  HTTP   →  http://0.0.0.0:${PORT}                          ║
║  WS     →  ws://0.0.0.0:${PORT}/ws                          ║
║  API    →  X-Mozona-Key header (${maskKey(API_KEY)})      ║
╠══════════════════════════════════════════════════════════╣
║  IPs locales:                                            ║`);
    for (const ip of ips) {
        console.log(`║    ${ip.padEnd(52)}║`);
    }
    console.log(`╚══════════════════════════════════════════════════════════╝
`);
    if (API_KEY_GENERATED && !IS_PROD) {
        // Clave efímera: se imprime UNA vez para que el cliente de desarrollo
        // pueda configurarse. No se persiste.
        console.log(`[DEV] LAN_API_KEY (efímera, solo esta sesión): ${API_KEY}\n`);
    }
});

function getLocalIPs(): string[] {
    const out: string[] = [];
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        if (name === "lo") continue;
        for (const i of ifaces[name] ?? []) {
            if (i.family === "IPv4" && !i.internal) {
                out.push(`${name}: ${i.address}`);
            }
        }
    }
    return out;
}
