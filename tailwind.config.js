// =====================================================================
// MOZONA TPV — tailwind.config.js
// =====================================================================
// Configuración de Tailwind CSS 3.x.  Se procesa por PostCSS en
// `vite build` (vía postcss.config.js) usando `tailwindcss` y
// `autoprefixer`.
//
// Notas:
//   • `content` debe listar TODAS las rutas donde aparezcan nombres
//     de clase de Tailwind (no las `.css`, los `.tsx/.ts/.html`).
//   • Usamos el prefijo `Mozona` para utilidades generadas por
//     @apply desde CSS (`bg-brand`, `text-brand`...).
//   • El theme extiende la paleta slate por defecto y mantiene
//     el "azul marca" como variable CSS (definida en globals.css).
// =====================================================================

/** @type {import('tailwindcss').Config} */
export default {
    // Purgado: escanea estos archivos en busca de clases
    // tailwind (`class="bg-blue-500"`, `@apply text-sm`...).
    content: [
        "./index.html",
        "./src/**/*.{ts,tsx,js,jsx,html}",
        "./shared/**/*.{ts,tsx,js,jsx,html}",
    ],

    // Tema: extendemos pero NO reseteamos, para que `bg-slate-50`,
    // `text-rose-600`, etc. funcionen por defecto.
    theme: {
        extend: {
            // Colores semánticos del TPV (opcional)
            colors: {
                brand: {
                    DEFAULT: "var(--brand-color, #2563EB)",
                    50:  "#EFF6FF",
                    100: "#DBEAFE",
                    200: "#BFDBFE",
                    300: "#93C5FD",
                    400: "#60A5FA",
                    500: "#3B82F6",
                    600: "#2563EB",
                    700: "#1D4ED8",
                    800: "#1E40AF",
                    900: "#1E3A8A",
                },
            },
            // Sombras iOS-style
            boxShadow: {
                "ios-sm":  "0 1px 2px 0 rgb(0 0 0 / 0.04)",
                "ios":     "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
                "ios-md":  "0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)",
                "ios-lg":  "0 10px 15px -3px rgb(0 0 0 / 0.07), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
            },
            // Animación usada por toast del SaveButton
            animation: {
                "fade-in-down": "fadeInDown 0.2s ease-out",
            },
            keyframes: {
                fadeInDown: {
                    "0%":   { opacity: "0", transform: "translate(-50%, -10px)" },
                    "100%": { opacity: "1", transform: "translate(-50%, 0)" },
                },
            },
            // Familia tipográfica del sistema
            fontFamily: {
                sans: [
                    "-apple-system", "BlinkMacSystemFont", '"SF Pro Display"',
                    '"SF Pro Text"', "Inter", '"Segoe UI"', "Roboto",
                    "system-ui", "sans-serif",
                ],
            },
        },
    },

    // Sin plugins extra (podrías añadir @tailwindcss/forms, etc.)
    plugins: [],

    // Importante: NO añadimos `corePlugins: {}` para desactivar nada
    // — la app usa prácticamente todo el set de Tailwind.
};
