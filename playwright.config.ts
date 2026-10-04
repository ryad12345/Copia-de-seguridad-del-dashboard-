// =====================================================================
// MOZONA TPV — Playwright E2E config
// =====================================================================
// Ejecuta TODAS las pruebas que el cliente final haría en el TPV físico,
// pero automatizadas.  Para correrlas:
//
//   npm run dev            # (en otra terminal)
//   npm run e2e            # este script
//
// Variables de entorno:
//   BASE_URL   — default http://localhost:5173
//   E2E_EMAIL  — email de prueba (default chalohiahmd1980@gmail.com)
//   E2E_PASS   — contraseña
//   E2E_NO_AUTH — "1" para saltarse login y probar modo demo
// =====================================================================

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,        // secuencial para no saturar Supabase
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
    use: {
        baseURL: BASE_URL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        viewport: { width: 1280, height: 800 },
        locale: "es-ES",
    },
    projects: [
        { name: "desktop",  use: { ...devices["Desktop Chrome"] } },
        { name: "tablet",   use: { ...devices["iPad Landscape"] } },
    ],
});
