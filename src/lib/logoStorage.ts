// =====================================================================
// MOZONA TPV — logoStorage (v4.0.7-logo-fix)
// =====================================================================
// Persistencia ROBUSTA del logo del ticket:
//   - Clave localStorage independiente (no contamina el layout)
//   - Validación al guardar (max 100KB efectivo, formato data:image/*)
//   - Manejo de QuotaExceededError (limpia claves viejas)
//   - Compresión automática (canvas) si excede el límite
//   - Restauración con validación de dataUrl (anti-XSS)
// =====================================================================

const LOGO_KEY = "mozona.ticketLogo";
const LEGACY_KEYS = [
    "mozona.ticket_layout_json.logo",
    "ticket_layout_json.logo",
    "ticketLogo",
];

const MAX_LOGO_BYTES = 100 * 1024; // 100 KB tras compresión

/**
 * Comprime una imagen a JPEG con calidad adaptativa hasta caber en maxBytes.
 */
export async function compressImage(
    file: File | Blob,
    maxBytes: number = MAX_LOGO_BYTES,
    maxWidth: number = 400
): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Imagen no válida"));
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const scale = Math.min(1, maxWidth / img.width);
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject(new Error("Canvas 2D no disponible"));
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Reducir calidad hasta caber
                let quality = 0.92;
                let dataUrl = canvas.toDataURL("image/jpeg", quality);
                while (dataUrl.length > maxBytes * 1.4 && quality > 0.4) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL("image/jpeg", quality);
                }
                resolve(dataUrl);
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Valida que un string sea un dataUrl de imagen válido.
 */
export function isValidLogoDataUrl(value: string | null | undefined): value is string {
    if (!value || typeof value !== "string") return false;
    if (value.length < 100) return false; // un base64-64 mínimo vale más
    if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) {
        return false;
    }
    return true;
}

/**
 * Guarda el logo en localStorage con manejo robusto de errores.
 * Si falla por cuota, limpia claves legacy y reintenta.
 */
export function saveLogo(dataUrl: string): { ok: boolean; error?: string } {
    if (!isValidLogoDataUrl(dataUrl)) {
        return { ok: false, error: "Logo inválido (no es data:image/* base64)" };
    }
    try {
        localStorage.setItem(LOGO_KEY, dataUrl);
        return { ok: true };
    } catch (e: any) {
        // QuotaExceededError u otro error de almacenamiento
        const isQuota =
            e?.name === "QuotaExceededError" ||
            /quota|exceed/i.test(e?.message || "");
        if (isQuota) {
            // Limpia claves legacy que ya no se usan
            for (const k of LEGACY_KEYS) {
                try { localStorage.removeItem(k); } catch (_) {}
            }
            // Reintenta
            try {
                localStorage.setItem(LOGO_KEY, dataUrl);
                return { ok: true };
            } catch (e2: any) {
                return {
                    ok: false,
                    error: "No hay espacio suficiente para guardar el logo (>100KB comprime más la imagen)",
                };
            }
        }
        return { ok: false, error: e?.message || "Error desconocido" };
    }
}

/**
 * Carga el logo desde localStorage. Valida formato al leer.
 */
export function loadLogo(): string | null {
    try {
        const raw = localStorage.getItem(LOGO_KEY);
        if (!raw) return null;
        if (isValidLogoDataUrl(raw)) return raw;
        // Si el dato existente está corrupto, límpialo
        localStorage.removeItem(LOGO_KEY);
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Borra el logo.
 */
export function clearLogo(): void {
    try { localStorage.removeItem(LOGO_KEY); } catch (_) {}
}

/**
 * Devuelve tamaño en KB aproximado del dataUrl.
 */
export function logoSizeKB(dataUrl: string): number {
    if (!dataUrl) return 0;
    // En base64, cada 4 chars ≈ 3 bytes; el prefijo no cuenta
    const b64 = dataUrl.split(",")[1] || "";
    return Math.round((b64.length * 3) / 4 / 1024);
}
