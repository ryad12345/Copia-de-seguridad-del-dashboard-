# MOZONA TPV — Edge Functions (Supabase)

Este directorio contiene las Edge Functions que viven en `supabase/functions/`.

## Listado

| Función                  | Ruta                                                  | Auth         | Descripción                                  |
|--------------------------|-------------------------------------------------------|--------------|----------------------------------------------|
| `extract-menu`           | `POST /functions/v1/extract-menu`                     | `--no-verify-jwt` | OCR de carta con Gemini 1.5 Flash         |
| `create-checkout-session`| `POST /functions/v1/create-checkout-session`          | JWT usuario  | Crea sesión de Stripe Checkout (suscripción) |
| `billing-portal`         | `POST /functions/v1/billing-portal`                   | JWT usuario  | Abre Stripe Customer Portal                  |
| `stripe-webhook`         | `POST /functions/v1/stripe-webhook`                   | Firma Stripe | Sincroniza `tenants.subscription_status`     |
| `verify-checkout-session`| `POST /functions/v1/verify-checkout-session`          | anon         | Valida sesión de Stripe (pago confirmado)    |
| `waiter-api`             | `GET/POST /functions/v1/waiter-api?action=...`        | Token HMAC   | API para camareros (login, productos, mesas, órdenes) |

## Despliegue (una sola vez)

### 1. CLI de Supabase
```bash
brew install supabase/tap/supabase       # macOS
# o: scoop install supabase             # Windows
# o ver: https://github.com/supabase/cli

supabase login
supabase link --project-ref hcqkpokodrqimkulporw
```

### 2. Variables secretas

```bash
# Gemini (extract-menu)
supabase secrets set GEMINI_API_KEY=AIzaSy...

# Stripe (create-checkout-session, billing-portal, stripe-webhook)
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_PRICE_PLUS=price_...
supabase secrets set STRIPE_PRICE_PRO=price_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

# Frontend
supabase secrets set PUBLIC_URL=https://mozona-tpv.vercel.app
```

> ⚠️ **NUNCA** anteponer `VITE_` a las secret keys: Vite las bundlea en el cliente.

### 3. Deploy
```bash
supabase functions deploy extract-menu           --no-verify-jwt
supabase functions deploy create-checkout-session
supabase functions deploy billing-portal
supabase functions deploy stripe-webhook         --no-verify-jwt
```

### 4. Webhook en Stripe Dashboard

1. https://dashboard.stripe.com/test/webhooks
2. **Add endpoint**
3. URL: `https://hcqkpokodrqimkulporw.supabase.co/functions/v1/stripe-webhook`
4. Eventos:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copia el **Signing secret** (`whsec_...`) → `supabase secrets set STRIPE_WEBHOOK_SECRET=...`

## Crear los Price IDs

En Stripe Dashboard → Products → Create product:
- **MOZONA Plus 30€** → recurring monthly 30 EUR → copia `price_...`
- **MOZONA Pro 50€**  → recurring monthly 50 EUR → copia `price_...`

Esos son los `STRIPE_PRICE_PLUS` / `STRIPE_PRICE_PRO`.

## Flujo end-to-end

```
1. Usuario en /pricing → click "Suscribirme Plus"
2. Frontend → supabase.functions.invoke("create-checkout-session", { plan: "plus" })
3. Edge function → crea customer (si no existe) + checkout session → devuelve { url }
4. Frontend → window.location.href = url
5. Usuario paga en Stripe
6. Stripe → webhook customer.subscription.created
7. stripe-webhook → UPDATE tenants SET plan='plus_30', subscription_status='active'
8. Stripe redirige a {PUBLIC_URL}/billing/success?session_id=...
9. BillingSuccessPage muestra confirmación + botón "Gestionar facturación"
10. Click → supabase.functions.invoke("billing-portal") → { url }
11. window.location.href = url → Stripe Customer Portal
```

## Modo DEMO (sin Stripe)

Si `STRIPE_SECRET_KEY` no está configurada:
- `create-checkout-session` devuelve 500 (mensaje claro)
- `billing-portal` devuelve 500
- La `PricingPage` cae al **modo demo**: crea un tenant con `plan='plus_30'`, `subscription_status='active'` directamente (sin Stripe).  Ver `PricingPage.tsx` línea 88-110.

## Test rápido

```bash
# Crear checkout
curl -X POST https://hcqkpokodrqimkulporw.supabase.co/functions/v1/create-checkout-session \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"plus"}'

# Abrir portal
curl -X POST https://hcqkpokodrqimkulporw.supabase.co/functions/v1/billing-portal \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
