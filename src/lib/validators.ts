// =====================================================================
// MOZONA TPV — Validadores
// =====================================================================

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** Valida un color hexadecimal de 6 dígitos. Acepta con o sin "#". */
export function isValidHex(value: string): boolean {
    return HEX_RE.test(value.trim());
}

/**
 * Valida un NIF/CIF/NIE español.
 *   • NIF: 8 dígitos + letra
 *   • NIE: X/Y/Z + 7 dígitos + letra
 *   • CIF: letra + 7 dígitos + letra/dígito
 *   • Persona jurídica: letra + 8 dígitos
 *
 * Esta función sólo valida el formato, no calcula la letra de control.
 */
export function isValidCifNif(value: string): boolean {
    const s = value.trim().toUpperCase();
    if (s.length < 8 || s.length > 9) return false;

    // NIF: 8 dígitos + letra
    if (/^\d{8}[A-Z]$/.test(s)) return true;

    // NIE: X/Y/Z + 7 dígitos + letra
    if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return true;

    // CIF: letra (incluye K, L, M) + 7 dígitos + letra o dígito
    if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[A-Z0-9]$/.test(s)) return true;

    // Persona jurídica con dígito final: letra + 8 dígitos
    if (/^[A-Z]\d{8}$/.test(s)) return true;

    return false;
}

/** Valida un número de teléfono internacional. Mínimo 7 dígitos. */
export function isValidPhone(value: string): boolean {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
}

/** Valida un código de serie VeriFactu: 1-4 caracteres alfanuméricos. */
export function isValidSeries(value: string): boolean {
    return /^[A-Z0-9]{1,4}$/.test(value.trim().toUpperCase());
}
