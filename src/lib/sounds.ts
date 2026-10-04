// =====================================================================
// MOZONA TPV — sounds.ts: efectos de sonido vía Web Audio API
// =====================================================================
// API minimalista para reproducir tonos cortos (ding al recibir comanda,
// bip al cobrar, error al fallar). Se inicializa de forma perezosa para
// no romper SSR ni molestar a navegadores que no soportan Web Audio.
//
// Para no requerir un archivo .mp3/.wav, generamos los tonos con
// OscillatorNode + envelope exponencial.
// =====================================================================

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (_ctx) return _ctx;
    try {
        const Ctor = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        _ctx = new Ctor();
        return _ctx;
    } catch {
        return null;
    }
}

/** Reanuda el AudioContext (algunos navegadores lo crean suspended). */
export async function unlockAudio(): Promise<void> {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch { /* ignore */ }
    }
}

interface ToneOptions {
    frequency:  number;          // Hz
    durationMs: number;          // duración total
    type?:      OscillatorType;  // "sine" | "square" | "triangle" | "sawtooth"
    volume?:    number;          // 0..1
    attackMs?:  number;
    releaseMs?: number;
}

function playTone({
    frequency, durationMs, type = "sine",
    volume = 0.1, attackMs = 5, releaseMs,
}: ToneOptions): void {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
        void ctx.resume();
    }
    const now      = ctx.currentTime;
    const duration = durationMs / 1000;
    const release  = (releaseMs ?? durationMs * 0.7) / 1000;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    // Envelope: attack → sustain → exponential release
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackMs / 1000);
    gain.gain.setValueAtTime(volume, now + duration - release);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
}

// ---------------------------------------------------------------------
// Efectos predefinidos
// ---------------------------------------------------------------------

/** "Ding" de 2 tonos para avisar de comanda nueva. */
export function playOrderDing(): void {
    playTone({ frequency: 880,  durationMs: 180, type: "sine", volume: 0.10 });
    playTone({ frequency: 1320, durationMs: 220, type: "sine", volume: 0.08 });
}

/** Bip corto al cobrar (éxito). */
export function playChargeSuccess(): void {
    playTone({ frequency: 1200, durationMs: 100, type: "triangle", volume: 0.08 });
    setTimeout(() => playTone({ frequency: 1800, durationMs: 120, type: "triangle", volume: 0.08 }), 80);
}

/** Bip grave de error. */
export function playError(): void {
    playTone({ frequency: 220, durationMs: 300, type: "square", volume: 0.06 });
}

/** Tick al pulsar una tecla del numpad. */
export function playKeyTick(): void {
    playTone({ frequency: 1600, durationMs: 30, type: "square", volume: 0.02 });
}

/** Chime al abrir el cajón portamonedas. */
export function playCashDrawer(): void {
    playTone({ frequency: 440,  durationMs: 80,  type: "square", volume: 0.06 });
    setTimeout(() => playTone({ frequency: 220, durationMs: 250, type: "square", volume: 0.05 }), 60);
}
