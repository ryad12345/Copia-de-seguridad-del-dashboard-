#!/bin/bash
# =====================================================================
# MOZONA TPV — Smoke Test (v3.0.4)
# =====================================================================
# Verifica que todos los endpoints responden correctamente.
# Uso: ./scripts/smoke-test.sh
# =====================================================================

set -e
BASE="${1:-https://www.mozonatpv.site}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
fail=0
warn=0

check() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local body_check="$4"

    printf "  %-40s " "$name"
    response=$(curl -sS -o /tmp/smoke_body -w "%{http_code}|%{content_type}" --max-time 10 "$url" 2>/dev/null || echo "000|error")
    status=$(echo "$response" | cut -d'|' -f1)
    ctype=$(echo "$response" | cut -d'|' -f2)

    if [ "$status" = "$expected_status" ]; then
        if [ -n "$body_check" ]; then
            if grep -q "$body_check" /tmp/smoke_body 2>/dev/null; then
                echo -e "${GREEN}✓ OK${NC} ($status, $ctype)"
                pass=$((pass+1))
            else
                echo -e "${YELLOW}⚠ WARN${NC} ($status pero body no contiene '$body_check')"
                warn=$((warn+1))
            fi
        else
            echo -e "${GREEN}✓ OK${NC} ($status, $ctype)"
            pass=$((pass+1))
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (status=$status, esperado=$expected_status)"
        fail=$((fail+1))
    fi
}

check_post() {
    local name="$1"
    local url="$2"
    local data="$3"
    local expected_status="${4:-200}"
    local body_check="$5"

    printf "  %-40s " "$name"
    response=$(curl -sS -o /tmp/smoke_body -w "%{http_code}|%{content_type}" --max-time 10 \
        -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null || echo "000|error")
    status=$(echo "$response" | cut -d'|' -f1)
    ctype=$(echo "$response" | cut -d'|' -f2)

    if [ "$status" = "$expected_status" ]; then
        if [ -n "$body_check" ]; then
            if grep -q "$body_check" /tmp/smoke_body 2>/dev/null; then
                echo -e "${GREEN}✓ OK${NC} ($status, $ctype)"
                pass=$((pass+1))
            else
                echo -e "${YELLOW}⚠ WARN${NC} ($status pero body no contiene '$body_check')"
                warn=$((warn+1))
            fi
        else
            echo -e "${GREEN}✓ OK${NC} ($status, $ctype)"
            pass=$((pass+1))
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (status=$status, esperado=$expected_status)"
        fail=$((fail+1))
    fi
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  MOZONA TPV — Smoke Test v3.0.4"
echo "  Base: $BASE"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "📄 Páginas públicas:"
check "Landing page"          "$BASE/"          200 ""
check "Pricing page"          "$BASE/pricing"   200 "Elige tu plan"
check "Auth page"             "$BASE/auth"      200 ""
check "Health page"           "$BASE/health"    200 "Estado"
check "Welcome page"          "$BASE/welcome"   200 ""
check "Waiting activation"    "$BASE/waiting-activation" 200 ""
check "Admin approve (sin token)" "$BASE/admin/approve" 200 "Acceso restringido"

echo ""
echo "🔌 Endpoints API:"
check "GET /api/health"       "$BASE/api/health" 200 "version"
check_post "POST /api/check-status" "$BASE/api/check-status" '{"email":"test@test.com"}' 200 "ok"
check_post "POST /api/register-tenant" "$BASE/api/register-tenant" '{"email":"smoke@test.com","password":"smoke1234","name":"Smoke Test"}' 200 "ok"

echo ""
echo "🔐 Endpoints protegidos (deben responder 200 con error o 403):"
check_post "POST /api/approve-tenant sin auth" "$BASE/api/approve-tenant" '{"email":"x@x.com"}' 200 "No autorizado"

echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "  Resultado: ${GREEN}$pass OK${NC} | ${YELLOW}$warn WARN${NC} | ${RED}$fail FAIL${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""

if [ "$fail" -gt 0 ]; then
    exit 1
fi
