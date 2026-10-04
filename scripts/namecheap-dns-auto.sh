#!/bin/bash
# =====================================================================
# MOZONA TPV — namecheap-dns-auto.sh
# =====================================================================
# Configura automáticamente los DNS de mozonatpv.site para apuntar
# a GitHub Pages. Ejecutar como: ./namecheap-dns-auto.sh
#
# Necesita las variables de entorno:
#   NAMECHEAP_API_USER   - tu usuario de Namecheap
#   NAMECHEAP_API_KEY    - tu API key de Namecheap
#   NAMECHEAP_CLIENT_IP  - tu IP pública (whitelist en Namecheap)
#
# Para conseguir la API key:
#   https://ap.www.namecheap.com/settings/tools/apiaccess/
#   Activar API access y whitelist tu IP.
# =====================================================================

set -e

DOMAIN="mozonatpv.site"
SLD="mozonatpv"
TLD="site"

# ★ IPs de GitHub Pages
GH_IPS=("185.199.108.153" "185.199.109.153" "185.199.110.153" "185.199.111.153")

# ★ Verificar credenciales
if [ -z "$NAMECHEAP_API_USER" ] || [ -z "$NAMECHEAP_API_KEY" ] || [ -z "$NAMECHEAP_CLIENT_IP" ]; then
    echo "❌ Faltan credenciales. Configura:"
    echo "   export NAMECHEAP_API_USER='tu_usuario'"
    echo "   export NAMECHEAP_API_KEY='tu_api_key'"
    echo "   export NAMECHEAP_CLIENT_IP='tu_ip_publica'"
    exit 1
fi

API_URL="https://api.namecheap.com/xml.response"

call_api() {
    local command="$1"
    local extra_params="$2"
    local url="${API_URL}?ApiUser=${NAMECHEAP_API_USER}&ApiKey=${NAMECHEAP_API_KEY}&UserName=${NAMECHEAP_API_USER}&ClientIp=${NAMECHEAP_CLIENT_IP}&Command=${command}${extra_params}"
    curl -sL --max-time 30 "$url"
}

echo "═══════════════════════════════════════════════════════════"
echo "  Configurando DNS para $DOMAIN → GitHub Pages"
echo "═══════════════════════════════════════════════════════════"

# ★ Paso 1: Listar registros actuales
echo ""
echo "→ Listando registros actuales..."
CURRENT=$(call_api "namecheap.domains.dns.getHosts" "&SLD=${SLD}&TLD=${TLD}")
echo "$CURRENT" | head -30

# ★ Paso 2: Borrar TODOS los registros actuales
echo ""
echo "→ Borrando registros A y CNAME antiguos..."

# Extraer hosts del XML (formato simple con grep)
HOSTS=$(echo "$CURRENT" | grep -oE '<Host Name="[^"]*"' | grep -oE 'Name="[^"]*"' | grep -oE '"[^"]*"' | tr -d '"' | sort -u)

if [ -z "$HOSTS" ]; then
    echo "  No hay hosts que borrar."
else
    DELETE_PARAMS=""
    for host in $HOSTS; do
        echo "  - Borrando host: $host"
        DELETE_PARAMS="${DELETE_PARAMS}&HostName${host}=$host"
    done
    # Borrar todos
    call_api "namecheap.domains.dns.setHosts" "&SLD=${SLD}&TLD=${TLD}${DELETE_PARAMS}" > /dev/null
fi

# ★ Paso 3: Añadir los nuevos registros
echo ""
echo "→ Añadiendo registros A para apex (@)..."
RECORDS=""
for ip in "${GH_IPS[@]}"; do
    echo "  + A @ → $ip"
    RECORDS="${RECORDS}&RecordType1=A&RecordType1=A&HostName1=@&Address1=${ip}&TTL1=300"
done

echo ""
echo "→ Añadiendo CNAME para www..."
echo "  + CNAME www → ryad12345.github.io"
RECORDS="${RECORDS}&RecordType2=CNAME&HostName2=www&Address2=ryad12345.github.io&TTL2=300"

# Llamar API para setear los nuevos hosts
RESULT=$(call_api "namecheap.domains.dns.setHosts" "&SLD=${SLD}&TLD=${TLD}${RECORDS}")

if echo "$RESULT" | grep -q "Status=\"OK\""; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  ✓ DNS configurado correctamente"
    echo "═══════════════════════════════════════════════════════════"
else
    echo ""
    echo "❌ Error al configurar DNS:"
    echo "$RESULT" | head -10
    exit 1
fi

echo ""
echo "→ Verificando registros finales..."
FINAL=$(call_api "namecheap.domains.dns.getHosts" "&SLD=${SLD}&TLD=${TLD}")
echo "$FINAL" | grep -E "Name=|Address=|RecordType=" | head -20

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SIGUIENTE PASO:"
echo "  1. Activa GitHub Pages en:"
echo "     https://github.com/ryad12345/mozona-tpv-v2/settings/pages"
echo "  2. Branch: gh-pages, Folder: / (root)"
echo "  3. Custom domain: mozonatpv.site"
echo "  4. Espera 5-30 min para propagación DNS"
echo "═══════════════════════════════════════════════════════════"
