// =====================================================================
// MOZONA TPV — EscposBuilder (versión local PWA)
// =====================================================================
// Builder de bytes ESC/POS para impresoras térmicas (80mm).
// Reutilizado por useLocalPrinter para componer tickets antes de
// enviarlos a la cola `pendingSync` o al driver WebUSB/WebSerial.
// =====================================================================

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

export type Align = "left" | "center" | "right";
export type CharSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type CutMode = "PARTIAL" | "FULL";

/** Opciones de impresión de logotipo en ticket */
export interface LogoOptions {
    /** URL de la imagen (data: o https://). En Tauri se omite. */
    url: string;
    /** Ancho en bytes (default 64 → 64*8 = 512 px) */
    widthBytes?: number;
    /** Alto en bytes (opcional, se calcula de la imagen) */
    heightBytes?: number;
}

// ---------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------

export class EscposBuilder {
    private chunks: Uint8Array[] = [];

    /** Inicializa la impresora (ESC @). */
    public init(): this {
        return this.bytes([0x1B, 0x40]);
    }

    /** Alineación. */
    public align(a: Align): this {
        const map: Record<Align, number> = { left: 0, center: 1, right: 2 };
        return this.bytes([0x1B, 0x61, map[a]]);
    }

    /** Negrita on/off. */
    public bold(on: boolean): this {
        return this.bytes([0x1B, 0x45, on ? 0x01 : 0x00]);
    }

    /** Subrayado (0=off, 1=1 línea, 2=2 líneas). */
    public underline(lines: 0 | 1 | 2): this {
        return this.bytes([0x1B, 0x2D, lines]);
    }

    /** Tamaño del carácter (1..8). */
    public size(s: CharSize): this {
        const n = ((s - 1) << 4) | (s - 1);
        return this.bytes([0x1D, 0x21, n]);
    }

    /** Salto de línea. */
    public feed(n = 1): this {
        return this.bytes(new Array(Math.max(0, n) | 0).fill(0x0A));
    }

    /** Texto plano (UTF-8). */
    public text(s: string): this {
        return this.bytes(new TextEncoder().encode(s));
    }

    /** Línea de ticket: "label ........... 12,50 €". */
    public lineWithPrice(label: string, price: string, width = 32): this {
        const pad = Math.max(1, width - label.length - price.length);
        return this.text(label + " ".repeat(pad) + price);
    }

    /** Línea de separación. */
    public hr(char = "-", width = 32): this {
        return this.text(char.repeat(width));
    }

    /** Apertura del cajón portamonedas (ESC p 0 0x19 0xFA). */
    public openCashDrawer(): this {
        return this.bytes([0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }

    /** Corte del papel. */
    public cut(mode: CutMode = "FULL", feed = 3): this {
        this.feed(feed);
        if (mode === "FULL") {
            return this.bytes([0x1D, 0x56, 0x41, 0x10]);
        }
        return this.bytes([0x1D, 0x56, 0x42, 0x00]);
    }

    /**
     * Imprime un código QR (modelo 2) usando el comando GS ( k.
     * El payload se codifica como bytes UTF-8.
     */
    public qr(payload: string, size = 6): this {
        const data = new TextEncoder().encode(payload);
        const pL  = (data.length + 3) & 0xFF;
        const pH  = ((data.length + 3) >> 8) & 0xFF;

        return this
            // 1) Seleccionar modelo 2
            .bytes([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
            // 2) Tamaño del módulo
            .bytes([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size & 0xFF])
            // 3) EC nivel M
            .bytes([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30])
            // 4) Almacenar datos
            .bytes([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30])
            .bytes([...data])
            // 5) Imprimir
            .bytes([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
            .feed(2);
    }

    /** Añade bytes crudos. */
    public bytes(seq: Iterable<number>): this {
        const arr = Array.from(seq).map(b => b & 0xFF);
        this.chunks.push(new Uint8Array(arr));
        return this;
    }

    /** Compila y devuelve el Uint8Array final. */
    public build(): Uint8Array {
        const total = this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of this.chunks) {
            out.set(c, off);
            off += c.byteLength;
        }
        return out;
    }

    /** Resetea el builder. */
    public reset(): this {
        this.chunks = [];
        return this;
    }
}
