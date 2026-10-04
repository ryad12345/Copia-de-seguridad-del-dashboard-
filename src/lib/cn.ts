// =====================================================================
// MOZONA TPV — cn: merge de classNames estilo clsx
// =====================================================================

type ClassValue = string | number | null | undefined | false | Record<string, boolean> | ClassValue[];

/**
 * Mezcla clases condicionalmente. Filtra `false | null | undefined`.
 *
 *   cn("base", isActive && "active", { "ring-2": selected })
 */
export function cn(...inputs: ClassValue[]): string {
    const out: string[] = [];
    const walk = (v: ClassValue): void => {
        if (!v && v !== 0) return;
        if (typeof v === "string" || typeof v === "number") {
            out.push(String(v));
        } else if (Array.isArray(v)) {
            v.forEach(walk);
        } else if (typeof v === "object") {
            for (const k in v) if (v[k]) out.push(k);
        }
    };
    inputs.forEach(walk);
    return out.join(" ");
}
