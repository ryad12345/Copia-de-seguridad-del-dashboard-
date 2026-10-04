// =====================================================================
// MOZONA TPV — useLocalIP: detecta la IP LAN del dispositivo
// =====================================================================
// Estrategia:
//   1) Si estamos en Tauri → pregunta al backend Rust por la IP
//   2) Si no → WebRTC STUN (sin enviar datos, solo descubre interfaz)
//   3) Fallback → API pública (api.ipify.org)
//
// Devuelve { ip, port, baseUrl, loading, error, refresh }.
// =====================================================================

import { useCallback, useEffect, useState } from "react";

export interface LocalIPInfo {
    ip:       string | null;
    port:     number;
    baseUrl:  string | null;  // "http://192.168.1.42:3000"
    source:   "tauri" | "webrtc" | "api" | "fallback" | null;
    loading:  boolean;
    error:    string | null;
}

const DEFAULT_PORT = 3000;

/** Cache de la IP detectada (sesión) */
let cached: { ip: string; source: "tauri" | "webrtc" | "api" } | null = null;

export function useLocalIP(port: number = DEFAULT_PORT): LocalIPInfo & { refresh: () => void } {
    const [info, setInfo] = useState<LocalIPInfo>({
        ip: cached?.ip ?? null,
        port,
        baseUrl: cached?.ip ? `http://${cached.ip}:${port}` : null,
        source: cached?.source ?? null,
        loading: !cached,
        error:   null,
    });

    const detect = useCallback(async () => {
        setInfo(s => ({ ...s, loading: true, error: null }));

        // 1) Tauri: pregunta al backend
        try {
            const inTauri = typeof window !== "undefined" && "__TAURI__" in window;
            if (inTauri) {
                // @ts-expect-error — Tauri global
                const { invoke } = window.__TAURI__.core;
                const ip = await invoke<string>("get_local_ip");
                if (ip) {
                    cached = { ip, source: "tauri" };
                    setInfo({
                        ip, port,
                        baseUrl: `http://${ip}:${port}`,
                        source: "tauri",
                        loading: false,
                        error: null,
                    });
                    return;
                }
            }
        } catch { /* sigue a WebRTC */ }

        // 2) WebRTC STUN: crea un peer connection y extrae la IP local
        try {
            const ip = await detectViaWebRTC();
            if (ip) {
                cached = { ip, source: "webrtc" };
                setInfo({
                    ip, port,
                    baseUrl: `http://${ip}:${port}`,
                    source: "webrtc",
                    loading: false,
                    error: null,
                });
                return;
            }
        } catch { /* sigue a ipify */ }

        // 3) ipify (puede fallar por CORS en algunos navegadores)
        try {
            const resp = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
            if (resp.ok) {
                const data = await resp.json();
                if (data.ip) {
                    cached = { ip: data.ip, source: "api" };
                    setInfo({
                        ip: data.ip, port,
                        baseUrl: `http://${data.ip}:${port}`,
                        source: "api",
                        loading: false,
                        error: null,
                    });
                    return;
                }
            }
        } catch { /* nada */ }

        // 4) Fallback
        setInfo(s => ({
            ...s,
            loading: false,
            error: "No se pudo detectar la IP local.  Configúrala manualmente.",
        }));
    }, [port]);

    useEffect(() => {
        if (!cached) void detect();
    }, [detect]);

    return { ...info, refresh: detect };
}

// ---------------------------------------------------------------------
// WebRTC: usa STUN servers para descubrir la IP de la interfaz
// ---------------------------------------------------------------------
async function detectViaWebRTC(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        if (typeof RTCPeerConnection === "undefined") {
            resolve(null);
            return;
        }
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        let resolved = false;
        const finish = (ip: string | null) => {
            if (resolved) return;
            resolved = true;
            try { pc.close(); } catch { /* */ }
            resolve(ip);
        };

        pc.onicecandidate = (e) => {
            if (!e.candidate) {
                finish(null);
                return;
            }
            const cand = e.candidate.candidate;
            const match = cand.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
            if (match && !match[1].startsWith("0.") && !match[1].startsWith("127.")) {
                finish(match[1]);
            }
        };

        pc.createDataChannel("");
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(() => finish(null));

        // Timeout 5s
        setTimeout(() => finish(null), 5_000);
    });
}
