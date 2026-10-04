// =====================================================================
// MOZONA TPV — supabase-health.ts (v4.0.9-stable)
// =====================================================================
// Versión MINIMALISTA y SEGURA. Ningún Promise que pueda fallar en init.
// =====================================================================

declare global {
    interface Window {
        __mozonaHealth?: {
            getState: () => any;
            subscribe: (fn: any) => any;
            pingNow: () => any;
        };
    }
}

interface HealthState {
    status: "online" | "degraded" | "offline" | "unknown";
    lastCheckedAt: number;
    lastError: string | null;
}

const HEALTH_KEY = "mozona.health.state";
const PING_INTERVAL_MS = 30000;

function safeParse(raw: string | null): HealthState | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw);
        if (v && typeof v === "object" && typeof v.status === "string") {
            return {
                status: v.status,
                lastCheckedAt: typeof v.lastCheckedAt === "number" ? v.lastCheckedAt : 0,
                lastError: typeof v.lastError === "string" ? v.lastError : null,
            };
        }
    } catch {}
    return null;
}

function safeWrite(s: HealthState) {
    try {
        localStorage.setItem(HEALTH_KEY, JSON.stringify(s));
    } catch {}
}

function notify(s: HealthState) {
    try {
        window.dispatchEvent(new CustomEvent("mozona:health-changed", { detail: s }));
    } catch {}
}

async function pingOnce(url: string, anonKey: string): Promise<HealthState> {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(`${url}/auth/v1/health?timeout=3`, {
            method: "GET",
            signal: controller.signal,
            headers: { apikey: anonKey },
        });
        clearTimeout(tid);
        const elapsed = Date.now() - start;
        if (r.ok) return { status: elapsed > 2000 ? "degraded" : "online", lastCheckedAt: Date.now(), lastError: null };
        if (r.status >= 500) return { status: "offline", lastCheckedAt: Date.now(), lastError: `HTTP ${r.status}` };
        return { status: "degraded", lastCheckedAt: Date.now(), lastError: `HTTP ${r.status}` };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "offline", lastCheckedAt: Date.now(), lastError: msg || "fetch failed" };
    }
}

class SupabaseHealthMonitor {
    state: HealthState = { status: "unknown", lastCheckedAt: 0, lastError: null };
    listeners = new Set<(s: HealthState) => void>();
    timer: ReturnType<typeof setInterval> | null = null;
    url = "";
    anonKey = "";

    constructor() {
        try {
            const cached = safeParse(typeof localStorage !== "undefined" ? localStorage.getItem(HEALTH_KEY) : null);
            if (cached) this.state = cached;
            if (typeof window !== "undefined") {
                const w = window as any;
                this.url = w.SUPABASE_URL || w.__SUPABASE_URL__ || "https://hcqkpokodrqimkulporw.supabase.co";
                this.anonKey = w.SUPABASE_ANON_KEY || "";
                if (!this.anonKey) {
                    try {
                        this.anonKey = localStorage.getItem("mozona.supabase.anon") || "";
                    } catch {}
                }
            }
        } catch {}
    }

    getState(): HealthState {
        return this.state;
    }

    subscribe(fn: (s: HealthState) => void): () => void {
        this.listeners.add(fn);
        try { fn(this.state); } catch {}
        return () => { this.listeners.delete(fn); };
    }

    setState(next: HealthState) {
        this.state = next;
        try { safeWrite(next); } catch {}
        try {
            for (const l of this.listeners) {
                try { l(next); } catch {}
            }
        } catch {}
        try { notify(next); } catch {}
    }

    async tick() {
        if (!this.url) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
            this.setState({ status: "offline", lastCheckedAt: Date.now(), lastError: "browser offline" });
            return;
        }
        // Si no tenemos anon_key, asumimos online (no podemos probar)
        if (!this.anonKey) {
            this.setState({ status: "unknown", lastCheckedAt: Date.now(), lastError: "no key" });
            return;
        }
        const next = await pingOnce(this.url, this.anonKey);
        this.setState(next);
    }

    start(): void {
        if (typeof window === "undefined") return;
        if (this.timer != null) return;
        // No await, no .catch() que pueda fallar
        try {
            void this.tick();
            this.timer = setInterval(() => {
                try { void this.tick(); } catch {}
            }, PING_INTERVAL_MS);
        } catch {}
    }

    stop(): void {
        if (this.timer != null) {
            try { clearInterval(this.timer); } catch {}
            this.timer = null;
        }
    }

    async pingNow(): Promise<HealthState> {
        if (typeof window === "undefined") return this.state;
        try { await this.tick(); } catch {}
        return this.state;
    }
}

let _health: SupabaseHealthMonitor | null = null;

export function getHealthMonitor(): SupabaseHealthMonitor {
    if (!_health) _health = new SupabaseHealthMonitor();
    return _health;
}

// Safe accessor para arranque
export function startHealthMonitor(): void {
    try {
        getHealthMonitor().start();
    } catch (e) {
        console.warn("[health] start failed:", e);
    }
}

// Compatibilidad con versiones anteriores
export function supabaseHealth(): { start: () => void; getState: () => HealthState; subscribe: (fn: any) => () => void; stop: () => void; pingNow: () => Promise<HealthState> } {
    const m = getHealthMonitor();
    return {
        start: () => { try { m.start(); } catch {} },
        getState: () => m.getState(),
        subscribe: (fn: any) => m.subscribe(fn),
        stop: () => m.stop(),
        pingNow: () => m.pingNow(),
    };
}

if (typeof window !== "undefined") {
    try {
        window.__mozonaHealth = {
            getState: () => getHealthMonitor().getState(),
            subscribe: (fn: any) => getHealthMonitor().subscribe(fn),
            pingNow: () => getHealthMonitor().pingNow(),
        };
    } catch {}
}
