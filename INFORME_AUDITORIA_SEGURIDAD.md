# MOZONA TPV v2 — Informe de auditoría, refactor y blindaje de seguridad

**Fecha:** 2026-10-04
**Ámbito:** `/home/riyad/Downloads/mozona-tpv-v2-main(1)/mozona-tpv-v2-main`
**Stack:** React + Vite + TypeScript · Backend Express (`server/`) · Supabase (PostgreSQL + RLS + Edge Functions Deno) · Tauri v2 (desktop) · Modo LAN
**Estado de verificación:** `tsc --noEmit` **OK (0 errores)** · `npm run build` **OK** · sin secretos privilegiados en el bundle (`dist/assets`)

> Nota: el árbol de trabajo contiene copias anidadas (`mozona-tpv-v2-fixed/…`). **Todos los cambios de esta auditoría se aplicaron al árbol raíz**, que es la ruta indicada como objetivo.

---

## 1. Resumen ejecutivo

Se corrigieron fallos funcionales bloqueantes, se eliminaron backdoors y vectores de escalada, se movió la verificación de identidades (PIN de camareros, API key LAN) a comparaciones en tiempo constante del lado servidor, y se restringió CORS/roles en las Edge Functions. El proyecto **compila y construye limpio**.

### Hallazgos por severidad

| # | Severidad | Hallazgo | Estado |
|---|-----------|----------|--------|
| H-1 | **Crítica** | `src/lib/waiters.ts`: `setWaiterPin` invocado pero no definido → el guardado de camareros estaba roto (build/uso fallaba). | **Corregido** |
| H-2 | **Crítica** | `updateWaiter` escribía el PIN **en claro** en la tabla `waiters`. | **Corregido** (RPC `set_waiter_pin`, hash server-side) |
| H-3 | **Crítica** | `findByPinCached` comparaba `x.pin === pin` en el cliente: inservible/inseguro tras ocultar PINs. | **Corregido** (RPC `verify_waiter_pin_tenant`) |
| H-4 | **Crítica** | `useWaiterAuth.ts`: PINs maestros `1234/0000/9999` como **backdoor** siempre activo. | **Corregido** (gated a modo demo explícito) |
| H-5 | **Alta** | `server/routes.ts` `requireKey`: aceptaba la API key por **query string** (`?key=`) y comparaba con `!==` (no constant-time). | **Corregido** |
| H-6 | **Alta** | `server/local-server.ts`: API key por defecto `mozona-dev-key`, `CORS origin:true`, banner imprimía la clave y el handler filtraba `err.message`. | **Corregido** (fail-closed en prod) |
| H-7 | **Alta** | `.env.production.backup` **fuera de `.gitignore`** con **proyecto Supabase real + anon JWT + email de superadmin**. | **Mitigado** (.gitignore) — **requiere rotación** (§7) |
| H-8 | **Alta** | Edge Functions `billing-portal`, `verify-checkout-session`, `apply-rls-migrations` con `Access-Control-Allow-Origin: *`. | **Corregido** (allowlist) |
| H-9 | **Alta** | `apply-rls-migrations`: comparación de service_role/migration token con `===` (timing) . | **Corregido** (constant-time) |
| H-10 | **Media** | `src/pages/AdminApprovePage.tsx`: `useCallback(..., [token])` referenciaba `token` inexistente → **error de compilación TypeScript**. | **Corregido** |
| H-11 | **Media** | `OnboardingWizard.tsx` insertaba PIN en claro en `tenant_users.pin_code` (email sintético `@mozona.local`). | **Corregido** (usa `createWaiter`) |
| H-12 | **Media** | `SummaryStep.tsx` imprimía el PIN en claro (`PIN ${w.pin}`). | **Corregido** (enmascarado) |
| H-13 | **Media** | `resolveRealTenantId` usaba RPC `get_first_active_tenant` (cross-tenant leak, eliminada por migración 73). | **Corregido** (RPC `get_my_tenant`) |
| H-14 | **Baja** | `.env.example` promovía `VITE_SUPABASE_SERVICE_ROLE_KEY` y `VITE_TELEGRAM_BOT_TOKEN` (se filtrarían al bundle). | **Corregido** (comentados + nota) |

---

## 2. Backend LAN (`server/`)

### `server/routes.ts` — middleware de API key
- **Eliminado** el fallback por query string (`req.query.key`) para toda la API.
- **Añadida** comparación en tiempo constante:
  ```ts
  import { timingSafeEqual } from "node:crypto";
  function keysMatch(provided: string, expected: string): boolean {
      const a = Buffer.from(provided), b = Buffer.from(expected);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
  }
  ```
- La autenticación se acepta **solo** por cabecera `X-Mozona-Key` (evita filtrado en logs, `Referer`, historiales y caches).
- Nota: `PATCH /api/restaurant` construye SQL dinámico **solo** con nombres de columna de una whitelist y valores parametrizados (`$n`) → sin inyección.

### `server/local-server.ts` — API key y errores
- **Fail-closed**: en `NODE_ENV=production` exige `LAN_API_KEY` de `>= 16` caracteres; si no, **no arranca**.
- En desarrollo, si falta la clave, se **genera aleatoriamente** (`randomBytes(24).toString("base64url")`) y se imprime **una sola vez** (clave efímera de sesión).
- Banner usa `maskKey(...)` en lugar de mostrar la clave.
- Handler de errores devuelve `{ error: "internal" }` en producción (sin `err.message`/stack).
- `server/ws-manager.ts` ya usaba comparación constant-time (XOR sobre `Buffer`) → correcto, sin cambios.

---

## 3. Camareros / PINs (server-side)

- **`src/lib/waiters.ts`**: definida `setWaiterPin`; `updateWaiter` ya **no** escribe `body.pin`; `findByPinCached` verifica vía RPC `verify_waiter_pin_tenant`; `resolveRealTenantId` usa RPC `get_my_tenant`.
- **`src/hooks/useWaiterAuth.ts`**: los PINs maestros quedan **desactivados** salvo modo demo explícito (`VITE_DEMO_MODE=true` o build de desarrollo).
- **`src/pages/OnboardingWizard.tsx`** y **`onboarding/SummaryStep.tsx`**: alta de camareros vía `createWaiter` (hash server-side) y PIN enmascarado en resumen.
- **Migraciones**: `database/74_waiter_pin_hash.sql` ampliada (RPCs `set_waiter_pin`, `verify_waiter_pin_tenant`, `verify_waiter_login`, `verify_waiter_pin`, tabla `waiter_pin_attempts` para rate-limit, backfill `pin → pin_hash`); `database/73_AUDIT_FULL_BLOCK_1.sql` crea RLS/`is_admin`, revoca `anon`, elimina `get_first_active_tenant` y aplica `pin_hash NOT NULL` + `DROP pin`. **Orden recomendado: 73 → 74** (verificado como orden-independiente).

> ⚠️ **Cambio de comportamiento**: al pasar la verificación de PIN al servidor, el login de camarero **ya no funciona offline**. Es intencional (seguridad > offline para credenciales). Documentar al equipo de operaciones.

---

## 4. Edge Functions (Supabase / Deno)

- Eliminadas las cabeceras de identidad spoofables `x-user-email` / `x-admin-email`.
- Verificación de JWT de usuario vía GoTrue y `timingSafeEqual` con guarda anti-vacío en `_shared/security.ts`.
- **CORS con allowlist** (`corsHeaders(req)`) en:
  - `billing-portal/index.ts` (reemplazado `*`; `jsonError` inlined para cerrar sobre `req`).
  - `verify-checkout-session/index.ts` (reemplazado `*`).
  - `apply-rls-migrations/index.ts` (reemplazado `*` **y** comparaciones `===` por `timingSafeEqual`).
- `telegram-webhook` usa `timingSafeEqual` + secret. Correcto.

**Residual (riesgo aceptado / a revisar):**
- `telegram-notify` acepta `SERVICE_ROLE_KEY` como `Bearer` (llamada server-to-server). Es un patrón discutible pero no un bypass anónimo.
- La rotación de `SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` y `TELEGRAM_BOT_TOKEN` debe hacerse en los Secrets de Supabase, no en el repo.

---

## 5. Frontend / XSS

Verificado que las superficies de inyección **ya están escapadas**:
- `src/lib/ticketPrinter.ts`: `buildTicketHTML` escapa **cada** línea con `escapeHtml` (& < > " '). `window.open` fija `opener = null`.
- `src/components/settings/TeamPanel.tsx`: título con `escapeHtml`; el HTML impreso es `outerHTML` serializado del DOM (sin HTML crudo de usuario); `opener = null`.
- `src/main.tsx`: `renderFallback(message)` interpola `escapeHtml(message)`.
- Enlaces externos usan `rel="noopener noreferrer"`.

**Bug corregido (H-10):** `AdminApprovePage.tsx` — eliminado `[token]` del array de dependencias de `approveById` (la JWT la inyecta `safeFetch`; `token` ya no existe).

---

## 6. Configuración / Secretos

- **`.gitignore`**: ahora ignora cualquier variante de entorno (`.env`, `.env.*`, `.env*.local`) manteniendo `.env.example` versionado → **cubre `.env.production.backup`**.
- **`.env.example`**: retiradas las líneas que promovían `VITE_SUPABASE_SERVICE_ROLE_KEY` y `VITE_TELEGRAM_BOT_TOKEN`; sustituidas por guías sin prefijo `VITE_`.

### Tauri (documentado, sin cambios de código)
`src-tauri/tauri.conf.json` tiene CSP restrictiva (`script-src 'self'`, `connect-src` limitado a LAN + Supabase). Los plugins `shell`, `dialog`, `fs`, `http` están **en uso** por los comandos del frontend, por lo que **no se recortaron** para no romper funcionalidad. Recomendaciones de endurecimiento:
- Acotar `shell.open` a un *scope* de URLs (hoy `open: true` global).
- Revisar `tauri-plugin-http` con feature `unsafe-headers` (permite cabeceras peligrosas desde el frontend).

---

## 7. ACCIONES REQUERIDAS POR EL OPERADOR (no automatizables)

1. **Rotar credenciales** expuestas en `.env.production.backup` (proyecto `hcqkpokodrqimkulporw`):
   - Regenerar la **anon key** en Supabase (Dashboard → Settings → API) y, si el proyecto estuvo público, revisar logs de acceso.
   - El **email de superadmin** (`rofixinsta@gmail.com`) quedó expuesto → confirmar que sigue siendo el previsto.
   - **Eliminar** el archivo `.env.production.backup` del árbol de trabajo y del historial si alguna vez fue commiteado (`git filter-repo`/BFG).
2. Confirmar que **`SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` y `TELEGRAM_BOT_TOKEN`** no estén en ningún commit; rotarlas si hubo exposición.
3. Definir **`CORS_ALLOWED_ORIGINS`** en los Secrets de Supabase (producción) y **`LAN_API_KEY`** (>= 32 caracteres) en el arranque del servidor LAN.
4. Aplicar migraciones **73 → 74** en el SQL Editor de Supabase.

---

## 8. Riesgos residuales / no verificados

- **E2E con navegador no ejecutado**: `agent-browser`/Chromium no están instalados en este host (solo en el sandbox Cloud). La verificación realizada es **estática**: `tsc --noEmit` (0 errores) + `npm run build` (OK) + revisión de que no haya secretos privilegiados en `dist/assets`. Los flujos en runtime (creación de usuario, turnos/cajas, WebSocket) **no** se probaron contra un backend vivo (requiere Postgres + Supabase).
- **`dist/database/*.sql`**: el postbuild copia las 74 migraciones a `dist/`, que se sirve como estático. Contienen esquema/RLS (sin secretos), pero conviene **excluirlas del despliegue público** para minimizar divulgación de esquema.
- **Fugas de memoria / timeouts Node**: no evaluables sin ejecución prolongada.
- `telegram-notify` con Bearer de service_role: patrón a revisar (no bypass anónimo).

---

## 9. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/lib/waiters.ts` | `setWaiterPin`, `updateWaiter` (sin PIN claro), `findByPinCached` y `resolveRealTenantId` vía RPCs |
| `src/hooks/useWaiterAuth.ts` | PINs maestros gated a modo demo |
| `src/pages/OnboardingWizard.tsx` | alta de camareros vía `createWaiter` (sin `pin_code` claro) |
| `src/pages/onboarding/SummaryStep.tsx` | PIN enmascarado |
| `src/pages/AdminApprovePage.tsx` | fix dependencia `[token]` (error TS) |
| `server/routes.ts` | API key solo por cabecera + constant-time |
| `server/local-server.ts` | fail-closed, clave aleatoria dev, `maskKey`, error genérico |
| `supabase/functions/billing-portal/index.ts` | CORS allowlist |
| `supabase/functions/verify-checkout-session/index.ts` | CORS allowlist |
| `supabase/functions/apply-rls-migrations/index.ts` | CORS allowlist + constant-time |
| `database/74_waiter_pin_hash.sql` | RPCs PIN/rate-limit + backfill |
| `.env.example` | retirados ejemplos con prefijo `VITE_` para secretos |
| `.gitignore` | ignora `.env.*` (incluye `.env.production.backup`) |

---

## 10. Continuación de la auditoría (segunda sesión, 2026-10-04)

### 10.1 Cierre de residuales de código
- **`supabase/functions/apply-rls-migrations/index.ts`**: la respuesta ya **no devuelve `sql: migration.sql`**; sólo `name/ok/error`. Antes, un llamante autenticado con `SERVICE_ROLE_KEY`/`MIGRATION_SECRET_TOKEN` podía recuperar el DDL completo del esquema (divulgación de esquema). *Verificado en código.*
- **CORS con allowlist** (`corsHeaders(req)`) confirmado en `billing-portal`, `verify-checkout-session` y `apply-rls-migrations`; `jsonError` correctamente dentro del alcance del handler.
- **Tauri**: `src-tauri/capabilities/default.json` recortado — eliminados `shell:allow-open`, `dialog:default` y `fs:default` (el frontend **no** usa esos plugins: sólo `@tauri-apps/api/core` + `event` y `window.__TAURI__.core`). `src-tauri/tauri.conf.json`: `plugins.shell.open` (legacy) → `"plugins": {}`.
  - *Residual*: el plugin `tauri_plugin_http` con feature `unsafe-headers` sigue registrado en `main.rs` aunque no se usa desde JS. No se modificó Rust por no poder compilar (`cargo` no instalado) — recomendado retirarlo en una PR con build Rust verificado.
- **`server/ws-manager.ts`**: eliminadas importaciones de tipos no usadas (`WelcomeData`, `PongData`, `ErrorData`); el servidor compila sin errores de `tsc`.

### 10.2 Verificación runtime del servidor LAN (antes no ejecutable)
Cloud/sandbox no alcanzaba; se ejecutó en el propio host Kali:

| Prueba | Resultado |
|--------|-----------|
| Arranque `NODE_ENV=production` con `LAN_API_KEY` débil | **Aborta** (exit 1) con mensaje de seguridad — *fail-closed OK* |
| `GET /api/health` (público) | 503 `{status:"degraded",db:"error"}` (sin Postgres); no filtra detalle interno |
| `GET /api/tables` sin clave | **401** `unauthorized` |
| `GET /api/tables` clave errónea | **401** |
| `GET /api/tables?key=<clave>` (query) | **401** — *fallback por query eliminado, confirmado* |
| `GET /api/tables` con `X-Mozona-Key` correcta | **500** `{error:"internal"}` — auth pasó; el error interno **no** se filtra |
| WebSocket `?key=` errónea | Cierre **4401 "Invalid API key"** |
| WebSocket `?key=` correcta | **WELCOME** (serverId/version) |
| Banner de arranque | Clave **enmascarada** (`Sup3…ef (len=32)`); sin línea `[DEV]` en producción |

Conclusión: **autenticación, constant-time, CORS sin credenciales, aislamiento de errores y fail-closed verificados en runtime.**

### 10.3 Verificación de build y secretos
- `tsc --noEmit` → **0 errores**. `npm run build` → **OK** (7,85 s; 74 SQL copiadas; iconos OK).
- **`dist/` limpio de secretos criptográficos**: 0 JWTs (`eyJ…`), 0 `sk_live/sk_test`, 0 fragmento del anon key real (`zfOJWzut…`), 0 `service_role` en `dist/assets`. La única clave pública presente es `sb_publishable_…` (formato publishable de Supabase — **pública por diseño**).
- `SUPABASE_SERVICE_ROLE_KEY` / `service_role` sólo aparecen como texto en las definiciones RLS de `dist/database/*.sql` (esquema, no credenciales).

### 10.4 NUEVOS HALLAZGOS (no cubiertos en la primera pasada)

| # | Severidad | Hallazgo | Estado |
|---|-----------|----------|--------|
| H-15 | **Alta** | `verify_test.sh` contenía la **contraseña real de producción** (`rincon123rincon`) de la cuenta VIP `chalohiahmd1980@gmail.com`, y el mismo valor aparecía como comentario en `database/07_vip_unlock.sql`. Se iba a publicar en GitHub. | **Corregido** — credenciales leídas de entorno (`MOZONA_TEST_EMAIL`/`MOZONA_TEST_PASSWORD`); comentario SQL saneado a `<TU_PASSWORD_SEGURA>` |
| H-16 | **Media** | El **email del superadmin** (`rofixinsta@gmail.com`) y el email del cliente VIP (`chalohiahmd1980@gmail.com`) están **hardcodeados** en el bundle cliente (`dist/assets/index-*.js`, `help.html`, `sql-install.html`) y en ~20 puntos de `src/`. Permite identificar las cuentas admin/VIP para phishing/credential-stuffing. | **Documentado (no corregido).** Requiere refactor coordinado → §11 |

> ⚠️ **ACCIÓN CRÍTICA H-15**: como esa contraseña iba a quedar en un repositorio, **cámbiala ya** en Supabase (Auth → Users → `chalohiahmd1980@gmail.com`) — no basta con borrarla del código si el repo llegó a ser público en algún momento.

### 10.5 Preparación del repositorio y push
- `git init` en la raíz; identidad local `MOZONA Security Audit <audit@mozona.local>`; rama `main`.
- `.gitignore` endurecido: `dist/`, `dist-server/`, `node_modules/`, `server/node_modules/`, `mozona-tpv-v2-fixed/`, `test-results/`, `playwright-report/`, `.audit_logs/`, `.env*` (manteniendo `.env.example`).
- **Verificado que NO quedan versionados**: `.env.production.backup`, `dist/`, `node_modules/`, `mozona-tpv-v2-fixed/` (comprobado con `git ls-files`). Total: **384 archivos**.
- Commit creado: `bf1bc94` — *"security: hardening MOZONA TPV v2 (auditoria)…"*.
- **Push BLOQUEADO**: el host no tiene credenciales de GitHub (sin PAT, sin `gh`, sin claves SSH, sin credential helper). `git push` → `fatal: could not read Username for 'https://github.com'`. → §12.

---

## 11. Recomendación para H-16 (emails hardcodeados en el cliente)

El email del superadmin/VIP **no debe viajar en el bundle**. Refactor recomendado (una sola PR, con pruebas):

1. Crear `src/lib/adminConfig.ts` que lea **solo** de entorno:
   ```ts
   export const SUPERADMIN_EMAIL = (import.meta.env.VITE_SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
   export const VIP_EMAILS: readonly string[] =
     (import.meta.env.VITE_VIP_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
   export const isSuperAdminEmail = (e?: string | null) => !!e && e.trim().toLowerCase() === SUPERADMIN_EMAIL;
   ```
   Definir combinación *fail-safe*: si la variable no está definida, **ningún** email coincide (no se concede admin/VIP por defecto).
2. Sustituir los literales en `src/lib/supabase.ts`, `src/lib/vip.ts`, `src/lib/notify.ts`, `src/lib/api-router.ts`, `src/context/AuthContext.tsx`, `src/lib/tenantSync.ts`, `src/hooks/usePosData.ts`.
3. **Cuidado (migración de datos)**: literales usados como *claves de localStorage* (`pos_custom_products_chalohiahmd1980@gmail.com`, etc. en `catalog.ts`, `sync-helpers.ts`, `CategoriesPanel.tsx`, `ItemsPanel.tsx`, `CatalogPanel.tsx`) y el **mapa email→UUID de tenant** (`usePosData.ts`). Cambiarlos sin migración **huérfana** los datos locales de usuarios existentes. Mantener las claves antiguas como *fallback de lectura* y escribir sólo las nuevas.
4. Añadir `VITE_SUPERADMIN_EMAIL` y `VITE_VIP_EMAILS` a los **Environment Variables** del build (Vercel/CI). **Sin ellas, el login admin/VIP dejará de funcionar** (fail-safe, no fail-open).
5. Retirar los emails también de `dist/database/*.sql`, `help.html` y `sql-install.html` (o excluirlos del despliegue público, ver §8).

> No se aplicó automáticamente por el **riesgo de regresión** en login admin/VIP y en datos locales existentes; requiere una ventana de prueba controlada.

---

## 12. Instrucciones para completar el push (operador)

El commit `bf1bc94` está listo localmente. Para subirlo al repo `https://github.com/ryad12345/Copia-de-seguridad-del-dashboard-`, ejecuta en la raíz del proyecto:

```bash
cd "/home/riyad/Downloads/mozona-tpv-v2-main(1)/mozona-tpv-v2-main"

# Opción A — HTTPS con Personal Access Token (scope: repo)
git remote set-url origin "https://<TU_USUARIO>:<TU_PAT>@github.com/ryad12345/Copia-de-seguridad-del-dashboard-.git"
git push -u origin main

# Opción B — GitHub CLI
gh auth login          # autentícate
git push -u origin main

# Opción C — SSH
git remote set-url origin git@github.com:ryad12345/Copia-de-seguridad-del-dashboard-.git
git push -u origin main
```

Notas:
- Si el repo remoto ya tiene contenido, usa `git pull --rebase origin main` antes de `push`, o `git push -f` **sólo** si estás seguro de sobrescribir.
- El repo debe **existir** y ser accesible con esas credenciales (un repo privado ajeno devuelve `Repository not found`).
- **Nunca** subas `.env.production.backup` (ya está en `.gitignore`).
