import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        // ★ v3.4.1: Legacy plugin DESHABILITADO por timeout de Vercel (45s max)
        //   En lugar de polyfills, confiamos en navegadores modernos.
        //   Si necesitas compatibilidad con tablets antiguas, considera self-hosted.
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            strategies: "injectManifest",
            filename: "sw.js",
            disable: true,
            includeAssets: ["favicon.svg", "icons/icon.svg", "manifest.json"],
            manifest: {
                name: "MOZONA TPV",
                short_name: "MozonaTPV",
                description: "Sistema TPV Local-First para hostelería con VeriFactu",
                version: "3.4.1-build-fix",
                lang: "es-ES",
                dir: "ltr",
                scope: "/",
                start_url: "/",
                display: "standalone",
                orientation: "any",
                theme_color: "#2563EB",
                background_color: "#F0F2F5",
                categories: ["business", "productivity", "finance"],
                icons: [
                    { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                    { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                    { src: "/icons/icon-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                    { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
                ],
            },
            workbox: {
                globPatterns: ["**/*.{svg,png,ico,woff,woff2,webp,avif}"],
                cleanupOutdatedCaches: true,
                navigateFallbackDenylist: [/^\/api\//, /^\/waiting-activation/, /\.html$/],
                navigateFallback: null,
                skipWaiting: true,
                clientsClaim: true,
                runtimeCaching: [
                    {
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: "CacheFirst",
                        options: { cacheName: "google-fonts-stylesheets", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
                    },
                    {
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: "CacheFirst",
                        options: { cacheName: "google-fonts-webfonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
                    },
                    {
                        urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
                        handler: "CacheFirst",
                        options: { cacheName: "supabase-storage", expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } },
                    },
                    {
                        urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
                        handler: "NetworkFirst",
                        options: { cacheName: "supabase-api", networkTimeoutSeconds: 5, expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 } },
                    },
                    {
                        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/i,
                        handler: "StaleWhileRevalidate",
                        options: { cacheName: "images", expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 } },
                    },
                ],
            },
            devOptions: { enabled: false, type: "module" },
        }),
    ],
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
        host: false,
        hmr: { protocol: "ws", host: "localhost", port: 5174 },
        watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    "vendor-react": ["react", "react-dom", "react-router-dom"],
                    "vendor-supabase": ["@supabase/supabase-js"],
                },
            },
        },
        chunkSizeWarningLimit: 1500,
    },
});

// Force rebuild trigger: Sat Sep 26 13:06:01 UTC 2026
