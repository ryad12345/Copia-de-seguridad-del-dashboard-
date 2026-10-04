// =====================================================================
// MOZONA TPV — imageUtils
// =====================================================================
// Helpers seguros para:
//  • fileToBase64()  — FileReader.readAsDataURL (sin stack overflow)
//  • compressImage() — redimensiona/comprime con canvas (max 1600px, 0.82 JPEG)
//  • encodeToBase64InChunks() — chunk-safe para arrays grandes
//  • readAsDataURL() — wrapper tipado
// =====================================================================

const CHUNK_SIZE = 32 * 1024; // 32 KB

/**
 * Convierte un Blob/File a data URL (`data:image/jpeg;base64,...`)
 * usando FileReader — sin riesgo de stack overflow incluso con >10 MB.
 */
export function readAsDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error ?? new Error("FileReader error"));
        fr.readAsDataURL(blob);
    });
}

/**
 * Comprime una imagen en canvas (re-escala + JPEG 0.82).
 *  - maxSide: lado máximo permitido (default 1600px)
 *  - quality: 0..1 (default 0.82)
 * Devuelve un Blob JPEG.  Si la entrada no es imagen o el navegador no
 * soporta canvas, devuelve el blob original.
 */
export async function compressImage(
    file: Blob,
    maxSide = 1600,
    quality = 0.82,
    mime = "image/jpeg",
): Promise<Blob> {
    if (!file.type.startsWith("image/")) return file;
    // canvas no soporta PDF → devolvemos el original
    if (file.type === "application/pdf") return file;

    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;

    let { width, height } = bitmap;
    if (width > maxSide || height > maxSide) {
        const ratio = Math.min(maxSide / width, maxSide / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = (canvas as HTMLCanvasElement).getContext("2d") as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    if (canvas instanceof OffscreenCanvas) {
        return canvas.convertToBlob({ type: mime, quality });
    }
    return new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("toBlob null")),
            mime,
            quality,
        );
    });
}

/**
 * Codifica un Uint8Array a Base64 en chunks de 32 KB.
 *  • Evita "Maximum call stack size exceeded" con arrays >100 KB
 *  • Compatible con btoa nativo (solo ASCII chunks)
 */
export function encodeToBase64InChunks(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
        // String.fromCharCode(...slice) sigue siendo seguro si slice < 32 KB
        binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return btoa(binary);
}

/**
 * Pipeline: file → (opcional) comprime → ArrayBuffer → Base64 chunk-safe.
 * Devuelve { base64, mimeType, byteLength }.
 */
export async function fileToBase64(
    file: File,
    options: { compress?: boolean; maxSide?: number; quality?: number } = {},
): Promise<{ base64: string; mimeType: string; byteLength: number }> {
    const { compress = true, maxSide = 1600, quality = 0.82 } = options;
    const source = compress ? await compressImage(file, maxSide, quality) : file;
    const arrayBuf = await source.arrayBuffer();
    const bytes    = new Uint8Array(arrayBuf);
    return {
        base64:    encodeToBase64InChunks(bytes),
        mimeType:  source.type || file.type,
        byteLength: bytes.length,
    };
}

/**
 * Formatea bytes a KB / MB legible.
 */
export function fmtBytes(n: number): string {
    if (n < 1024)         return `${n} B`;
    if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
