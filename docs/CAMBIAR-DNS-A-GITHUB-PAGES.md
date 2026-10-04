# 🔧 Cambiar DNS de mozonatpv.site a GitHub Pages

**Vercel lleva más de 10 horas con el cluster caído.** Mientras se recupera, vamos a hacer que el dominio apunte a GitHub Pages (donde ya está el bundle desplegado).

---

## ⚠️ ANTES DE EMPEZAR

Necesitas saber **quién gestiona tu DNS** (`mozonatpv.site`):
- **Cloudflare** → ves icono naranja/azul en el dashboard
- **Namecheap** → lo compraste ahí
- **GoDaddy** → lo compraste ahí
- **Google Domains / Squarespace** → migrated recently
- **Otro** → dime cuál

---

## 📋 PASOS (5-10 minutos)

### PASO 1: Activa GitHub Pages

1. Abre: https://github.com/ryad12345/mozona-tpv-v2/settings/pages
2. **Source**: `Deploy from a branch`
3. **Branch**: `gh-pages`
4. **Folder**: `/ (root)`
5. Click **Save**
6. Espera 1-2 minutos (verás "Your site is live at...")

### PASO 2: Configura el DNS

#### Si usas **Cloudflare** (más común):

1. Login en https://dash.cloudflare.com
2. Selecciona `mozonatpv.site`
3. Click en **DNS** (icono de engranaje)
4. **BORRA** todos los registros:
   - Tipo A con nombre `@` (si existe)
   - Tipo AAAA con nombre `@` (si existe)
   - Tipo CNAME con nombre `www` (si existe)
5. **AÑADE** estos 4 registros (botón "Add record"):

| Tipo | Nombre | Contenido | Proxy | TTL |
|------|--------|-----------|-------|-----|
| A | @ | 185.199.108.153 | **DNS only** (gris) | Auto |
| A | @ | 185.199.109.153 | **DNS only** (gris) | Auto |
| A | @ | 185.199.110.153 | **DNS only** (gris) | Auto |
| A | @ | 185.199.111.153 | **DNS only** (gris) | Auto |
| CNAME | www | ryad12345.github.io | **DNS only** (gris) | Auto |

⚠️ **MUY IMPORTANTE en Cloudflare**: el icono de la nube debe ser **GRIS** (DNS only), NO naranja (Proxied). GitHub Pages no funciona con proxy.

#### Si usas **Namecheap**:

1. Login → Domain List → Manage `mozonatpv.site`
2. Click en **Advanced DNS**
3. **BORRA** los registros A y CNAME del @ y www
4. **AÑADE** (botón "Add New Record"):

| Tipo | Host | Value | TTL |
|------|------|-------|-----|
| A Record | @ | 185.199.108.153 | Automatic |
| A Record | @ | 185.199.109.153 | Automatic |
| A Record | @ | 185.199.110.153 | Automatic |
| A Record | @ | 185.199.111.153 | Automatic |
| CNAME Record | www | ryad12345.github.io | Automatic |

#### Si usas **GoDaddy**:

1. My Products → `mozonatpv.site` → DNS
2. Click **Add** para cada registro
3. Borra los A/AAAA/CNAME antiguos

#### Si usas **otro proveedor**:

Los registros son siempre los mismos:

```
A      @    185.199.108.153
A      @    185.199.109.153
A      @    185.199.110.153
A      @    185.199.111.153
CNAME  www  ryad12345.github.io
```

---

## PASO 3: Verifica la propagación

1. Espera **5-30 minutos** (depende del TTL de tu proveedor)
2. Verifica en: https://dnschecker.org/#A/mozonatpv.site
3. Debes ver las 4 IPs `185.199.x.x`在全球
4. También: https://dnschecker.org/#CNAME/www.mozonatpv.site
5. Debe apuntar a `ryad12345.github.io`

## PASO 4: HTTPS

1. Vuelve a GitHub Pages: https://github.com/ryad12345/mozona-tpv-v2/settings/pages
2. Marca **"Enforce HTTPS"** (puede tardar hasta 24h en activarse la primera vez)

---

## ✅ RESULTADO

| URL | Estado esperado |
|-----|----------------|
| https://mozonatpv.site | App Mozona TPV (servida desde GitHub Pages) |
| https://www.mozonatpv.site | Redirect a mozonatpv.site |
| https://ryad12345.github.io/mozona-tpv-v2/ | App (URL de respaldo) |

---

## 🔄 CUANDO VERCEL SE RECUPERE

Si quieres volver a Vercel (más rápido en el futuro):

1. Vuelve al proveedor DNS
2. Borra los 4 registros A y el CNAME
3. Añade:
   - A @ → 76.76.21.21 (Vercel apex IP)
   - CNAME www → cname.vercel-dns.com
4. Vercel detectará y activará SSL automáticamente

O simplemente déjamelo a mí: cuando Vercel funcione, puedo hacer el cambio desde el código (deploy directo).

---

## 📞 SOPORTE

Si te atascas, dime **qué proveedor DNS usas** y te guío paso a paso con capturas.
