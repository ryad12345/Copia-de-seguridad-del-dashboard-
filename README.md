# MOZONA TPV — Plataforma SaaS multi-tenant para hostelería

**TPV Local-First + Cloud.**  Aplicación de caja para restaurantes
con comanderos móviles, gestión de mesas, VeriFactu AEAT, impresoras
térmicas ESC/POS y sincronización multi-dispositivo.  Funciona 100% en
el navegador; instalable como PWA; instalable en PC como app Tauri.

---

## Quick start

```bash
npm install
cp .env.example .env       # rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```

Para producción:
```bash
npm run build              # genera dist/ → sube a Netlify/Vercel/etc.
```

---

## 1. Setup de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta el archivo `database/02_saas_migration.sql`
   (es idempotente).  Crea las tablas, índices, políticas RLS y triggers.
3. En **Authentication → Providers** habilita Google OAuth
4. Copia la URL del proyecto y la anon key a tu `.env`:
   ```env
   VITE_SUPABASE_URL=https://TU_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGc...
   ```
5. (Opcional) Configura **Authentication → URL Configuration** con tu
   dominio público (`https://mozona-tpv.com`).

El email **rofixinsta@gmail.com** queda marcado automáticamente como
**SuperAdmin** (bypass de paywall + acceso a `/admin/invites`).

---

## 2. Estructura del proyecto

```
src/
├── App.tsx                       ← routing SaaS completo
├── main.tsx
├── components/
│   ├── icons.tsx                 ← iconos Lucide-style
│   ├── ProtectedRoute.tsx        ← ProtectedRoute / AdminRoute / SubscriptionGuard
│   ├── ServerConfigBanner.tsx    ← pide IP de la caja central en PWA
│   ├── auth/PinAuthModal.tsx     ← PIN con fallback master + offline
│   ├── settings/...              ← BrandingCard, FiscalDataCard, etc.
│   ├── pos/...                   ← CatalogPanel, OrderPanel, PaymentPanel
│   ├── pwa/...                   ← PwaShell, InstallPrompt, UpdatePrompt
│   └── landing/                  ← (sub-componentes de LandingPage)
├── lib/
│   ├── supabase.ts               ← cliente + tipos + isSuperAdmin
│   ├── auth.tsx                  ← AuthProvider + useAuth
│   ├── syncEngine.ts             ← push/pull Supabase + offline queue
│   ├── offlineStorage.ts         ← IndexedDB (idb)
│   ├── ws-config.ts              ← IP de la caja central
│   ├── types.ts                  ← modelos compartidos
│   └── ...
├── hooks/
│   ├── useIsMobile.ts
│   ├── useLocalSocket.ts
│   ├── WebSocketProvider.tsx
│   └── useNetworkSync.ts
├── pages/
│   ├── LandingPage.tsx           ← marketing
│   ├── AuthPage.tsx              ← login/signup
│   ├── PricingPage.tsx           ← paywall + invite redemption
│   ├── AdminInvitesPage.tsx      ← panel superadmin
│   ├── SetupCajaPage.tsx         ← scripts instalación
│   ├── PosTerminalPro.tsx        ← TPV de caja (desktop)
│   ├── WaiterPad.tsx             ← comandero móvil
│   └── SettingsPage.tsx
└── styles/
    └── globals.css               ← Tailwind base + helpers

shared/
└── ws-events.ts                  ← tipos del WebSocket LAN

database/
├── 01_schema.sql                 ← (legacy) esquema SQLite
└── 02_saas_migration.sql         ← esquema SaaS multi-tenant (USAR ESTE)
```

---

## 3. Rutas SaaS

| Ruta | Componente | Acceso |
|---|---|---|
| `/` | `LandingPage` | público |
| `/auth` | `AuthPage` | público |
| `/auth/callback` | `AuthCallback` | público (OAuth redirect) |
| `/pricing` | `PricingPage` | autenticado sin suscripción |
| `/setup-caja` | `SetupCajaPage` | público |
| `/admin/invites` | `AdminInvitesPage` | **sólo SuperAdmin** |
| `/app` | `RootRoute` (auto: TPV/Waiter según viewport) | autenticado + suscripción activa |
| `/waiter` | `WaiterPad` | autenticado + suscripción activa |
| `/tpv` | `PosTerminalPro` | autenticado + suscripción activa |
| `/settings` | `SettingsRoute` | autenticado |

**Guards:**
- `<ProtectedRoute>` — exige sesión
- `<AdminRoute>` — exige email == SuperAdmin
- `<SubscriptionGuard>` — exige tenant con `subscription_status = active` o `trialing`
  (SuperAdmin pasa siempre; modo demo sin Supabase también)

---

## 4. Roles y bypass SuperAdmin

El email `rofixinsta@gmail.com` queda automáticamente marcado como
**SuperAdmin** vía trigger SQL (`handle_new_user`).  Esto le da:

- **Bypass de paywall**: `SubscriptionGuard` siempre lo deja pasar.
- **Acceso a `/admin/invites`** para generar tokens de invitación.
- **Acceso total RLS** en todas las tablas (bypass via
  `is_superadmin()` function).

El SuperAdmin puede generar invitaciones para clientes (`plus_30`,
`pro_50` o `lifetime_vip`).  Cada invitación es un token único que
el cliente canjea en `/auth?invite=TOKEN` y activa el plan
correspondiente.

---

## 5. Sincronización Supabase ↔ Local

El `syncEngine` corre en el frontend y:

1. **Push**: drena la cola `pendingSync` de IndexedDB → upsert en
   Supabase (`invoices`, `orders`, `order_items`) cuando vuelve la red.
2. **Pull**: descarga catálogo, mesas y configuración desde Supabase
   → IndexedDB al montar y al volver online.

`usePosData` consume los datos de IndexedDB, así que la app sigue
funcionando offline y refleja cambios en cuanto llegan.

Para activar **realtime** entre dispositivos, suscríbete en el
`WebSocketProvider` con `supabase.channel('orders').on('postgres_changes', ...)`.

---

## 6. Modo demo (sin Supabase)

Si dejas `VITE_SUPABASE_URL` vacío:

- `LandingPage`, `SetupCajaPage` funcionan como vitrina estática.
- `AuthPage` muestra un banner "Modo demo".
- `SubscriptionGuard` deja pasar a las rutas internas.
- El TPV y el comandero funcionan con los datos mock.
- `PricingPage` activa suscripciones demo sin pasar por Stripe.

Útil para hacer demos sin backend.

---

## 7. Modo Tauri (instalador de escritorio)

```bash
npm run tauri:dev    # ventana de desarrollo
npm run tauri:build  # MSI / DEB / DMG
```

En este modo, el LAN server va embebido en Rust; los camareros se
conectan al PC por la Wi-Fi local.

---

## 8. Configuración de Stripe (opcional)

Si dejas las `VITE_STRIPE_PRICE_*` vacías, la página de pricing
entra en **modo demo** y activa suscripciones directamente.  Para
producción:

1. Crea los productos y precios en el dashboard de Stripe.
2. Pon los IDs de precio en `.env`:
   ```env
   VITE_STRIPE_PRICE_PLUS=price_xxxPlus30Monthly
   VITE_STRIPE_PRICE_PRO=price_xxxPro50Monthly
   ```
3. Despliega la Edge Function `create-checkout` en Supabase:
   ```typescript
   // supabase/functions/create-checkout/index.ts
   import Stripe from "npm:stripe@13";
   const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-04-10" });
   Deno.serve(async (req) => {
     const { priceId, successUrl, cancelUrl } = await req.json();
     const session = await stripe.checkout.sessions.create({
       mode: "subscription",
       line_items: [{ price: priceId, quantity: 1 }],
       success_url: successUrl, cancel_url: cancelUrl,
     });
     return new Response(JSON.stringify({ url: session.url }), {
       headers: { "Content-Type": "application/json" },
     });
   });
   ```

---

## 9. Variables de entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `VITE_SUPABASE_URL` | URL de tu proyecto Supabase | sí para SaaS |
| `VITE_SUPABASE_ANON_KEY` | Anon key pública | sí para SaaS |
| `SUPABASE_SERVICE_KEY` | Service role — sólo en Edge Functions | sólo backend |
| `VITE_SUPERADMIN_EMAIL` | Email con bypass total | opcional (default `rofixinsta@gmail.com`) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe public key | opcional |
| `VITE_STRIPE_PRICE_PLUS` | Price ID Plus 30€ | opcional |
| `VITE_STRIPE_PRICE_PRO` | Price ID Pro 50€ | opcional |
| `MOZONA_LAN_PORT` | Puerto LAN server Tauri | 7421 default |

---

## Licencia

Propietaria.  © 2025 MOZONA TPV.

<!-- rebuild 1787965501 -->

<!-- rebuild 1787965719 -->
