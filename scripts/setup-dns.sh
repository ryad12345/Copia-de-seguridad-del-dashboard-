#!/bin/bash
# =====================================================================
# MOZONA TPV — Script de configuración DNS para GitHub Pages
# =====================================================================
# Ejecuta este script para que el dominio apunte a GitHub Pages
# (NO a Vercel que está caído).
#
# INSTRUCCIONES:
# 1. Ve a tu proveedor DNS (Cloudflare, Namecheap, GoDaddy, etc.)
# 2. Elimina TODOS los registros A/AAAA/CNAME del apex mozonatpv.site
# 3. Añade los registros de abajo
#
# Para Cloudflare:
#   - Dashboard → mozonatpv.site → DNS → Records
#
# Para Namecheap:
#   - Domain List → Manage → Advanced DNS
#
# =====================================================================

cat << 'EOF'
═══════════════════════════════════════════════════════════════
  CONFIGURACIÓN DNS REQUERIDA PARA mozonatpv.site
═══════════════════════════════════════════════════════════════

⚠️  BORRA primero todos los registros A, AAAA, CNAME existentes
    del apex (mozonatpv.site) y del subdominio www.

📌 REGISTROS A (4) — APUNTAN A GITHUB PAGES:
─────────────────────────────────────────────
Tipo   Host    Valor                     TTL
A      @       185.199.108.153           3600
A      @       185.199.109.153           3600
A      @       185.199.110.153           3600
A      @       185.199.111.153           3600

📌 REGISTRO CNAME (1) — WWW → GITHUB USERNAME:
─────────────────────────────────────────────
Tipo    Host    Valor                       TTL
CNAME   www     ryad12345.github.io.        3600

═══════════════════════════════════════════════════════════════

PASOS EN CADA PROVEEDOR:

☁️  CLOUDFLARE:
   1. Login → mozonatpv.site → DNS → Records
   2. Borrar todos los registros A/AAAA/CNAME del @
   3. Añadir los 4 registros A (arriba)
   4. Añadir CNAME www → ryad12345.github.io
   5. IMPORTANTE: Proxy debe estar en "DNS only" (nube gris)
      NO en "Proxied" (nube naranja) porque GitHub Pages
      no funciona con Cloudflare proxy habilitado.

🌐 NAMECHEAP:
   1. Domain List → Manage mozonatpv.site
   2. Advanced DNS → Add New Record
   3. Tipo A: Host=@, Value=185.199.108.153 (×4 veces)
   4. Tipo CNAME: Host=www, Value=ryad12345.github.io

🌍 GODADDY:
   1. My Products → mozonatpv.site → DNS
   2. Records → Add
   3. Tipo A: Name=@, Value=185.199.108.153 (×4)
   4. Tipo CNAME: Name=www, Target=ryad12345.github.io

═══════════════════════════════════════════════════════════════

DESPUÉS DE CONFIGURAR:

1. Activa GitHub Pages en:
   https://github.com/ryad12345/mozona-tpv-v2/settings/pages

2. Configuración:
   Source: "Deploy from a branch"
   Branch: gh-pages
   Folder: / (root)
   Custom domain: mozonatpv.site
   ☑ Enforce HTTPS (marca esta casilla)

3. Espera 5-30 minutos a que se propague el DNS.

4. Verifica en: https://dnschecker.org/#A/mozonatpv.site

═══════════════════════════════════════════════════════════════
EOF
