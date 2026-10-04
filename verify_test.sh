#!/bin/bash
# =====================================================================
# Verificar/crear usuario de prueba en Supabase
# =====================================================================

set -e
cd /workspace/mozona-tpv-v2-real 2>/dev/null || cd $(pwd)

if [ ! -f .env ]; then
    echo "✗ No se encuentra .env"
    exit 1
fi
set -a; source .env; set +a

# ★ SEGURIDAD: nunca hardcodear credenciales reales de producción.
#   Defínelas en el entorno o en .env antes de ejecutar:
#     export MOZONA_TEST_EMAIL='...' MOZONA_TEST_PASSWORD='...'
EMAIL="${MOZONA_TEST_EMAIL:-}"
PASSWORD="${MOZONA_TEST_PASSWORD:-}"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
    echo "✗ Define MOZONA_TEST_EMAIL y MOZONA_TEST_PASSWORD (entorno o .env)."
    exit 1
fi

echo "=== 1. Verificando si el usuario existe ==="
EXISTING_USER=$(curl -s "$VITE_SUPABASE_URL/auth/v1/admin/users?email=$EMAIL" \
    -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
u = d.get('users', [])
if u:
    print(u[0]['id'])
else:
    print('NONE')
" 2>/dev/null)

if [ "$EXISTING_USER" = "NONE" ] || [ -z "$EXISTING_USER" ]; then
    echo "Usuario no existe. Creando..."
    USER_ID=$(curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/admin/users" \
        -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"$EMAIL\",
            \"password\": \"$PASSWORD\",
            \"email_confirm\": true,
            \"user_metadata\": {\"full_name\": \"Chalohiahmd\"}
        }" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    if [ -z "$USER_ID" ]; then
        echo "✗ Error creando usuario"
        exit 1
    fi
    echo "✓ Usuario creado: $USER_ID"
else
    echo "✓ Usuario ya existe: $EXISTING_USER"
    USER_ID=$EXISTING_USER
    
    # Resetear la contraseña
    echo ""
    echo "=== 2. Reseteando contraseña ==="
    curl -s -X PUT "$VITE_SUPABASE_URL/auth/v1/admin/users/$USER_ID" \
        -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"password\": \"$PASSWORD\", \"email_confirm\": true}" | head -c 100
    echo ""
    echo "✓ Contraseña reseteada"
fi

echo ""
echo "=== 3. Verificando/creando tenant ==="
TENANT=$(curl -s "$VITE_SUPABASE_URL/rest/v1/tenants?owner_id=eq.$USER_ID" \
    -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" | \
    python3 -c "import sys, json; d=json.load(sys.stdin); print(d[0]['id'] if d else 'NONE')" 2>/dev/null)

if [ "$TENANT" = "NONE" ] || [ -z "$TENANT" ]; then
    echo "Tenant no existe. Creando..."
    TENANT=$(curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/tenants" \
        -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d "{
            \"name\": \"Rincón de MOZONA\",
            \"slug\": \"rincon-de-mozona\",
            \"cif_nif\": \"B12345678\",
            \"address\": \"Calle de Casablanca 12, Madrid\",
            \"phone\": \"+34 600 000 000\",
            \"primary_color\": \"#2563EB\",
            \"ticket_footer_msg\": \"¡Gracias por su visita!\",
            \"default_tax_rate\": 10,
            \"onboarding_completed\": true,
            \"plan\": \"lifetime_vip\",
            \"subscription_status\": \"active\",
            \"owner_id\": \"$USER_ID\"
        }" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d, list) else d.get('id',''))" 2>/dev/null)
    echo "✓ Tenant creado: $TENANT"
else
    echo "✓ Tenant ya existe: $TENANT"
    # Asegurar onboarding_completed = true
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/tenants?id=eq.$TENANT" \
        -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"onboarding_completed\": true, \"subscription_status\": \"active\"}" | head -c 50
    echo ""
fi

echo ""
echo "=== 4. Vinculando usuario como tenant_user (owner) ==="
curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/tenant_users" \
    -H "apikey: $MOZONA_SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $MOZONA_SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=ignore-duplicates" \
    -d "{
        \"tenant_id\": \"$TENANT\",
        \"user_id\": \"$USER_ID\",
        \"role\": \"owner\",
        \"name\": \"Chalohiahmd\",
        \"is_active\": true
    }" | head -c 100
echo ""

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ LISTO"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Credenciales:"
echo "  Email:     $EMAIL"
echo "  Password:  $PASSWORD"
echo "  User ID:   $USER_ID"
echo "  Tenant ID: $TENANT"
echo ""
echo "Ahora recarga https://mozonatpv.site/auth con Ctrl+Shift+R"
echo "y entra con esas credenciales."
