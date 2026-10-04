# MOZONA TPV — Plan de Remediación de Auditoría (02/10/2026)

**Origen:** caja negra externa, hallazgos críticos H-01 a H-15.
**Estado actual:** Fases 0-1 listas para aplicar. Fase 2 en desarrollo. Fase 3 bloqueada hasta validar Fase 2.

---

## ⚠️ HALLAZGOS CRÍTICOS (resumen)

| ID   | Hallazgo                                                      | Severidad | Fase   |
|------|---------------------------------------------------------------|-----------|--------|
| H-01 | RLS roto: lectura anónima multi-tenant (14 tenants, 138 productos, 408 pedidos) | CRÍTICA   | 1       |
| H-02 | Escritura anónima en `products` → manipulación de precios     | CRÍTICA   | 3       |
| H-03 | RPC `get_first_active_tenant` filtra tenant a anon            | CRÍTICA   | 3       |
| H-04 | Signup sin verificar email (`mailer_autoconfirm=true`)        | CRÍTICA   | Dashboard |
| H-05 | Tokens admin en bundle (`mozona-approve-2025`)                | CRÍTICA (latent) | 1+rotar |
| H-06 | Recursión infinita en RLS de `profiles` (500 42P17)           | ALTA      | 0       |
| H-07 | PINs en plaintext + cache localStorage + mocks                | ALTA      | 2       |
| H-08 | Sin HSTS/CSP + `ACAO: *`                                      | ALTA      | Cloudflare |
| H-09 | Usuarios autenticados ven tenants ajenos                            | MEDIA     | 1       |

---

## 📋 FASES DE APLICACIÓN

### ✅ FASE 0 — fix recursión `profiles` (H-06)
**Archivo:** `database/72_AUDIT_FIX_PHASES_0_1.sql`
- Crea función `public.get_my_tenant()` SECURITY DEFINER → bypass RLS en profiles
- Recrea policy `profiles_isolated` usando esa función
- Elimina recursión 42P17 → pantalla de admin vuelve a funcionar

**Riesgo:** CERO. Solo arregla un bug, no añade restricciones.

---

### ✅ FASE 1 — aislamiento por tenant para `authenticated` (H-01, H-09)
**Archivo:** mismo `database/72_AUDIT_FIX_PHASES_0_1.sql`
- Aplica `tenant_isolation` en 10 tablas: products, orders, order_items, categories, dining_tables, tenant_settings, waiters, tenant_users, open_orders, payments
- Tabla `tenants`: SELECT solo tu tenant o donde sos owner
- Cierra fuga de metadatos entre tenants

**Riesgo:** BAJO. `anon` sigue igual. Usuarios autenticados solo ven su tenant — mismo flujo que ya hacía el frontend correctamente.

**Verificación post-aplicar:**
```sql
-- Como chalohiahmd (autenticado):
SELECT * FROM products;  -- debe devolver SOLO sus 138 productos
SELECT * FROM tenants;   -- debe devolver SOLO su tenant

-- Como rofixinsta (autenticado):
SELECT * FROM products;  -- debe devolver [] (admin no es tenant)
SELECT * FROM tenants;   -- debe devolver SOLO su admin tenant
```

---

### ⏳ FASE 2 — desplegar `waiter-api` con JWT (H-07)

**Estado:** EN DESARROLLO (lo entrego yo)
**Qué hace:**
1. Edge function `waiter-api` ya existe (Deno) — listo para desplegar
2. Valida `username + PIN` contra tabla `tenant_users` (columna `waiter_pin`)
3. Emite **JWT firmado** propio (HMAC-SHA256 con `WAITER_SECRET`)
4. Token expira en 24h, frontend lo guarda y lo usa en cada llamada
5. **Mientras Fase 2 NO esté desplegada**, el camarero sigue en "modo limitado" (anon)

**Migración adicional necesaria:** `73_waiter_pin_hash.sql` (hashear PINs con pgcrypto).

**Acción del cliente:**
```bash
supabase functions deploy waiter-api --no-verify-jwt
supabase secrets set WAITER_SECRET=$(openssl rand -base64 32)
```

---

### 🚫 FASE 3 — REVOKE ALL FROM anon (H-01, H-02, H-03) — **NO APLICAR AÚN**

**Bloqueada** hasta que Fase 2 esté validada. Razón:
- Si ejecutamos `REVOKE ALL FROM anon` sin que waiter-api funcione con JWT autenticado, los camareros NO podrán:
  - Login
  - Leer carta
  - Crear comandas
- El "modo limitado" actual depende de permisos anon

**Cuándo se desbloquea:**
1. ✅ Fase 2 desplegada Y validada con un camarero real
2. ✅ Edge function `waiter-api` responde 200 con token
3. ✅ Frontend actualizado para enviar token en cada llamada REST
4. ✅ Verificado que el flujo de camarero sigue funcionando
6. ENTONCES: ejecutar `REVOKE ALL FROM anon` en Fase 3

---

## 🛡️ ACCIONES PARALELAS (no SQL)

### H-04 — Desactivar autoconfirm de email
**Dónde:** Supabase Dashboard → Authentication → Providers → Email
- `Enable email confirm`: ON
- `Secure email change`: ON
- `mailer_autoconfirm`: OFF
- Activar CAPTCHA (hCaptcha / Cloudflare Turnstile)

### H-05 — Rotar tokens admin en bundle
**Tarea:** Sustituir en código:
- `mozona-approve-2025` → variable `import.meta.env.VITE_ADMIN_TOKEN`
- `mozona-ryad-2025` → idem
- Después de rotar, regenerar bundle con nueva versión

### H-08 — Añadir headers de seguridad en Cloudflare
**`_headers` en `public/`:**
```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### H-13 — robots.txt
**No revelar `/admin/` y `/api/`:**
```
User-agent: *
Disallow: /admin/
Disallow: /api/
Allow: /
Sitemap: /sitemap.xml
```
(Está bien que los bloquee para crawlers; el problema es que el resto NO los bloquea, lo que se considera informativo)

---

## ✅ CHECKLIST PARA EL CLIENTE

1. [ ] **Aplicar SQL #72 (Fases 0 + 1)** — sin tocar nada más
   - https://mozonatpv.site/database/72_AUDIT_FIX_PHASES_0_1.sql
2. [ ] Probar login con `chalohiahmd1980@gmail.com` → /app sigue funcionando
3. [ ] Probar login con `rofixinsta@gmail.com` → /admin sigue funcionando
4. [ ] Confirmar en consola del navegador: cero errores 500/42P17
5. [ ] Decirme "OK FASE 0+1 aplicada" y procedo a entregar Fase 2
6. [ ] Desactivar `mailer_autoconfirm` en Supabase Dashboard
7. [ ] Rotar tokens admin en código
8. [ ] Añadir `_headers` con HSTS+CSP en `public/`
9. [ ] Una vez validado todo, te entrego SQL #73 (Fase 3 REVOKE anon)

---

**Contacto de auditoría:** tus archivos `tenants_full.json` y `informe_seguridad_mozonatpv.site.md` quedan en `C:\temp\audit_mozona\`. **Elimina manualmente la cuenta `audit-pentest-20261002@probe-audit.local` en Dashboard → Authentication → Users** (no se puede borrar por API).