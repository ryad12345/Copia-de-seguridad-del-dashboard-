// =====================================================================
// MOZONA TPV — postcss.config.js
// =====================================================================
// Vite + Vite-PWA invocan este config automáticamente al procesar
// cualquier `.css` importado desde la app.  Sin esta pieza, las
// directivas `@tailwind base/components/utilities` y los `@apply`
// del globals.css se quedan sin compilar y la app sale sin estilos.
// =====================================================================

export default {
    plugins: {
        // 1) Tailwind: resuelve @tailwind y @apply.
        tailwindcss: {
            // Apunta al config.  Es opcional (lo encuentra por defecto
            // en la raíz) pero lo hacemos explícito.
            config: "./tailwind.config.js",
        },
        // 2) Autoprefixer: añade vendor prefixes (webkit, moz, etc.)
        //    para Safari/iOS y navegadores antiguos.
        autoprefixer: {},
    },
};
