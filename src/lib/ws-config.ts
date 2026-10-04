// =====================================================================
// MOZONA TPV — ws-config: detección de la URL del servidor LAN
// =====================================================================
// En un Tauri build, el host es siempre `localhost` (el WebView
// comparte red con el backend). En un navegador externo (desarrollo
// en otra máquina, o un móvil camarero en la misma LAN), el usuario
// introduce la IP del servidor (192.168.x.x).
//
// IMPORTANTE: NO asumimos localhost como destino en una PWA servida
// desde la nube.  Si el usuario abre la app en un móvil sin haber
// configurado la IP de la caja central, devolvemos `null` y la UI
// muestra un banner para introducirla.
// =====================================================================

const STORAGE_KEY_HOST = "mozona.lan.host";
const STORAGE_KEY_PORT = "mozona.lan.port";
const STORAGE_KEY_KEY  = "mozona.lan.key";
const STORAGE_KEY_ROLE = "mozona.lan.role";
const STORAGE_KEY_IP   = "mozona_server_ip";  // legacy (esperado en la tarea)

export const DEFAULT_LAN_PORT = 3001;          // puerto LAN por defecto
const DEFAULT_DEV_PORT      = 3000;           // puerto dev fallback

export type ClientRole = "tpv" | "waiter" | "kitchen" | "unknown";

export interface LanEndpoint {
    host: string;
    port: number;
    key:  string;
    role: ClientRole;
}

// ---------------------------------------------------------------------
// Detección de contexto
// ---------------------------------------------------------------------

/**
 * ¿Estamos corriendo en un contexto "nube" (HTTPS) o un build
 * Tauri/local (HTTP) donde localhost es válido?
 *
 * - En Tauri el WebView abre `tauri://` o `https://tauri.localhost`
 *   y el backend SIEMPRE está en localhost.
 * - En la PWA servida por Netlify, `window.location.protocol`
 *   es `https:` y localhost apuntaría al propio teléfono.
 */
export function isCloudContext(): boolean {
    if (typeof window === "undefined") return false;
    const proto = window.location.protocol;
    const host  = window.location.hostname;
    if (proto === "https:" && host !== "localhost" && host !== "127.0.0.1") {
        return true;
    }
    return false;
}

/** ¿Hay alguna IP de caja central configurada manualmente? */
export function hasStoredLanHost(): boolean {
    if (typeof localStorage === "undefined") return false;
    const host =
        localStorage.getItem(STORAGE_KEY_IP) ??
        localStorage.getItem(STORAGE_KEY_HOST);
    if (!host) return false;
    const h = host.trim().toLowerCase();
    return h.length > 0 && h !== "localhost" && h !== "127.0.0.1";
}

// ---------------------------------------------------------------------
// Configuración persistida (localStorage)
// ---------------------------------------------------------------------

export function getLanConfig(): LanEndpoint {
    if (typeof localStorage === "undefined") {
        return { host: "localhost", port: DEFAULT_DEV_PORT, key: "mozona-dev-key", role: "tpv" };
    }
    // Prioridad: IP explícita guardada en `mozona_server_ip`, luego host
    // de la clave legacy `mozona.lan.host`.
    const storedIp   = localStorage.getItem(STORAGE_KEY_IP);
    const storedHost = localStorage.getItem(STORAGE_KEY_HOST);
    const host       = storedIp ?? storedHost ?? "localhost";
    return {
        host,
        port: parseInt(localStorage.getItem(STORAGE_KEY_PORT) ?? String(DEFAULT_LAN_PORT), 10),
        key:  localStorage.getItem(STORAGE_KEY_KEY)  ?? "mozona-dev-key",
        role: (localStorage.getItem(STORAGE_KEY_ROLE) as ClientRole) ?? "tpv",
    };
}

export function setLanConfig(partial: Partial<LanEndpoint>): void {
    if (typeof localStorage === "undefined") return;
    if (partial.host !== undefined) {
        localStorage.setItem(STORAGE_KEY_HOST, partial.host);
        localStorage.setItem(STORAGE_KEY_IP,   partial.host);
    }
    if (partial.port !== undefined) localStorage.setItem(STORAGE_KEY_PORT, String(partial.port));
    if (partial.key  !== undefined) localStorage.setItem(STORAGE_KEY_KEY,  partial.key);
    if (partial.role !== undefined) localStorage.setItem(STORAGE_KEY_ROLE, partial.role);
}

/** Borra TODA la configuración de LAN.  Usado en "reset". */
export function clearLanConfig(): void {
    if (typeof localStorage === "undefined") return;
    for (const k of [STORAGE_KEY_HOST, STORAGE_KEY_IP, STORAGE_KEY_PORT, STORAGE_KEY_KEY, STORAGE_KEY_ROLE]) {
        localStorage.removeItem(k);
    }
}

// ---------------------------------------------------------------------
// Normalización de IP introducida por el usuario
// ---------------------------------------------------------------------

/**
 * Acepta:  "192.168.1.50"            → http://192.168.1.50:3001
 *          "http://192.168.1.50:7421"→ http://192.168.1.50:7421
 *          "192.168.1.50:3001"       → http://192.168.1.50:3001
 *          "https://dominio.com"     → https://dominio.com
 *          "dominio.com"             → http://dominio.com:3001
 */
export function normalizeServerInput(raw: string, defaultPort = DEFAULT_LAN_PORT): string | null {
    const v = (raw ?? "").trim();
    if (!v) return null;
    // ¿Ya trae esquema?
    if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, "");
    // ¿viene con :puerto?
    if (/^[\w.-]+:\d+$/.test(v)) return `http://${v}`;
    // ¿es IP o hostname?
    if (/^[\w.-]+$/.test(v)) return `http://${v}:${defaultPort}`;
    return null;
}

/** Devuelve la URL http:// base si hay config válida.  Si no, null. */
export function getHttpBaseUrl(): string | null {
    const cfg = getLanConfig();
    if (isCloudContext() && !hasStoredLanHost()) {
        return null;
    }
    return `http://${cfg.host}:${cfg.port}`;
}

// ---------------------------------------------------------------------
// Construcción de URLs
// ---------------------------------------------------------------------

export function buildHttpUrl(ep: Partial<LanEndpoint> = {}): string {
    const cfg = { ...getLanConfig(), ...ep };
    return `http://${cfg.host}:${cfg.port}`;
}

export function buildWsUrl(ep: Partial<LanEndpoint> = {}): string | null {
    const base = getHttpBaseUrl();
    if (!base) return null;
    const cfg = { ...getLanConfig(), ...ep };
    const host = base.replace(/^https?:\/\//, "");
    return `ws://${host}/ws?key=${encodeURIComponent(cfg.key)}&role=${cfg.role}&name=${encodeURIComponent(getClientName())}`;
}

/** Nombre legible del cliente (de localStorage o generado). */
function getClientName(): string {
    if (typeof localStorage !== "undefined") {
        const cached = localStorage.getItem("mozona.client.name");
        if (cached) return cached;
    }
    if (typeof navigator !== "undefined") {
        return `Web-${navigator.userAgent.split(" ")[0]?.slice(0, 8) ?? "Anon"}`;
    }
    return "Anon";
}
