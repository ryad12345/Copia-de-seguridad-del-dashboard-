// =====================================================================
// MOZONA TPV — leadGuard.ts
// =====================================================================
// Helpers para prevenir envíos duplicados del formulario de leads.
//
// v1.9.49: Triple capa de protección:
//
//   1) Marcar en localStorage que ya se envió
//      Key: 'mozona_lead_submitted' = 'true' (timestamp ms)
//
//   2) Rate limit por timestamp
//      - Bloquea re-envíos dentro de los últimos N segundos
//      - Configurable via LEAD_RATE_LIMIT_MS
//
//   3) Submitting lock en memoria (React state)
//      - Mientras la promesa de EmailJS está en vuelo
//      - Bloquea el botón en el UI
//
// Uso:
//   import { isLeadAlreadySubmitted, markLeadSubmitted,
//            canSubmitAgain, leadGuard } from './leadGuard';
//
//   if (isLeadAlreadySubmitted()) {
//     return <ConfirmationMessage />;
//   }
//   if (!canSubmitAgain()) {
//     return <RateLimitMessage />;
//   }
//   await sendEmail(...);
//   markLeadSubmitted();
// =====================================================================

const KEY_SUBMITTED = "mozona_lead_submitted";
const KEY_LAST_TRY  = "mozona_lead_last_try";

/** Tiempo mínimo entre envíos (en ms) - 60 segundos */
export const LEAD_RATE_LIMIT_MS = 60_000;

/** Lee si el usuario ya envió un lead en este dispositivo */
export function isLeadAlreadySubmitted(): boolean {
    try {
        return localStorage.getItem(KEY_SUBMITTED) === "true";
    } catch {
        return false;
    }
}

/** Lee timestamp del último intento de envío */
function getLastTry(): number {
    try {
        const v = localStorage.getItem(KEY_LAST_TRY);
        if (!v) return 0;
        const n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
    } catch {
        return 0;
    }
}

/** Devuelve true si ha pasado suficiente tiempo desde el último intento */
export function canSubmitAgain(now: number = Date.now()): boolean {
    const last = getLastTry();
    if (last === 0) return true;
    return (now - last) >= LEAD_RATE_LIMIT_MS;
}

/** ms que faltan para poder reintentar (0 si ya puede) */
export function msUntilNextSubmit(now: number = Date.now()): number {
    const last = getLastTry();
    if (last === 0) return 0;
    const diff = LEAD_RATE_LIMIT_MS - (now - last);
    return diff > 0 ? diff : 0;
}

/** Marca el envío como exitoso en localStorage */
export function markLeadSubmitted(now: number = Date.now()): void {
    try {
        localStorage.setItem(KEY_SUBMITTED, "true");
        localStorage.setItem(KEY_LAST_TRY, String(now));
    } catch (_) { /* storage no disponible */ }
}

/** Marca un intento de envío (para rate limit) — llamar ANTES de enviar */
export function markLeadAttempt(now: number = Date.now()): void {
    try {
        localStorage.setItem(KEY_LAST_TRY, String(now));
    } catch (_) { /* storage no disponible */ }
}

/** Resetea la marca (útil si quieres permitir reintento desde el admin) */
export function resetLeadGuard(): void {
    try {
        localStorage.removeItem(KEY_SUBMITTED);
        localStorage.removeItem(KEY_LAST_TRY);
    } catch (_) { /* storage no disponible */ }
}

/** Resumen del estado actual del guard */
export function leadGuardStatus(now: number = Date.now()): {
    alreadySubmitted: boolean;
    canSubmit:        boolean;
    msUntilNext:      number;
} {
    return {
        alreadySubmitted: isLeadAlreadySubmitted(),
        canSubmit:        canSubmitAgain(now),
        msUntilNext:      msUntilNextSubmit(now),
    };
}
